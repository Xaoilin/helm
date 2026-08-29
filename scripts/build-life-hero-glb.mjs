import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { inspectGlbJson, readAccessor, readGlb, writeGlb } from './lib/glb.mjs'

const REQUIRED_CLIPS = ['Idle_02', 'Motivational_Cheer', 'Running', 'Walking']
const JOINT_COUNT = 24
const MATERIAL_REGION_CLASSIFIER = 'native-joints-position-v1'
const RENDER_NORMAL_ALGORITHM = 'angle-weighted-welded-v1'
const RENDER_NORMAL_CREASE_DEGREES = 45
const POSITION_WELD_EPSILON = 1e-5
const BODY_REGION_ORDER = ['identity-texture', 'clean-skin', 'clean-underlayer', 'clean-shoes']
const HEAD_JOINTS = new Set([21, 22, 23])
const CLEAN_SKIN_JOINTS = new Set([14, 15, 18, 19, 20])
const UPPER_ARM_JOINTS = new Set([13, 17])
const SHOE_JOINTS = new Set([3, 4, 7, 8])
const SKIN_COLOR = [0.54, 0.29, 0.15, 1]
const UNDERLAYER_COLOR = [0.055, 0.065, 0.08, 1]
const COLLAR_FADE_LOWER_Y = 1.413
const COLLAR_FADE_UPPER_Y = 1.421
const COLLAR_MAX_ABS_X = 0.2
const COLLAR_MIN_Z = -0.15
const COLLAR_MAX_Z = 0.05

function parseArguments(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith('--') || !value) throw new Error(`Invalid argument near ${name ?? 'end'}`)
    result[name.slice(2)] = value
  }
  const required = ['body', 'idle', 'cheer', 'running', 'walking', 'output']
  const missing = required.filter(name => !result[name])
  if (missing.length > 0) {
    throw new Error(`Missing ${missing.join(', ')}. Required: ${required.map(name => `--${name} <file>`).join(' ')}`)
  }
  return result
}

async function sha256(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex')
}

const clone = value => JSON.parse(JSON.stringify(value))
const align = (value, multiple = 4) => Math.ceil(value / multiple) * multiple
const typedBuffer = values => Buffer.from(values.buffer, values.byteOffset, values.byteLength)

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

function typedArray(componentType, values) {
  const constructors = {
    5120: Int8Array,
    5121: Uint8Array,
    5122: Int16Array,
    5123: Uint16Array,
    5125: Uint32Array,
    5126: Float32Array,
  }
  const Constructor = constructors[componentType]
  if (!Constructor) throw new Error(`Unsupported component type ${componentType}`)
  return new Constructor(values)
}

function accessorSha256(componentType, values) {
  return createHash('sha256').update(typedBuffer(typedArray(componentType, values))).digest('hex')
}

function positionKey(positions, vertex) {
  return [0, 1, 2]
    .map(component => Math.round(positions[vertex * 3 + component] / POSITION_WELD_EPSILON))
    .join(',')
}

function normalizedVector(values, offset) {
  const length = Math.hypot(values[offset], values[offset + 1], values[offset + 2])
  if (length <= Number.EPSILON) return [0, 1, 0]
  return [values[offset] / length, values[offset + 1] / length, values[offset + 2] / length]
}

function vectorDot(left, right) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function cornerAngle(positions, centerVertex, leftVertex, rightVertex) {
  const centerOffset = centerVertex * 3
  const leftOffset = leftVertex * 3
  const rightOffset = rightVertex * 3
  const left = [
    positions[leftOffset] - positions[centerOffset],
    positions[leftOffset + 1] - positions[centerOffset + 1],
    positions[leftOffset + 2] - positions[centerOffset + 2],
  ]
  const right = [
    positions[rightOffset] - positions[centerOffset],
    positions[rightOffset + 1] - positions[centerOffset + 1],
    positions[rightOffset + 2] - positions[centerOffset + 2],
  ]
  const leftLength = Math.hypot(...left)
  const rightLength = Math.hypot(...right)
  if (leftLength <= Number.EPSILON || rightLength <= Number.EPSILON) return 0
  return Math.acos(Math.max(-1, Math.min(1, vectorDot(left, right) / (leftLength * rightLength))))
}

