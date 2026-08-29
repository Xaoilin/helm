import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { inspectGlbJson, readAccessor, readGlb, writeGlb } from './lib/glb.mjs'

const REQUIRED_CLIPS = ['Idle_02', 'Motivational_Cheer', 'Running', 'Walking']
const JOINT_COUNT = 24

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
  const colors = []
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
    const sourceX = bodyPositions[positionOffset]
    const sourceY = bodyPositions[positionOffset + 1]
    const sourceZ = bodyPositions[positionOffset + 2]
    for (let component = 0; component < 3; component += 1) {
      positions.push(bodyPositions[positionOffset + component])
      normals.push(bodyNormals[positionOffset + component])
    }
    for (let component = 0; component < 4; component += 1) {
      joints.push(bodyJoints[weightOffset + component])
      weights.push(bodyWeights[weightOffset + component])
    }
    const frontTrim = sourceZ > 0.015 && Math.abs(sourceX) < 0.035 && sourceY < 1.33
    const collarTrim = sourceZ > 0 && sourceY > 1.315
    const hemTrim = sourceY < 0.915
    colors.push(...(frontTrim || collarTrim || hemTrim
      ? [0.025, 0.03, 0.04, 1]
      : [0.18, 0.2, 0.23, 1]))
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
    colors: new Float32Array(colors),
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
  const bodyNormals = readAccessor(body, bodyPrimitive.attributes.NORMAL).values
  const bodyJoints = readAccessor(body, bodyPrimitive.attributes.JOINTS_0).values
  const bodyWeights = readAccessor(body, bodyPrimitive.attributes.WEIGHTS_0).values
  const bodyIndices = readAccessor(body, bodyPrimitive.indices).values
  const jacket = makeJacket(bodyPositions, bodyNormals, bodyJoints, bodyWeights, bodyIndices)
  const jacketBounds = bounds(jacket.positions)
  const jacketPositionAccessor = appendAccessor(jacket.positions, 5126, 'VEC3', 34962, jacketBounds.minimum, jacketBounds.maximum)
  const jacketNormalAccessor = appendAccessor(jacket.normals, 5126, 'VEC3', 34962)
  const jacketJointsAccessor = appendAccessor(jacket.joints, 5121, 'VEC4', 34962)
  const jacketWeightsAccessor = appendAccessor(jacket.weights, 5126, 'VEC4', 34962)
  const jacketColorAccessor = appendAccessor(jacket.colors, 5126, 'VEC4', 34962)
  const jacketSourceAccessor = appendAccessor(jacket.sourceVertices, 5125, 'SCALAR', 34962)
  const jacketIndexAccessor = appendAccessor(jacket.indices, 5125, 'SCALAR', 34963)

  json.meshes[0].name = 'LifeHero_BaseBody'
  json.meshes[0].extras = { kind: 'body', neutralUnderlayerComplete: true, source: 'native-same-body-rig' }
  const jacketMaterialIndex = json.materials.length
  json.materials.push({
    name: 'LifeHero_Jacket_Graphite',
    doubleSided: true,
    pbrMetallicRoughness: {
      baseColorFactor: [1, 1, 1, 1],
      metallicFactor: 0.05,
      roughnessFactor: 0.78,
    },
  })
  json.meshes.push({
    name: 'LifeHero_Jacket',
    extras: { kind: 'skinned-clothing', slot: 'torso', source: 'native-body-surface', weights: 'exact-source-vertex-copy' },
    primitives: [{
      attributes: {
        POSITION: jacketPositionAccessor,
        NORMAL: jacketNormalAccessor,
        JOINTS_0: jacketJointsAccessor,
        WEIGHTS_0: jacketWeightsAccessor,
        COLOR_0: jacketColorAccessor,
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
    schema: 'life-hero-concept-glb/v2',
    scope: 'KAN-257 approval proof; not production wardrobe readiness',
    bodySourceSha256: bodyHash,
    nativeIdleSourceSha256: idleHash,
    nativeCheerSourceSha256: cheerHash,
    nativeRunningSourceSha256: runningHash,
    nativeWalkingSourceSha256: walkingHash,
    skinning: 'native same-body skin retained without transferred joints, inverse binds, or body weights',
    jacket: 'separate mesh using exact JOINTS_0 and WEIGHTS_0 copied from mapped native body vertices',
    animation: 'Idle_02, Motivational_Cheer, Running, and Walking are native same-body animation exports',
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
