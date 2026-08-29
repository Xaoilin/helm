import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { inspectGlbJson, readAccessor, readGlb, writeGlb } from './lib/glb.mjs'

const REQUIRED_CLIPS = ['Idle_02', 'Motivational_Cheer', 'Running', 'Walking']

function parseArguments(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith('--') || !value) throw new Error(`Invalid argument near ${name ?? 'end'}`)
    result[name.slice(2)] = value
  }
  if (!result.body || !result.rig || !result.output) {
    throw new Error('Usage: node scripts/build-life-hero-glb.mjs --body <remesh.glb> --rig <animated.glb> --output <modular.glb>')
  }
  return result
}

async function sha256(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex')
}

function align(value, multiple = 4) {
  return Math.ceil(value / multiple) * multiple
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function union(left = [], right = []) {
  return [...new Set([...left, ...right])]
}

function bounds(values, componentCount = 3) {
  const minimum = Array(componentCount).fill(Number.POSITIVE_INFINITY)
  const maximum = Array(componentCount).fill(Number.NEGATIVE_INFINITY)
  for (let index = 0; index < values.length; index += componentCount) {
    for (let component = 0; component < componentCount; component += 1) {
      minimum[component] = Math.min(minimum[component], values[index + component])
      maximum[component] = Math.max(maximum[component], values[index + component])
    }
  }
  return { minimum, maximum }
}

function mapBodyToRig(bodyPositions, bodyBounds, rigBounds) {
  const bodySize = bodyBounds.maximum.map((value, index) => value - bodyBounds.minimum[index])
  const rigSize = rigBounds.maximum.map((value, index) => value - rigBounds.minimum[index])
  const scale = bodySize.map((value, index) => rigSize[index] / value)
  const mapped = new Float32Array(bodyPositions.length)
  for (let index = 0; index < bodyPositions.length; index += 3) {
    for (let component = 0; component < 3; component += 1) {
      mapped[index + component] = rigBounds.minimum[component]
        + (bodyPositions[index + component] - bodyBounds.minimum[component]) * scale[component]
    }
  }
  return { mapped, scale }
}

function transformNormals(normalValues, scale) {
  const transformed = new Float32Array(normalValues.length)
  for (let index = 0; index < normalValues.length; index += 3) {
    const x = normalValues[index] / scale[0]
    const y = normalValues[index + 1] / scale[1]
    const z = normalValues[index + 2] / scale[2]
    const length = Math.hypot(x, y, z) || 1
    transformed[index] = x / length
    transformed[index + 1] = y / length
    transformed[index + 2] = z / length
  }
  return transformed
}

function buildKdTree(positions, indexes, depth = 0) {
  if (indexes.length === 0) return null
  const axis = depth % 3
  indexes.sort((left, right) => positions[left * 3 + axis] - positions[right * 3 + axis])
  const middle = Math.floor(indexes.length / 2)
  return {
    axis,
    index: indexes[middle],
    left: buildKdTree(positions, indexes.slice(0, middle), depth + 1),
    right: buildKdTree(positions, indexes.slice(middle + 1), depth + 1),
  }
}

function nearestIndexes(tree, positions, point, count, best = []) {
  if (!tree) return best
  const offset = tree.index * 3
  const dx = point[0] - positions[offset]
  const dy = point[1] - positions[offset + 1]
  const dz = point[2] - positions[offset + 2]
  const distanceSquared = dx * dx + dy * dy + dz * dz
  const nearest = [...best, { index: tree.index, distanceSquared }]
    .sort((left, right) => left.distanceSquared - right.distanceSquared)
    .slice(0, count)
  const delta = point[tree.axis] - positions[offset + tree.axis]
  const first = delta < 0 ? tree.left : tree.right
  const second = delta < 0 ? tree.right : tree.left
  const afterFirst = nearestIndexes(first, positions, point, count, nearest)
  const worstDistance = afterFirst.length < count
    ? Number.POSITIVE_INFINITY
    : afterFirst[afterFirst.length - 1].distanceSquared
  if (delta * delta < worstDistance) {
    return nearestIndexes(second, positions, point, count, afterFirst)
  }
  return afterFirst
}

function transferWeights(rigPositions, rigJoints, rigWeights, bodyPositions) {
  const tree = buildKdTree(
    rigPositions,
    Array.from({ length: rigPositions.length / 3 }, (_, index) => index),
  )
  const joints = new Uint8Array((bodyPositions.length / 3) * 4)
  const weights = new Float32Array((bodyPositions.length / 3) * 4)
  let maximumDistance = 0

  for (let vertex = 0; vertex < bodyPositions.length / 3; vertex += 1) {
    const positionOffset = vertex * 3
    const nearest = nearestIndexes(tree, rigPositions, [
      bodyPositions[positionOffset],
      bodyPositions[positionOffset + 1],
      bodyPositions[positionOffset + 2],
    ], 8)
    maximumDistance = Math.max(maximumDistance, Math.sqrt(nearest[0].distanceSquared))
    const jointScores = new Map()
    for (const neighbour of nearest) {
      const spatialWeight = 1 / Math.max(neighbour.distanceSquared, 0.000025)
      for (let component = 0; component < 4; component += 1) {
        const sourceOffset = neighbour.index * 4 + component
        const sourceWeight = rigWeights[sourceOffset]
        if (sourceWeight <= 0) continue
        const joint = rigJoints[sourceOffset]
        jointScores.set(joint, (jointScores.get(joint) ?? 0) + sourceWeight * spatialWeight)
      }
    }
    const strongest = [...jointScores.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 4)
    const total = strongest.reduce((sum, entry) => sum + entry[1], 0) || 1
    for (let component = 0; component < 4; component += 1) {
      const [joint = 0, score = 0] = strongest[component] ?? []
      joints[vertex * 4 + component] = joint
      weights[vertex * 4 + component] = score / total
    }
  }

  return { joints, weights, maximumDistance }
}

function makeJacket(bodyPositions, bodyNormals, bodyJoints, bodyWeights, bodyIndices) {
  const sourceToJacket = new Map()
  const positions = []
  const normals = []
  const joints = []
  const weights = []
  const indices = []
  const outwardOffset = 0.025

  const includeTriangle = (a, b, c) => {
    const vertices = [a, b, c]
    const ys = vertices.map(vertex => bodyPositions[vertex * 3 + 1])
    if (Math.min(...ys) < 0.76 || Math.max(...ys) > 1.39) return false
    const centroidX = vertices.reduce((sum, vertex) => sum + bodyPositions[vertex * 3], 0) / 3
    const centroidY = ys.reduce((sum, value) => sum + value, 0) / 3
    const torso = Math.abs(centroidX) <= 0.255 && centroidY >= 0.78
    const sleeve = Math.abs(centroidX) <= 0.37 && centroidY >= 0.91
    return torso || sleeve
  }

  const addVertex = sourceIndex => {
    if (sourceToJacket.has(sourceIndex)) return sourceToJacket.get(sourceIndex)
    const jacketIndex = sourceToJacket.size
    sourceToJacket.set(sourceIndex, jacketIndex)
    const positionOffset = sourceIndex * 3
    const weightOffset = sourceIndex * 4
    const radialX = bodyPositions[positionOffset]
    const radialZ = bodyPositions[positionOffset + 2]
    const radialLength = Math.hypot(radialX, radialZ) || 1
    for (let component = 0; component < 3; component += 1) {
      const normal = bodyNormals[positionOffset + component]
      const radial = component === 0
        ? radialX / radialLength
        : component === 2
          ? radialZ / radialLength
          : 0
      const sourcePosition = bodyPositions[positionOffset + component]
      const hemPosition = component === 1 && sourcePosition < 0.86 ? 0.8 : sourcePosition
      positions.push(hemPosition + radial * outwardOffset)
      normals.push(normal)
    }
    for (let component = 0; component < 4; component += 1) {
      joints.push(bodyJoints[weightOffset + component])
      weights.push(bodyWeights[weightOffset + component])
    }
    return jacketIndex
  }

  for (let index = 0; index < bodyIndices.length; index += 3) {
    const a = bodyIndices[index]
    const b = bodyIndices[index + 1]
    const c = bodyIndices[index + 2]
    if (!includeTriangle(a, b, c)) continue
    indices.push(addVertex(a), addVertex(b), addVertex(c))
  }

  if (positions.length === 0 || indices.length === 0) throw new Error('Jacket extraction produced no geometry')
  if (positions.length / 3 > 65_535) throw new Error('Jacket requires 32-bit indices unexpectedly')
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    joints: new Uint8Array(joints),
    weights: new Float32Array(weights),
    indices: new Uint16Array(indices),
    outwardOffset,
  }
}

