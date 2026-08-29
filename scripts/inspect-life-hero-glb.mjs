import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { inspectGlbJson, readAccessor, readGlb } from './lib/glb.mjs'

export const REQUIRED_LIFE_HERO_CLIPS = ['Idle_02', 'Motivational_Cheer', 'Running', 'Walking']
const MAX_SCHEMA = 'life-hero-concept-glb/v5-max-quality'

function typedBuffer(componentType, values) {
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
  const typed = new Constructor(values)
  return Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength)
}

function accessorSha256(model, accessorIndex) {
  const { accessor, values } = readAccessor(model, accessorIndex)
  return createHash('sha256').update(typedBuffer(accessor.componentType, values)).digest('hex')
}

function hasEmissive(material) {
  return Boolean(material?.emissiveTexture !== undefined
    || material?.emissiveFactor?.some(component => component !== 0))
}

function inspectMaxQuality(model, errors) {
  const extras = model.json.asset?.extras ?? {}
  const baseNode = model.json.nodes?.find(node => node.name === 'LifeHero_BaseBody' && node.mesh !== undefined)
  const jacketNode = model.json.nodes?.find(node => node.name === 'LifeHero_Jacket' && node.mesh !== undefined)
  const baseMesh = model.json.meshes?.[baseNode?.mesh]
  const jacketMesh = model.json.meshes?.[jacketNode?.mesh]
  const basePrimitive = baseMesh?.primitives?.[0]
  const jacketPrimitive = jacketMesh?.primitives?.[0]
  const summary = inspectGlbJson(model.json)
  if (extras.schema !== MAX_SCHEMA) errors.push(`asset schema must be ${MAX_SCHEMA}`)
  if (!baseNode || !jacketNode) errors.push('base and jacket must be separate named mesh nodes')
  if (baseNode?.skin !== 0 || jacketNode?.skin !== 0) errors.push('base and jacket must share skin 0')
  if (!basePrimitive || !jacketPrimitive) errors.push('base and jacket must each have a primitive')
  if (model.json.skins?.length !== 1 || model.json.skins[0]?.joints?.length !== 24) errors.push('asset must expose one 24-joint skin')
  const clips = summary.animations.map(animation => animation.name)
  if (JSON.stringify(clips) !== JSON.stringify(REQUIRED_LIFE_HERO_CLIPS)) errors.push(`clips must be ${REQUIRED_LIFE_HERO_CLIPS.join(', ')}`)
  const baseGeometry = basePrimitive
    ? { vertices: readAccessor(model, basePrimitive.attributes.POSITION).accessor.count, triangles: readAccessor(model, basePrimitive.indices).accessor.count / 3 }
    : null
  const jacketGeometry = jacketPrimitive
    ? { vertices: readAccessor(model, jacketPrimitive.attributes.POSITION).accessor.count, triangles: readAccessor(model, jacketPrimitive.indices).accessor.count / 3 }
    : null
  if (baseGeometry?.vertices !== extras.nativeVertexCount || baseGeometry?.triangles !== extras.nativeTriangleCount) errors.push('max-quality base geometry counts drifted')
  if (!jacketGeometry || jacketGeometry.vertices === 0 || jacketGeometry.triangles === 0) errors.push('jacket geometry is empty')
  for (const primitive of [basePrimitive, jacketPrimitive]) {
    for (const attribute of ['JOINTS_0', 'WEIGHTS_0']) {
      if (primitive?.attributes?.[attribute] === undefined) errors.push('all body/clothing primitives must be skinned')
    }
  }

  const baseMaterial = model.json.materials?.[basePrimitive?.material]
  const jacketMaterial = model.json.materials?.[jacketPrimitive?.material]
  if (baseMaterial?.alphaMode !== 'OPAQUE' || hasEmissive(baseMaterial) || baseMaterial?.extensions) errors.push('base material must be opaque natural PBR without emissive/specular extensions')
  if (baseMaterial?.pbrMetallicRoughness?.baseColorTexture?.index !== 0) errors.push('base material must use retained texture 0')
  if (jacketMaterial?.name !== 'LifeHero_Jacket_Graphite_Concept' || jacketMaterial?.pbrMetallicRoughness?.baseColorTexture || hasEmissive(jacketMaterial)) errors.push('jacket must use one texture-free non-emissive concept PBR material')
  if (model.json.images?.length !== 1 || model.json.textures?.length !== 1 || extras.textureDeduplication?.retainedResolution !== '8192x8192') errors.push('asset must retain one deduplicated 8192x8192 image')

  let jacketWeightCopiesVerified = false
  if (basePrimitive && jacketPrimitive && jacketPrimitive.attributes._SOURCE_VERTEX !== undefined) {
    const sourceVertices = readAccessor(model, jacketPrimitive.attributes._SOURCE_VERTEX).values
    const baseJoints = readAccessor(model, basePrimitive.attributes.JOINTS_0).values
    const baseWeights = readAccessor(model, basePrimitive.attributes.WEIGHTS_0).values
    const jacketJoints = readAccessor(model, jacketPrimitive.attributes.JOINTS_0).values
    const jacketWeights = readAccessor(model, jacketPrimitive.attributes.WEIGHTS_0).values
    jacketWeightCopiesVerified = sourceVertices.every((sourceVertex, jacketVertex) => {
      if (!Number.isInteger(sourceVertex) || sourceVertex < 0 || sourceVertex * 4 + 3 >= baseJoints.length) return false
      for (let component = 0; component < 4; component += 1) {
        if (jacketJoints[jacketVertex * 4 + component] !== baseJoints[sourceVertex * 4 + component]) return false
        if (jacketWeights[jacketVertex * 4 + component] !== baseWeights[sourceVertex * 4 + component]) return false
      }
      return true
    })
  }
  if (!jacketWeightCopiesVerified) errors.push('jacket JOINTS_0 and WEIGHTS_0 must exactly match mapped native body vertices')

  const immutableAccessors = extras.immutableAccessors ?? {}
  const immutableVerified = basePrimitive && Object.entries({
    positionSha256: basePrimitive.attributes.POSITION,
    normalSha256: basePrimitive.attributes.NORMAL,
    jointsSha256: basePrimitive.attributes.JOINTS_0,
    weightsSha256: basePrimitive.attributes.WEIGHTS_0,
    indicesSha256: basePrimitive.indices,
  }).every(([key, accessor]) => accessorSha256(model, accessor) === immutableAccessors[key])
    && accessorSha256(model, model.json.skins[0].inverseBindMatrices) === immutableAccessors.inverseBindMatricesSha256
  if (!immutableVerified) errors.push('native geometry, skin, indices, or inverse-bind accessor hashes drifted')

  return {
    qualityTier: extras.qualityTier ?? null,
    baseGeometry,
    jacketGeometry,
    jacketWeightCopiesVerified,
    immutableVerified,
    material: {
      base: baseMaterial?.name ?? null,
      jacket: jacketMaterial?.name ?? null,
      baseOpaque: baseMaterial?.alphaMode === 'OPAQUE',
      baseEmissive: hasEmissive(baseMaterial),
    },
    textureDeduplication: extras.textureDeduplication ?? null,
  }
}

export async function inspectLifeHeroGlb(filePath) {
  const model = await readGlb(filePath)
  const summary = inspectGlbJson(model.json)
  const errors = []
  if (summary.version !== '2.0') errors.push('asset must be glTF 2.0')
  const quality = model.json.asset?.extras?.schema === MAX_SCHEMA
    ? inspectMaxQuality(model, errors)
    : { qualityTier: 'legacy-fallback', baseGeometry: null, jacketGeometry: null, jacketWeightCopiesVerified: null, immutableVerified: null, material: null, textureDeduplication: null }
  const bytes = await readFile(filePath)
  return {
    filePath,
    byteLength: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    valid: errors.length === 0,
    errors,
    summary,
    ...quality,
    contract: model.json.asset?.extras ?? null,
  }
}

const isCli = process.argv[1] === fileURLToPath(import.meta.url)
if (isCli) {
  const filePath = process.argv[2]
  if (!filePath) {
    process.stderr.write('Usage: node scripts/inspect-life-hero-glb.mjs <life-hero.glb>\n')
    process.exitCode = 1
  } else {
    try {
      const result = await inspectLifeHeroGlb(filePath)
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
      if (!result.valid) process.exitCode = 1
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
      process.exitCode = 1
    }
  }
}