function makeRenderedNormals(positions, sourceNormals, indices) {
  const vertexCount = positions.length / 3
  const groups = new Map()
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const key = positionKey(positions, vertex)
    const vertices = groups.get(key) ?? []
    vertices.push(vertex)
    groups.set(key, vertices)
  }

  const creaseCosine = Math.cos(RENDER_NORMAL_CREASE_DEGREES * Math.PI / 180)
  const vertexClusters = Array(vertexCount)
  let multiVertexClusters = 0
  let preservedCreaseGroups = 0
  for (const vertices of groups.values()) {
    const clusters = []
    for (const vertex of vertices) {
      const sourceNormal = normalizedVector(sourceNormals, vertex * 3)
      let selected = null
      let selectedDot = -1
      for (const cluster of clusters) {
        const referenceLength = Math.hypot(...cluster.reference)
        const reference = cluster.reference.map(component => component / referenceLength)
        const dot = vectorDot(sourceNormal, reference)
        if (dot >= creaseCosine && dot > selectedDot) {
          selected = cluster
          selectedDot = dot
        }
      }
      if (!selected) {
        selected = { reference: [0, 0, 0], sum: [0, 0, 0], members: [] }
        clusters.push(selected)
      }
      selected.reference[0] += sourceNormal[0]
      selected.reference[1] += sourceNormal[1]
      selected.reference[2] += sourceNormal[2]
      selected.members.push(vertex)
      vertexClusters[vertex] = selected
    }
    multiVertexClusters += clusters.filter(cluster => cluster.members.length > 1).length
    if (clusters.length > 1) preservedCreaseGroups += 1
  }

  for (let index = 0; index < indices.length; index += 3) {
    const triangle = [indices[index], indices[index + 1], indices[index + 2]]
    const a = triangle[0] * 3
    const b = triangle[1] * 3
    const c = triangle[2] * 3
    const left = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]]
    const right = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]]
    const face = [
      left[1] * right[2] - left[2] * right[1],
      left[2] * right[0] - left[0] * right[2],
      left[0] * right[1] - left[1] * right[0],
    ]
    const faceLength = Math.hypot(...face)
    if (faceLength <= Number.EPSILON) continue
    const faceNormal = face.map(component => component / faceLength)
    for (let corner = 0; corner < 3; corner += 1) {
      const angle = cornerAngle(
        positions,
        triangle[corner],
        triangle[(corner + 1) % 3],
        triangle[(corner + 2) % 3],
      )
      const cluster = vertexClusters[triangle[corner]]
      cluster.sum[0] += faceNormal[0] * angle
      cluster.sum[1] += faceNormal[1] * angle
      cluster.sum[2] += faceNormal[2] * angle
    }
  }

  const rendered = new Float32Array(sourceNormals.length)
  let changedVertices = 0
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const cluster = vertexClusters[vertex]
    const length = Math.hypot(...cluster.sum)
    const normal = length > Number.EPSILON
      ? cluster.sum.map(component => component / length)
      : normalizedVector(sourceNormals, vertex * 3)
    const sourceNormal = normalizedVector(sourceNormals, vertex * 3)
    if (vectorDot(sourceNormal, normal) < Math.cos(0.1 * Math.PI / 180)) changedVertices += 1
    rendered.set(normal, vertex * 3)
  }

  return {
    normals: rendered,
    receipt: {
      algorithm: RENDER_NORMAL_ALGORITHM,
      creaseDegrees: RENDER_NORMAL_CREASE_DEGREES,
      positionWeldEpsilon: POSITION_WELD_EPSILON,
      duplicatePositionGroups: [...groups.values()].filter(vertices => vertices.length > 1).length,
      multiVertexClusters,
      preservedCreaseGroups,
      changedVertices,
      sourceNormalSha256: accessorSha256(5126, sourceNormals),
      renderedNormalSha256: accessorSha256(5126, rendered),
    },
  }
}

function averageJointInfluence(vertices, jointIndexes, joints, weights) {
  let influence = 0
  for (const vertex of vertices) {
    for (let component = 0; component < 4; component += 1) {
      const offset = vertex * 4 + component
      if (jointIndexes.has(joints[offset])) influence += weights[offset]
    }
  }
  return influence / vertices.length
}

