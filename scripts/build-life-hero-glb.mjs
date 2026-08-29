import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { inspectGlbJson, readAccessor, readGlb, writeGlb } from './lib/glb.mjs'

const REQUIRED_CLIPS = ['Idle_02', 'Motivational_Cheer', 'Running', 'Walking']
const JOINT_COUNT = 24
const JACKET_MIN_Y = 0.88
const JACKET_MAX_Y = 1.385
const JACKET_JOINTS = new Set([9, 10, 11, 12, 13, 14, 16, 17, 18])
const JACKET_OFFSET = 0.004
const SOURCE_SCHEMA = 'life-hero-concept-glb/v5-max-quality'

const clone = value => JSON.parse(JSON.stringify(value))
const align = (value, multiple = 4) => Math.ceil(value / multiple) * multiple
const typedBuffer = values => Buffer.from(values.buffer, values.byteOffset, values.byteLength)

function parseArguments(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith('--') || !value) throw new Error(`Invalid argument near ${name ?? 'end'}`)
    result[name.slice(2)] = value
  }
  const required = ['source', 'output']
  const missing = required.filter(name => !result[name])
  if (missing.length > 0) throw new Error(`Missing ${missing.join(', ')}. Required: ${required.map(name => `--${name} <file>`).join(' ')}`)
  return result
}