function typedBuffer(values) {
  return Buffer.from(values.buffer, values.byteOffset, values.byteLength)
}

async function build({ body: bodyPath, rig: rigPath, output: outputPath }) {
  const [body, rig, bodyHash, rigHash] = await Promise.all([
    readGlb(bodyPath),
    readGlb(rigPath),
    sha256(bodyPath),
    sha256(rigPath),
  ])
  const bodyPrimitive = body.json.meshes?.[0]?.primitives?.[0]
  const rigPrimitive = rig.json.meshes?.[0]?.primitives?.[0]
  if (!bodyPrimitive || !rigPrimitive) throw new Error('Both inputs must contain one primary mesh primitive')
  const clipNames = (rig.json.animations ?? []).map(animation => animation.name)
  if (JSON.stringify(clipNames) !== JSON.stringify(REQUIRED_CLIPS)) {
    throw new Error(`Rig input clips must be exactly ${REQUIRED_CLIPS.join(', ')}; received ${clipNames.join(', ')}`)
  }
  if ((rig.json.skins ?? []).length !== 1 || rig.json.skins[0].joints?.length !== 24) {
    throw new Error('Rig input must expose one 24-joint skin')
  }

  const bodyPositionSource = readAccessor(body, bodyPrimitive.attributes.POSITION).values
  const bodyNormalSource = readAccessor(body, bodyPrimitive.attributes.NORMAL).values
  const bodyIndexSource = readAccessor(body, bodyPrimitive.indices).values
  const rigPositions = readAccessor(rig, rigPrimitive.attributes.POSITION).values
  const rigJoints = readAccessor(rig, rigPrimitive.attributes.JOINTS_0).values
  const rigWeights = readAccessor(rig, rigPrimitive.attributes.WEIGHTS_0).values
  const bodyBounds = bounds(bodyPositionSource)
  const rigBounds = bounds(rigPositions)
  const { mapped: bodyPositions, scale } = mapBodyToRig(bodyPositionSource, bodyBounds, rigBounds)
  const bodyNormals = transformNormals(bodyNormalSource, scale)
  const bodyIndices = new Uint16Array(bodyIndexSource)
  const transferred = transferWeights(rigPositions, rigJoints, rigWeights, bodyPositions)
  const jacket = makeJacket(
    bodyPositions,
    bodyNormals,
    transferred.joints,
    transferred.weights,
    bodyIndices,
  )

  const oldBinaryLength = align(rig.binary.byteLength)
  const bodyBinaryOffset = oldBinaryLength
  const bodyBinaryLength = align(body.binary.byteLength)
  const binaryParts = [
    rig.binary,
    Buffer.alloc(oldBinaryLength - rig.binary.byteLength),
    body.binary,
    Buffer.alloc(bodyBinaryLength - body.binary.byteLength),
  ]
  let byteOffset = oldBinaryLength + bodyBinaryLength

  const json = {
    asset: {
      generator: 'HELM KAN-257 modular GLB assembler',
      version: '2.0',
      extras: {
        lifeHeroContract: 'life-hero-avatar/v1-concept',
        meshyCredits: 35,
        sourceBodySha256: bodyHash,
        sourceRigSha256: rigHash,
        weightTransfer: 'inverse-distance blend of eight nearest rig-source vertices after bounds alignment',
        jacketConstruction: 'separate outward torso and upper-arm shell retaining transferred weights',
      },
    },
    extensionsUsed: union(rig.json.extensionsUsed, body.json.extensionsUsed),
    extensionsRequired: union(rig.json.extensionsRequired, body.json.extensionsRequired),
    scene: rig.json.scene ?? 0,
    scenes: clone(rig.json.scenes ?? [{ nodes: [0] }]),
    nodes: clone(rig.json.nodes ?? []),
    skins: clone(rig.json.skins ?? []),
    animations: clone(rig.json.animations ?? []),
    accessors: clone(rig.json.accessors ?? []),
    bufferViews: clone(rig.json.bufferViews ?? []),
    samplers: clone(body.json.samplers ?? []),
    images: clone(body.json.images ?? []),
    textures: clone(body.json.textures ?? []),
    materials: [
      ...clone(body.json.materials ?? []),
      {
        name: 'LifeHero_Jacket_Rust',
        doubleSided: true,
        pbrMetallicRoughness: {
          baseColorFactor: [0.38, 0.08, 0.03, 1],
          metallicFactor: 0,
          roughnessFactor: 0.72,
        },
      },
    ],
  }
  if (json.extensionsUsed.length === 0) delete json.extensionsUsed
  if (json.extensionsRequired.length === 0) delete json.extensionsRequired
  delete json.materials[0]?.normalTexture

  const bodyBufferViewBase = json.bufferViews.length
  const bodyAccessorBase = json.accessors.length
  for (const bufferView of body.json.bufferViews ?? []) {
    json.bufferViews.push({
      ...clone(bufferView),
      buffer: 0,
      byteOffset: bodyBinaryOffset + (bufferView.byteOffset ?? 0),
    })
  }
  for (const accessor of body.json.accessors ?? []) {
    json.accessors.push({
      ...clone(accessor),
      bufferView: accessor.bufferView === undefined
        ? undefined
        : bodyBufferViewBase + accessor.bufferView,
    })
  }
  for (const image of json.images) {
    if (image.bufferView !== undefined) image.bufferView += bodyBufferViewBase
  }

  const appendAccessor = (values, componentType, type, target, minimum, maximum) => {
    const padding = align(byteOffset) - byteOffset
    if (padding > 0) {
      binaryParts.push(Buffer.alloc(padding))
      byteOffset += padding
    }
    const bytes = typedBuffer(values)
    const bufferViewIndex = json.bufferViews.length
    json.bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.byteLength, target })
    binaryParts.push(bytes)
    byteOffset += bytes.byteLength
    const accessorIndex = json.accessors.length
    const accessor = {
      bufferView: bufferViewIndex,
      componentType,
      count: values.length / ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type]),
      type,
    }
    if (minimum) accessor.min = minimum
    if (maximum) accessor.max = maximum
    json.accessors.push(accessor)
    return accessorIndex
  }

  const bodyPositionBounds = bounds(bodyPositions)
  const jacketPositionBounds = bounds(jacket.positions)
  const basePositionAccessor = appendAccessor(
    bodyPositions,
    5126,
    'VEC3',
    34962,
    bodyPositionBounds.minimum,
    bodyPositionBounds.maximum,
  )
  const baseNormalAccessor = appendAccessor(bodyNormals, 5126, 'VEC3', 34962)
  const baseJointsAccessor = appendAccessor(transferred.joints, 5121, 'VEC4', 34962)
  const baseWeightsAccessor = appendAccessor(transferred.weights, 5126, 'VEC4', 34962)
  const jacketPositionAccessor = appendAccessor(
    jacket.positions,
    5126,
    'VEC3',
    34962,
    jacketPositionBounds.minimum,
    jacketPositionBounds.maximum,
  )
  const jacketNormalAccessor = appendAccessor(jacket.normals, 5126, 'VEC3', 34962)
  const jacketJointsAccessor = appendAccessor(jacket.joints, 5121, 'VEC4', 34962)
  const jacketWeightsAccessor = appendAccessor(jacket.weights, 5126, 'VEC4', 34962)
  const jacketIndexAccessor = appendAccessor(jacket.indices, 5123, 'SCALAR', 34963)

  const bodyMesh = {
    name: 'LifeHero_BaseBody',
    extras: { kind: 'body', neutralUnderlayerComplete: true },
    primitives: [{
      attributes: {
        POSITION: basePositionAccessor,
        NORMAL: baseNormalAccessor,
        TEXCOORD_0: bodyAccessorBase + bodyPrimitive.attributes.TEXCOORD_0,
        JOINTS_0: baseJointsAccessor,
        WEIGHTS_0: baseWeightsAccessor,
      },
      indices: bodyAccessorBase + bodyPrimitive.indices,
      material: bodyPrimitive.material ?? 0,
      mode: bodyPrimitive.mode ?? 4,
    }],
  }
  const jacketMesh = {
    name: 'LifeHero_Jacket',
    extras: { kind: 'skinned-clothing', slot: 'torso', source: 'separate mesh' },
    primitives: [{
      attributes: {
        POSITION: jacketPositionAccessor,
        NORMAL: jacketNormalAccessor,
        JOINTS_0: jacketJointsAccessor,
        WEIGHTS_0: jacketWeightsAccessor,
      },
      indices: jacketIndexAccessor,
      material: json.materials.length - 1,
      mode: 4,
    }],
  }
  json.meshes = [bodyMesh, jacketMesh]

  const originalMeshNodeIndex = json.nodes.findIndex(node => node.mesh !== undefined && node.skin !== undefined)
  if (originalMeshNodeIndex < 0) throw new Error('Rig input has no skinned mesh node')
  const originalMeshNode = json.nodes[originalMeshNodeIndex]
  originalMeshNode.name = 'LifeHero_BaseBody'
  originalMeshNode.mesh = 0
  originalMeshNode.skin = 0
  originalMeshNode.extras = { kind: 'body', neutralUnderlayerComplete: true }
  const jacketNodeIndex = json.nodes.length
  json.nodes.push({
    name: 'LifeHero_Jacket',
    mesh: 1,
    skin: 0,
    extras: { kind: 'skinned-clothing', slot: 'torso', runtimeToggle: true },
  })
  const parentNode = json.nodes.find(node => node.children?.includes(originalMeshNodeIndex))
  if (!parentNode) throw new Error('Rig input mesh node has no parent')
  parentNode.children.push(jacketNodeIndex)

  const binary = Buffer.concat(binaryParts)
  json.buffers = [{ byteLength: binary.byteLength }]
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeGlb(outputPath, json, binary)

  return {
    output: outputPath,
    sourceBodySha256: bodyHash,
    sourceRigSha256: rigHash,
    bodyVertices: bodyPositions.length / 3,
    bodyTriangles: bodyIndices.length / 3,
    jacketVertices: jacket.positions.length / 3,
    jacketTriangles: jacket.indices.length / 3,
    jacketOutwardOffset: jacket.outwardOffset,
    maximumWeightTransferDistance: transferred.maximumDistance,
    structure: inspectGlbJson(json),
  }
}

const isCli = process.argv[1] === fileURLToPath(import.meta.url)
if (isCli) {
  try {
    const result = await build(parseArguments(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    process.exitCode = 1
  }
}

export { build }