function classifyBodyTriangle(vertices, positions, joints, weights) {
  const centroidY = vertices.reduce((sum, vertex) => sum + positions[vertex * 3 + 1], 0) / vertices.length
  if (averageJointInfluence(vertices, HEAD_JOINTS, joints, weights) >= 0.45) return 'identity-texture'
  if (averageJointInfluence(vertices, SHOE_JOINTS, joints, weights) >= 0.45 || centroidY < 0.105) return 'clean-shoes'
  if (averageJointInfluence(vertices, CLEAN_SKIN_JOINTS, joints, weights) >= 0.32) return 'clean-skin'
  if (centroidY < 1.185 && averageJointInfluence(vertices, UPPER_ARM_JOINTS, joints, weights) >= 0.42) {
    return 'clean-skin'
  }
  return 'clean-underlayer'
}

function splitBodyMaterialRegions(positions, joints, weights, indices) {
  const regionIndices = Object.fromEntries(BODY_REGION_ORDER.map(region => [region, []]))
  for (let index = 0; index < indices.length; index += 3) {
    const triangle = [indices[index], indices[index + 1], indices[index + 2]]
    regionIndices[classifyBodyTriangle(triangle, positions, joints, weights)].push(...triangle)
  }
  for (const region of BODY_REGION_ORDER) {
    if (regionIndices[region].length === 0) throw new Error(`Body material region ${region} produced no triangles`)
    regionIndices[region] = new Uint32Array(regionIndices[region])
  }
  return regionIndices
}

function makeSkinCollarColors(positions, skinIndices) {
  const vertexCount = positions.length / 3
  const skinVertices = new Set(skinIndices)
  const colors = new Float32Array(vertexCount * 4)
  let collarVertices = 0
  let transitionVertices = 0
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 3
    const x = positions[offset]
    const y = positions[offset + 1]
    const z = positions[offset + 2]
    const eligible = skinVertices.has(vertex)
      && Math.abs(x) <= COLLAR_MAX_ABS_X
      && z >= COLLAR_MIN_Z
      && z <= COLLAR_MAX_Z
    let skinMix = 1
    if (eligible && y < COLLAR_FADE_UPPER_Y) {
      skinMix = Math.max(0, Math.min(1, (y - COLLAR_FADE_LOWER_Y) / (COLLAR_FADE_UPPER_Y - COLLAR_FADE_LOWER_Y)))
      skinMix = skinMix * skinMix * (3 - 2 * skinMix)
      collarVertices += 1
      if (skinMix > 0 && skinMix < 1) transitionVertices += 1
    }
    const color = SKIN_COLOR.map((component, index) => (
      index === 3 ? 1 : UNDERLAYER_COLOR[index] * (1 - skinMix) + component * skinMix
    ))
    colors.set(color, vertex * 4)
  }
  return {
    colors,
    receipt: {
      algorithm: 'bounded-same-body-collar-fade-v3',
      lowerY: COLLAR_FADE_LOWER_Y,
      upperY: COLLAR_FADE_UPPER_Y,
      maxAbsX: COLLAR_MAX_ABS_X,
      minZ: COLLAR_MIN_Z,
      maxZ: COLLAR_MAX_Z,
      collarVertices,
      transitionVertices,
      treatment: 'existing same-body skin vertices below the bounded collar line fade to graphite without new geometry or overlap',
    },
  }
}

function cleanPbrMaterial(name, baseColorFactor, roughnessFactor) {
  return {
    name,
    doubleSided: true,
    pbrMetallicRoughness: {
      baseColorFactor,
      metallicFactor: 0,
      roughnessFactor,
    },
  }
}

function skeletonSignature(model) {
  const skin = model.json.skins?.[0]
  if (!skin || skin.joints?.length !== JOINT_COUNT) {
    throw new Error(`Expected one ${JOINT_COUNT}-joint skin`)
  }
  return skin.joints.map(index => {
    const node = model.json.nodes[index]
    return {
      name: node.name,
      translation: node.translation ?? null,
      rotation: node.rotation ?? null,
      scale: node.scale ?? null,
      children: node.children ?? null,
    }
  })
}