async function sha256(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex')
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

function accessorSha256(model, accessorIndex) {
  const { accessor, values } = readAccessor(model, accessorIndex)
  return createHash('sha256').update(typedBuffer(typedArray(accessor.componentType, values))).digest('hex')
}

function bounds(values) {
  const minimum = [Infinity, Infinity, Infinity]
  const maximum = [-Infinity, -Infinity, -Infinity]
  for (let index = 0; index < values.length; index += 3) {
    for (let component = 0; component < 3; component += 1) {
      minimum[component] = Math.min(minimum[component], values[index + component])
      maximum[component] = Math.max(maximum[component], values[index + component])
    }
  }
  return { minimum, maximum }
}

function normalize(values, offset) {
  const length = Math.hypot(values[offset], values[offset + 1], values[offset + 2])
  return length > Number.EPSILON
    ? [values[offset] / length, values[offset + 1] / length, values[offset + 2] / length]
    : [0, 1, 0]
}

function compactDuplicateImage(model) {
  const json = clone(model.json)
  if (json.images?.length !== 2 || json.textures?.length !== 2) {
    throw new Error('Expected exactly two embedded Meshy images/textures for lossless deduplication')
  }
  const baseColorTextureIndex = json.materials?.[0]?.pbrMetallicRoughness?.baseColorTexture?.index
  const baseColorImageIndex = json.textures[baseColorTextureIndex]?.source
  const duplicateImageIndex = baseColorImageIndex === 0 ? 1 : 0
  const baseColorImage = json.images[baseColorImageIndex]
  const duplicateImage = json.images[duplicateImageIndex]
  const baseColorViewIndex = baseColorImage.bufferView
  const duplicateViewIndex = duplicateImage.bufferView
  if (baseColorViewIndex === undefined || duplicateViewIndex === undefined) {
    throw new Error('Embedded Meshy images must use buffer views')
  }

  const bufferParts = []
  const viewMap = new Map()
  let byteOffset = 0
  for (let sourceViewIndex = 0; sourceViewIndex < (model.json.bufferViews ?? []).length; sourceViewIndex += 1) {
    if (sourceViewIndex === duplicateViewIndex) continue
    const sourceView = model.json.bufferViews[sourceViewIndex]
    const padding = align(byteOffset) - byteOffset
    if (padding > 0) {
      bufferParts.push(Buffer.alloc(padding))
      byteOffset += padding
    }
    const start = sourceView.byteOffset ?? 0
    const bytes = model.binary.subarray(start, start + sourceView.byteLength)
    viewMap.set(sourceViewIndex, bufferParts.length)
    bufferParts.push(bytes)
    byteOffset += bytes.byteLength
  }
  const compactIndexBySource = new Map()
  let compactIndex = 0
  for (let sourceIndex = 0; sourceIndex < (model.json.bufferViews ?? []).length; sourceIndex += 1) {
    if (sourceIndex === duplicateViewIndex) continue
    compactIndexBySource.set(sourceIndex, compactIndex)
    compactIndex += 1
  }
  const offsetBySource = new Map()
  let runningOffset = 0
  for (let sourceIndex = 0; sourceIndex < (model.json.bufferViews ?? []).length; sourceIndex += 1) {
    if (sourceIndex === duplicateViewIndex) continue
    runningOffset = align(runningOffset)
    offsetBySource.set(sourceIndex, runningOffset)
    runningOffset += model.json.bufferViews[sourceIndex].byteLength
  }
  json.bufferViews = model.json.bufferViews
    .map((view, sourceIndex) => ({ ...view, byteOffset: offsetBySource.get(sourceIndex) }))
    .filter((_view, sourceIndex) => sourceIndex !== duplicateViewIndex)
  for (const accessor of json.accessors ?? []) {
    if (accessor.bufferView !== undefined) accessor.bufferView = compactIndexBySource.get(accessor.bufferView)
  }
  json.images = [{
    ...clone(baseColorImage),
    name: 'LifeHero_Identity_8K_Deduped',
    bufferView: compactIndexBySource.get(baseColorViewIndex),
  }]
  json.textures = [{ ...clone(json.textures[baseColorTextureIndex]), source: 0 }]
  const material = json.materials?.[0]
  if (!material) throw new Error('Native source has no material')
  material.name = 'LifeHero_MaxQuality_PBR'
  material.alphaMode = 'OPAQUE'
  delete material.alphaCutoff
  delete material.emissiveFactor
  delete material.emissiveTexture
  delete material.extensions
  material.pbrMetallicRoughness = {
    ...material.pbrMetallicRoughness,
    baseColorTexture: { index: 0 },
    metallicFactor: 0,
    roughnessFactor: 0.62,
  }
  json.buffers = [{ byteLength: runningOffset }]
  return {
    json,
    binary: Buffer.concat(bufferParts),
    receipt: {
      algorithm: 'pixel-identical-embedded-image-dedup-v1',
      retainedImageIndex: baseColorImageIndex,
      removedImageIndex: duplicateImageIndex,
      retainedResolution: '8192x8192',
      retainedBytes: model.json.bufferViews[baseColorViewIndex].byteLength,
      removedBytes: model.json.bufferViews[duplicateViewIndex].byteLength,
    },
  }
}

function assertNativeSource(model) {
  if (model.json.asset?.version !== '2.0') throw new Error('source must be glTF 2.0')
  if ((model.json.skins ?? []).length !== 1 || model.json.skins[0].joints?.length !== JOINT_COUNT) {
    throw new Error(`source must expose one ${JOINT_COUNT}-joint skin`)
  }
  const mesh = model.json.meshes?.[0]
  const primitive = mesh?.primitives?.[0]
  if (!primitive) throw new Error('source must expose one body primitive')
  for (const attribute of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0']) {
    if (primitive.attributes?.[attribute] === undefined) throw new Error(`source is missing ${attribute}`)
  }
  const clipNames = (model.json.animations ?? []).map(animation => animation.name)
  if (JSON.stringify(clipNames) !== JSON.stringify(REQUIRED_CLIPS)) {
    throw new Error(`source clips must be exactly ${REQUIRED_CLIPS.join(', ')}`)
  }
  return { mesh, primitive }
}

function makeJacket(positions, normals, joints, weights, bodyIndices) {
  const sourceToJacket = new Map()
  const jacketPositions = []
  const jacketNormals = []
  const jacketJoints = []
  const jacketWeights = []
  const sourceVertices = []
  const jacketIndices = []
  const influence = vertex => {
    let total = 0
    for (let component = 0; component < 4; component += 1) {
      const offset = vertex * 4 + component
      if (JACKET_JOINTS.has(joints[offset])) total += weights[offset]
    }
    return total
  }
  const addVertex = sourceVertex => {
    const existing = sourceToJacket.get(sourceVertex)
    if (existing !== undefined) return existing
    const jacketVertex = sourceToJacket.size
    sourceToJacket.set(sourceVertex, jacketVertex)
    const positionOffset = sourceVertex * 3
    const weightOffset = sourceVertex * 4
    const normal = normalize(normals, positionOffset)
    jacketPositions.push(
      positions[positionOffset] + normal[0] * JACKET_OFFSET,
      positions[positionOffset + 1] + normal[1] * JACKET_OFFSET,
      positions[positionOffset + 2] + normal[2] * JACKET_OFFSET,
    )
    jacketNormals.push(...normal)
    for (let component = 0; component < 4; component += 1) {
      jacketJoints.push(joints[weightOffset + component])
      jacketWeights.push(weights[weightOffset + component])
    }
    sourceVertices.push(sourceVertex)
    return jacketVertex
  }
  for (let index = 0; index < bodyIndices.length; index += 3) {
    const triangle = [bodyIndices[index], bodyIndices[index + 1], bodyIndices[index + 2]]
    const centroidY = triangle.reduce((sum, vertex) => sum + positions[vertex * 3 + 1], 0) / 3
    const garmentInfluence = triangle.reduce((sum, vertex) => sum + influence(vertex), 0) / 3
    if (centroidY < JACKET_MIN_Y || centroidY > JACKET_MAX_Y || garmentInfluence < 0.15) continue
    jacketIndices.push(...triangle.map(addVertex))
  }
  if (jacketIndices.length === 0) throw new Error('jacket extraction produced no geometry')
  return {
    positions: new Float32Array(jacketPositions),
    normals: new Float32Array(jacketNormals),
    joints: new Uint8Array(jacketJoints),
    weights: new Float32Array(jacketWeights),
    sourceVertices: new Uint32Array(sourceVertices),
    indices: new Uint32Array(jacketIndices),
  }
}

function cleanMaterial(name, baseColorFactor, roughnessFactor) {
  return {
    name,
    doubleSided: true,
    pbrMetallicRoughness: { baseColorFactor, metallicFactor: 0, roughnessFactor },
  }
}

async function build({ source: sourcePath, output: outputPath }) {
  const source = await readGlb(sourcePath)
  const sourceHash = await sha256(sourcePath)
  const { primitive } = assertNativeSource(source)
  const compacted = compactDuplicateImage(source)
  const json = compacted.json
  const binaryParts = [compacted.binary]
  let byteOffset = compacted.binary.byteLength
  json.bufferViews ??= []
  json.accessors ??= []
  const appendAccessor = (values, componentType, type, target, minimum, maximum) => {
    const padding = align(byteOffset) - byteOffset
    if (padding > 0) {
      binaryParts.push(Buffer.alloc(padding))
      byteOffset += padding
    }
    const bytes = typedBuffer(values)
    const bufferView = json.bufferViews.length
    json.bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.byteLength, ...(target ? { target } : {}) })
    binaryParts.push(bytes)
    byteOffset += bytes.byteLength
    const componentCounts = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }
    const accessor = json.accessors.length
    json.accessors.push({ bufferView, componentType, count: values.length / componentCounts[type], type, ...(minimum ? { min: minimum } : {}), ...(maximum ? { max: maximum } : {}) })
    return accessor
  }

  const bodyPositions = readAccessor(source, primitive.attributes.POSITION).values
  const bodyNormals = readAccessor(source, primitive.attributes.NORMAL).values
  const bodyJoints = readAccessor(source, primitive.attributes.JOINTS_0).values
  const bodyWeights = readAccessor(source, primitive.attributes.WEIGHTS_0).values
  const bodyIndices = readAccessor(source, primitive.indices).values
  const jacket = makeJacket(bodyPositions, bodyNormals, bodyJoints, bodyWeights, bodyIndices)
  const jacketBounds = bounds(jacket.positions)
  const jacketPositionAccessor = appendAccessor(jacket.positions, 5126, 'VEC3', 34962, jacketBounds.minimum, jacketBounds.maximum)
  const jacketNormalAccessor = appendAccessor(jacket.normals, 5126, 'VEC3', 34962)
  const jacketJointsAccessor = appendAccessor(jacket.joints, 5121, 'VEC4', 34962)
  const jacketWeightsAccessor = appendAccessor(jacket.weights, 5126, 'VEC4', 34962)
  const jacketSourceAccessor = appendAccessor(jacket.sourceVertices, 5125, 'SCALAR', 34962)
  const jacketIndexAccessor = appendAccessor(jacket.indices, 5125, 'SCALAR', 34963)

  const bodyNodeIndex = json.nodes.findIndex(node => node.mesh === 0 && node.skin === 0)
  if (bodyNodeIndex < 0) throw new Error('source has no skinned body node')
  json.meshes[0].name = 'LifeHero_BaseBody'
  json.meshes[0].extras = { kind: 'body', qualityTier: 'max-quality', neutralUnderlayerComplete: true, source: 'Meshy-native-same-body-rig' }
  json.meshes[0].primitives[0].extras = { materialRegion: 'full-native-textured-body', source: 'unchanged-native-geometry' }
  json.nodes[bodyNodeIndex].name = 'LifeHero_BaseBody'
  json.nodes[bodyNodeIndex].extras = { kind: 'body', qualityTier: 'max-quality', neutralUnderlayerComplete: true }
  const jacketMaterialIndex = json.materials.length
  json.materials.push(cleanMaterial('LifeHero_Jacket_Graphite_Concept', [0.105, 0.125, 0.15, 1], 0.86))
  json.meshes.push({
    name: 'LifeHero_Jacket',
    extras: { kind: 'skinned-clothing', slot: 'torso', source: 'native-body-surface-offset-shell', weights: 'exact-native-source-vertex-copy', conceptOnly: true },
    primitives: [{
      attributes: { POSITION: jacketPositionAccessor, NORMAL: jacketNormalAccessor, JOINTS_0: jacketJointsAccessor, WEIGHTS_0: jacketWeightsAccessor, _SOURCE_VERTEX: jacketSourceAccessor },
      indices: jacketIndexAccessor,
      material: jacketMaterialIndex,
      mode: 4,
    }],
  })
  const jacketNodeIndex = json.nodes.length
  json.nodes.push({ name: 'LifeHero_Jacket', mesh: 1, skin: 0, extras: { kind: 'skinned-clothing', slot: 'torso', runtimeToggle: true, conceptOnly: true } })
  const parentNode = json.nodes.find(node => node.children?.includes(bodyNodeIndex))
  if (!parentNode) throw new Error('source body mesh has no parent node')
  parentNode.children.push(jacketNodeIndex)

  const inverseBindAccessor = source.json.skins[0].inverseBindMatrices
  json.asset.extras = {
    schema: SOURCE_SCHEMA,
    scope: 'KAN-257 approval proof; not production wardrobe readiness',
    qualityTier: 'max-quality-primary',
    sourceMergedAnimationsSha256: sourceHash,
    sourceGeometry: 'Meshy native same-body rig; source POSITION, NORMAL, JOINTS_0, WEIGHTS_0, inverse binds and animation values preserved',
    nativeTriangleCount: bodyIndices.length / 3,
    nativeVertexCount: bodyPositions.length / 3,
    skinning: `one native ${JOINT_COUNT}-joint skin shared by body and jacket`,
    animation: REQUIRED_CLIPS.join(', '),
    materials: { algorithm: 'opaque-natural-PBR-v1', identityTexture: 'one retained pixel-identical 8192x8192 base-color image; emissive removed', jacket: 'separate texture-free graphite concept shell; not final authored clothing' },
    textureDeduplication: compacted.receipt,
    jacket: { source: 'exact native body triangles and vertex joints/weights', sourceVertexAccessor: '_SOURCE_VERTEX', outwardOffset: JACKET_OFFSET, regionY: [JACKET_MIN_Y, JACKET_MAX_Y] },
    immutableAccessors: {
      positionSha256: accessorSha256(source, primitive.attributes.POSITION),
      normalSha256: accessorSha256(source, primitive.attributes.NORMAL),
      jointsSha256: accessorSha256(source, primitive.attributes.JOINTS_0),
      weightsSha256: accessorSha256(source, primitive.attributes.WEIGHTS_0),
      inverseBindMatricesSha256: accessorSha256(source, inverseBindAccessor),
      indicesSha256: accessorSha256(source, primitive.indices),
    },
    fallback: { asset: 'life-hero-modular-fallback.glb', selection: 'navigator.deviceMemory <= 4 or navigator.hardwareConcurrency <= 4', qualityTier: 'constrained-31k-triangle-capability-fallback' },
  }
  const binary = Buffer.concat(binaryParts)
  json.buffers = [{ byteLength: binary.byteLength }]
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeGlb(outputPath, json, binary)
  return {
    output: outputPath,
    sourceSha256: sourceHash,
    sourceBytes: (await readFile(sourcePath)).byteLength,
    outputBytes: binary.byteLength,
    sourceVertices: bodyPositions.length / 3,
    sourceTriangles: bodyIndices.length / 3,
    jacketVertices: jacket.positions.length / 3,
    jacketTriangles: jacket.indices.length / 3,
    clips: REQUIRED_CLIPS,
    textureDeduplication: compacted.receipt,
    immutableAccessors: json.asset.extras.immutableAccessors,
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
