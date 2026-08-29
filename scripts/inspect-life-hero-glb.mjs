import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { inspectGlbJson, readAccessor, readGlb } from './lib/glb.mjs'

export const REQUIRED_LIFE_HERO_CLIPS = ['Idle_02', 'Motivational_Cheer', 'Running', 'Walking']
const REQUIRED_BODY_MATERIAL_REGIONS = [
  ['identity-texture', 'LifeHero_IdentityTexture', true],
  ['clean-skin', 'LifeHero_CleanSkin', false],
  ['clean-underlayer', 'LifeHero_CleanUnderlayer', false],
  ['clean-shoes', 'LifeHero_CleanShoes', false],
]

function hasVisibleEmissive(material) {
  return Boolean(material?.emissiveTexture !== undefined
    || material?.emissiveFactor?.some(component => component !== 0)
  )
}

export async function inspectLifeHeroGlb(filePath) {
  const model = await readGlb(filePath)
  const summary = inspectGlbJson(model.json)
  const baseNode = summary.meshNodes.find(node => node.name === 'LifeHero_BaseBody')
  const jacketNode = summary.meshNodes.find(node => node.name === 'LifeHero_Jacket')
  const errors = []
  if (summary.version !== '2.0') errors.push('asset must be glTF 2.0')
  if (summary.skins.length !== 1 || summary.skins[0].joints !== 24) {
    errors.push('asset must expose one 24-joint skin')
  }
  if (!baseNode || !jacketNode) errors.push('base body and jacket must be separate named mesh nodes')
  if (baseNode?.skin !== 0 || jacketNode?.skin !== 0) errors.push('base body and jacket must share skin 0')
  const clipNames = summary.animations.map(animation => animation.name)
  if (JSON.stringify(clipNames) !== JSON.stringify(REQUIRED_LIFE_HERO_CLIPS)) {
    errors.push(`animation clips must be exactly ${REQUIRED_LIFE_HERO_CLIPS.join(', ')}`)
  }
  for (const mesh of model.json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      if (primitive.attributes?.JOINTS_0 === undefined || primitive.attributes?.WEIGHTS_0 === undefined) {
        errors.push(`${mesh.name ?? 'unnamed mesh'} is not skinned`)
      }
    }
  }

  const basePrimitives = model.json.meshes?.[baseNode?.mesh]?.primitives ?? []
  const basePrimitive = basePrimitives[0]
  const jacketPrimitive = model.json.meshes?.[jacketNode?.mesh]?.primitives?.[0]
  const materialRegions = basePrimitives.map(primitive => {
    const material = model.json.materials?.[primitive.material]
    const indices = readAccessor(model, primitive.indices).accessor
    return {
      region: primitive.extras?.materialRegion ?? null,
      classifier: primitive.extras?.classifier ?? null,
      material: material?.name ?? null,
      triangles: indices.count / 3,
      textured: material?.pbrMetallicRoughness?.baseColorTexture !== undefined,
      emissive: hasVisibleEmissive(material),
    }
  })
  let cleanMaterialRegionsVerified = true
  if (basePrimitives.length !== REQUIRED_BODY_MATERIAL_REGIONS.length) {
    errors.push('base body must expose four deterministic material primitives')
    cleanMaterialRegionsVerified = false
  }
  const sharedAttributes = JSON.stringify(basePrimitive?.attributes ?? null)
  for (let index = 0; index < REQUIRED_BODY_MATERIAL_REGIONS.length; index += 1) {
    const [expectedRegion, expectedMaterial, expectedTextured] = REQUIRED_BODY_MATERIAL_REGIONS[index]
    const actual = materialRegions[index]
    const primitive = basePrimitives[index]
    if (!actual || actual.region !== expectedRegion || actual.material !== expectedMaterial
      || actual.textured !== expectedTextured || actual.emissive
      || actual.classifier !== 'native-joints-position-v1'
      || JSON.stringify(primitive?.attributes ?? null) !== sharedAttributes) {
      errors.push(`base material region ${expectedRegion} is not the deterministic clean PBR contract`)
      cleanMaterialRegionsVerified = false
    }
  }
  const totalBodyTriangles = materialRegions.reduce((sum, region) => sum + region.triangles, 0)
  if (totalBodyTriangles !== 174_754) {
    errors.push(`base material regions must preserve 174754 native triangles, found ${totalBodyTriangles}`)
    cleanMaterialRegionsVerified = false
  }
  const jacketMaterial = model.json.materials?.[jacketPrimitive?.material]
  if (jacketMaterial?.name !== 'LifeHero_Jacket_Graphite'
    || jacketPrimitive?.attributes?.COLOR_0 !== undefined
    || jacketMaterial?.pbrMetallicRoughness?.baseColorTexture !== undefined
    || hasVisibleEmissive(jacketMaterial)) {
    errors.push('jacket must use one clean texture-free graphite PBR material')
    cleanMaterialRegionsVerified = false
  }
  let jacketWeightCopiesVerified = false
  if (basePrimitive && jacketPrimitive) {
    const sourceVertexAccessor = jacketPrimitive.attributes?._SOURCE_VERTEX
    if (sourceVertexAccessor === undefined) {
      errors.push('jacket must expose _SOURCE_VERTEX proof mapping')
    } else {
      const baseJoints = readAccessor(model, basePrimitive.attributes.JOINTS_0).values
      const baseWeights = readAccessor(model, basePrimitive.attributes.WEIGHTS_0).values
      const jacketJoints = readAccessor(model, jacketPrimitive.attributes.JOINTS_0).values
      const jacketWeights = readAccessor(model, jacketPrimitive.attributes.WEIGHTS_0).values
      const sourceVertices = readAccessor(model, sourceVertexAccessor).values
      jacketWeightCopiesVerified = sourceVertices.every((sourceVertex, jacketVertex) => {
        if (!Number.isInteger(sourceVertex) || sourceVertex < 0 || sourceVertex * 4 + 3 >= baseJoints.length) return false
        for (let component = 0; component < 4; component += 1) {
          const sourceOffset = sourceVertex * 4 + component
          const jacketOffset = jacketVertex * 4 + component
          if (jacketJoints[jacketOffset] !== baseJoints[sourceOffset]) return false
          if (jacketWeights[jacketOffset] !== baseWeights[sourceOffset]) return false
        }
        return true
      })
      if (!jacketWeightCopiesVerified) {
        errors.push('jacket JOINTS_0 and WEIGHTS_0 must exactly match mapped native body vertices')
      }
    }
  }

  if (model.json.asset?.extras?.schema !== 'life-hero-concept-glb/v3') {
    errors.push('asset must expose the native same-body KAN-257 contract receipt')
  }
  if (model.json.asset?.extras?.materialCorrection?.classifier !== 'native-joints-position-v1') {
    errors.push('asset must expose the deterministic material correction receipt')
    cleanMaterialRegionsVerified = false
  }

  const meshGeometry = (model.json.meshes ?? []).map(mesh => {
    const primitive = mesh.primitives[0]
    const position = readAccessor(model, primitive.attributes.POSITION).accessor
    return {
      name: mesh.name,
      vertices: position.count,
      triangles: mesh.primitives.reduce((sum, candidate) => (
        sum + readAccessor(model, candidate.indices).accessor.count / 3
      ), 0),
      materials: mesh.primitives.map(candidate => candidate.material),
    }
  })
  const bytes = await readFile(filePath)
  return {
    filePath,
    byteLength: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    valid: errors.length === 0,
    errors,
    summary,
    meshGeometry,
    materialRegions,
    cleanMaterialRegionsVerified,
    jacketWeightCopiesVerified,
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