function assertNativeSibling(body, sibling, label) {
  if (JSON.stringify(skeletonSignature(body)) !== JSON.stringify(skeletonSignature(sibling))) {
    throw new Error(`${label} does not use the exact native body skeleton`)
  }
  const bodyPrimitive = body.json.meshes?.[0]?.primitives?.[0]
  const siblingPrimitive = sibling.json.meshes?.[0]?.primitives?.[0]
  if (!bodyPrimitive || !siblingPrimitive) throw new Error(`${label} is missing its skinned mesh`)
  for (const attribute of ['POSITION', 'JOINTS_0', 'WEIGHTS_0']) {
    const bodyAccessor = body.json.accessors[bodyPrimitive.attributes[attribute]]
    const siblingAccessor = sibling.json.accessors[siblingPrimitive.attributes[attribute]]
    if (bodyAccessor?.count !== siblingAccessor?.count) {
      throw new Error(`${label} ${attribute} count does not match the native body`)
    }
  }
}

function makeJacket(bodyPositions, bodyNormals, bodyJoints, bodyWeights, bodyIndices) {
  const garmentJointIndexes = new Set([9, 10, 11, 12, 13, 14, 16, 17, 18])
  const sourceToJacket = new Map()
  const positions = []
  const normals = []
  const joints = []
  const weights = []
  const sourceVertices = []
  const indices = []
  const outwardOffset = 0

  const garmentInfluence = vertex => {
    let influence = 0
    for (let component = 0; component < 4; component += 1) {
      const offset = vertex * 4 + component
      if (garmentJointIndexes.has(bodyJoints[offset])) influence += bodyWeights[offset]
    }
    return influence
  }

  const includeTriangle = (a, b, c) => {
    const vertices = [a, b, c]
    const centroid = [0, 0, 0]
    for (const vertex of vertices) {
      for (let component = 0; component < 3; component += 1) {
        centroid[component] += bodyPositions[vertex * 3 + component] / 3
      }
    }
    const y = centroid[1]
    const averageInfluence = vertices.reduce((sum, vertex) => sum + garmentInfluence(vertex), 0) / 3
    return y >= 0.88 && y <= 1.385 && averageInfluence >= 0.15
  }

  const addVertex = sourceIndex => {
    if (sourceToJacket.has(sourceIndex)) return sourceToJacket.get(sourceIndex)
    const jacketIndex = sourceToJacket.size
    sourceToJacket.set(sourceIndex, jacketIndex)
    const positionOffset = sourceIndex * 3
    const weightOffset = sourceIndex * 4
    for (let component = 0; component < 3; component += 1) {
      positions.push(bodyPositions[positionOffset + component])
      normals.push(bodyNormals[positionOffset + component])
    }
    for (let component = 0; component < 4; component += 1) {
      joints.push(bodyJoints[weightOffset + component])
      weights.push(bodyWeights[weightOffset + component])
    }
    sourceVertices.push(sourceIndex)
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
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    joints: new Uint8Array(joints),
    weights: new Float32Array(weights),
    sourceVertices: new Uint32Array(sourceVertices),
    indices: new Uint32Array(indices),
    outwardOffset,
  }
}

async function build({
  body: bodyPath,
  idle: idlePath,
  cheer: cheerPath,
  running: runningPath,
  walking: walkingPath,
  output: outputPath,
}) {
  const [body, idle, cheer, running, walking, bodyHash, idleHash, cheerHash, runningHash, walkingHash] = await Promise.all([
    readGlb(bodyPath),
    readGlb(idlePath),
    readGlb(cheerPath),
    readGlb(runningPath),
    readGlb(walkingPath),
    sha256(bodyPath),
    sha256(idlePath),
    sha256(cheerPath),
    sha256(runningPath),
    sha256(walkingPath),
  ])
  assertNativeSibling(body, idle, 'Idle export')
  assertNativeSibling(body, cheer, 'Motivational Cheer export')
  assertNativeSibling(body, running, 'Running export')
  assertNativeSibling(body, walking, 'Walking export')

  const bodyPrimitive = body.json.meshes?.[0]?.primitives?.[0]
  if (!bodyPrimitive) throw new Error('Native body is missing its primary mesh primitive')
  for (const attribute of ['POSITION', 'NORMAL', 'JOINTS_0', 'WEIGHTS_0']) {
    if (bodyPrimitive.attributes?.[attribute] === undefined) throw new Error(`Native body is missing ${attribute}`)
  }

  const json = clone(body.json)
  const binaryParts = [body.binary]
  let byteOffset = body.binary.byteLength
  json.bufferViews ??= []
  json.accessors ??= []
  json.animations = []

  const appendAccessor = (values, componentType, type, target, minimum, maximum) => {
    const padding = align(byteOffset) - byteOffset
    if (padding > 0) {
      binaryParts.push(Buffer.alloc(padding))
      byteOffset += padding
    }
    const bytes = typedBuffer(values)
    const bufferViewIndex = json.bufferViews.length
    const bufferView = { buffer: 0, byteOffset, byteLength: bytes.byteLength }
    if (target) bufferView.target = target
    json.bufferViews.push(bufferView)
    binaryParts.push(bytes)
    byteOffset += bytes.byteLength
    const componentCounts = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }
    const accessorIndex = json.accessors.length
    const accessor = { bufferView: bufferViewIndex, componentType, count: values.length / componentCounts[type], type }
    if (minimum) accessor.min = minimum
    if (maximum) accessor.max = maximum
    json.accessors.push(accessor)
    return accessorIndex
  }

  const copiedAccessorCache = new Map()
  const copyAccessor = (source, label, accessorIndex) => {
    const key = `${label}:${accessorIndex}`
    if (copiedAccessorCache.has(key)) return copiedAccessorCache.get(key)
    const { accessor, values } = readAccessor(source, accessorIndex)
    const copied = appendAccessor(typedArray(accessor.componentType, values), accessor.componentType, accessor.type, undefined, accessor.min, accessor.max)
    copiedAccessorCache.set(key, copied)
    return copied
  }

  const nativeNodeByName = new Map(json.nodes.map((node, index) => [node.name, index]))
  const copyNativeAnimation = (source, label, outputName) => {
    const animation = source.json.animations?.[0]
    if (!animation) throw new Error(`${label} has no animation`)
    const samplers = animation.samplers.map(sampler => ({
      ...clone(sampler),
      input: copyAccessor(source, label, sampler.input),
      output: copyAccessor(source, label, sampler.output),
    }))
    const channels = animation.channels.map(channel => {
      const sourceNode = source.json.nodes[channel.target.node]
      const targetNode = nativeNodeByName.get(sourceNode.name)
      if (targetNode === undefined) throw new Error(`${label} targets unknown joint ${sourceNode.name}`)
      return { ...clone(channel), target: { ...clone(channel.target), node: targetNode } }
    })
    return { name: outputName, channels, samplers }
  }

  json.animations = [
    copyNativeAnimation(idle, 'native-idle', 'Idle_02'),
    copyNativeAnimation(cheer, 'native-cheer', 'Motivational_Cheer'),
    copyNativeAnimation(running, 'native-running', 'Running'),
    copyNativeAnimation(walking, 'native-walking', 'Walking'),
  ]

  const bodyPositions = readAccessor(body, bodyPrimitive.attributes.POSITION).values
  const sourceBodyNormals = readAccessor(body, bodyPrimitive.attributes.NORMAL).values
  const bodyJoints = readAccessor(body, bodyPrimitive.attributes.JOINTS_0).values
  const bodyWeights = readAccessor(body, bodyPrimitive.attributes.WEIGHTS_0).values
  const bodyIndices = readAccessor(body, bodyPrimitive.indices).values
  const inverseBindMatrices = readAccessor(body, body.json.skins[0].inverseBindMatrices).values
  const renderedNormals = makeRenderedNormals(bodyPositions, sourceBodyNormals, bodyIndices)
  const bodyRegions = splitBodyMaterialRegions(bodyPositions, bodyJoints, bodyWeights, bodyIndices)
  const collarTransition = makeSkinCollarColors(bodyPositions, bodyRegions['clean-skin'])
  const originalBodyMaterial = clone(json.materials?.[bodyPrimitive.material ?? 0] ?? {})
  const identityPbr = clone(originalBodyMaterial.pbrMetallicRoughness ?? {})
  identityPbr.baseColorFactor = [1, 1, 1, 1]
  identityPbr.metallicFactor = 0
  identityPbr.roughnessFactor = 0.72
  json.materials = [
    {
      name: 'LifeHero_IdentityTexture',
      doubleSided: true,
      pbrMetallicRoughness: identityPbr,
      extras: { region: 'head-face-hair', source: 'paid-native-texture', emissiveRemoved: true },
    },
    cleanPbrMaterial('LifeHero_CleanSkin', [1, 1, 1, 1], 0.76),
    cleanPbrMaterial('LifeHero_CleanUnderlayer', UNDERLAYER_COLOR, 0.9),
    cleanPbrMaterial('LifeHero_CleanShoes', [0.025, 0.03, 0.04, 1], 0.8),
  ]
  json.extensionsUsed = (json.extensionsUsed ?? []).filter(extension => (
    extension !== 'KHR_materials_specular' && extension !== 'KHR_materials_ior'
  ))
  if (json.extensionsUsed.length === 0) delete json.extensionsUsed
  json.extensionsRequired = (json.extensionsRequired ?? []).filter(extension => (
    extension !== 'KHR_materials_specular' && extension !== 'KHR_materials_ior'
  ))
  if (json.extensionsRequired.length === 0) delete json.extensionsRequired

  const bodyRegionMaterialIndex = {
    'identity-texture': 0,
    'clean-skin': 1,
    'clean-underlayer': 2,
    'clean-shoes': 3,
  }
  const bodyRegionIndexAccessor = Object.fromEntries(BODY_REGION_ORDER.map(region => [
    region,
    appendAccessor(bodyRegions[region], 5125, 'SCALAR', 34963),
  ]))
  const renderedNormalAccessor = appendAccessor(renderedNormals.normals, 5126, 'VEC3', 34962)
  const skinColorAccessor = appendAccessor(collarTransition.colors, 5126, 'VEC4', 34962)
  const sharedBodyAttributes = clone(bodyPrimitive.attributes)
  sharedBodyAttributes.NORMAL = renderedNormalAccessor
  json.meshes[0].primitives = BODY_REGION_ORDER.map(region => ({
    attributes: {
      ...clone(sharedBodyAttributes),
      ...(region === 'clean-skin' ? { COLOR_0: skinColorAccessor } : {}),
    },
    indices: bodyRegionIndexAccessor[region],
    material: bodyRegionMaterialIndex[region],
    mode: bodyPrimitive.mode ?? 4,
    extras: {
      materialRegion: region,
      classifier: MATERIAL_REGION_CLASSIFIER,
      triangles: bodyRegions[region].length / 3,
    },
  }))

  const jacket = makeJacket(bodyPositions, renderedNormals.normals, bodyJoints, bodyWeights, bodyIndices)
  const jacketBounds = bounds(jacket.positions)
  const jacketPositionAccessor = appendAccessor(jacket.positions, 5126, 'VEC3', 34962, jacketBounds.minimum, jacketBounds.maximum)
  const jacketNormalAccessor = appendAccessor(jacket.normals, 5126, 'VEC3', 34962)
  const jacketJointsAccessor = appendAccessor(jacket.joints, 5121, 'VEC4', 34962)
  const jacketWeightsAccessor = appendAccessor(jacket.weights, 5126, 'VEC4', 34962)
  const jacketSourceAccessor = appendAccessor(jacket.sourceVertices, 5125, 'SCALAR', 34962)
  const jacketIndexAccessor = appendAccessor(jacket.indices, 5125, 'SCALAR', 34963)

  json.meshes[0].name = 'LifeHero_BaseBody'
  json.meshes[0].extras = {
    kind: 'body',
    neutralUnderlayerComplete: true,
    source: 'native-same-body-rig',
    materialRegionClassifier: MATERIAL_REGION_CLASSIFIER,
  }
  const jacketMaterialIndex = json.materials.length
  json.materials.push(cleanPbrMaterial('LifeHero_Jacket_Graphite', [0.11, 0.13, 0.16, 1], 0.84))
  json.meshes.push({
    name: 'LifeHero_Jacket',
    extras: { kind: 'skinned-clothing', slot: 'torso', source: 'native-body-surface', weights: 'exact-source-vertex-copy' },
    primitives: [{
      attributes: {
        POSITION: jacketPositionAccessor,
        NORMAL: jacketNormalAccessor,
        JOINTS_0: jacketJointsAccessor,
        WEIGHTS_0: jacketWeightsAccessor,
        _SOURCE_VERTEX: jacketSourceAccessor,
      },
      indices: jacketIndexAccessor,
      material: jacketMaterialIndex,
      mode: 4,
    }],
  })

  const bodyNodeIndex = json.nodes.findIndex(node => node.mesh === 0 && node.skin === 0)
  if (bodyNodeIndex < 0) throw new Error('Native body has no skinned mesh node')
  json.nodes[bodyNodeIndex].name = 'LifeHero_BaseBody'
  json.nodes[bodyNodeIndex].extras = { kind: 'body', neutralUnderlayerComplete: true, nativeRig: true }
  const jacketNodeIndex = json.nodes.length
  json.nodes.push({
    name: 'LifeHero_Jacket',
    mesh: 1,
    skin: 0,
    extras: { kind: 'skinned-clothing', slot: 'torso', runtimeToggle: true, source: 'native-body-surface' },
  })
  const parentNode = json.nodes.find(node => node.children?.includes(bodyNodeIndex))
  if (!parentNode) throw new Error('Native body mesh node has no parent')
  parentNode.children.push(jacketNodeIndex)

  json.asset.extras = {
    schema: 'life-hero-concept-glb/v4',
    scope: 'KAN-257 approval proof; not production wardrobe readiness',
    bodySourceSha256: bodyHash,
    nativeIdleSourceSha256: idleHash,
    nativeCheerSourceSha256: cheerHash,
    nativeRunningSourceSha256: runningHash,
    nativeWalkingSourceSha256: walkingHash,
    skinning: 'native same-body skin retained without transferred joints, inverse binds, or body weights',
    jacket: 'separate mesh using exact JOINTS_0 and WEIGHTS_0 copied from mapped native body vertices',
    animation: 'Idle_02, Motivational_Cheer, Running, and Walking are native same-body animation exports',
    materialCorrection: {
      classifier: MATERIAL_REGION_CLASSIFIER,
      regions: BODY_REGION_ORDER,
      identity: 'paid native texture retained only for head, face, and hair with emissive disabled',
      cleanPbr: 'skin, neutral underlayer, shoes, and graphite jacket use texture-free rough PBR materials',
      necklineTransition: collarTransition.receipt,
    },
    normalSmoothing: {
      ...renderedNormals.receipt,
      sourceNormalAccessor: bodyPrimitive.attributes.NORMAL,
      renderedNormalAccessor,
      boundaryRule: 'weld only position-identical vertices whose source normals remain within the crease threshold',
    },
    immutableAccessors: {
      positionSha256: accessorSha256(5126, bodyPositions),
      jointsSha256: accessorSha256(body.json.accessors[bodyPrimitive.attributes.JOINTS_0].componentType, bodyJoints),
      weightsSha256: accessorSha256(5126, bodyWeights),
      inverseBindMatricesSha256: accessorSha256(5126, inverseBindMatrices),
    },
  }

  const binary = Buffer.concat(binaryParts)
  json.buffers = [{ byteLength: binary.byteLength }]
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeGlb(outputPath, json, binary)
  return {
    output: outputPath,
    sourceBodySha256: bodyHash,
    sourceIdleSha256: idleHash,
    sourceCheerSha256: cheerHash,
    sourceRunningSha256: runningHash,
    sourceWalkingSha256: walkingHash,
    bodyVertices: bodyPositions.length / 3,
    bodyTriangles: bodyIndices.length / 3,
    bodyMaterialRegions: Object.fromEntries(BODY_REGION_ORDER.map(region => [region, bodyRegions[region].length / 3])),
    normalSmoothing: renderedNormals.receipt,
    necklineTransition: collarTransition.receipt,
    jacketVertices: jacket.positions.length / 3,
    jacketTriangles: jacket.indices.length / 3,
    jacketOutwardOffset: jacket.outwardOffset,
    clips: REQUIRED_CLIPS,
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
