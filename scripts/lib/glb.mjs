import { readFile, writeFile } from 'node:fs/promises'

const COMPONENT_READERS = {
  5120: { bytes: 1, read: (view, offset) => view.getInt8(offset) },
  5121: { bytes: 1, read: (view, offset) => view.getUint8(offset) },
  5122: { bytes: 2, read: (view, offset) => view.getInt16(offset, true) },
  5123: { bytes: 2, read: (view, offset) => view.getUint16(offset, true) },
  5125: { bytes: 4, read: (view, offset) => view.getUint32(offset, true) },
  5126: { bytes: 4, read: (view, offset) => view.getFloat32(offset, true) },
}

export const TYPE_COMPONENTS = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
}

export async function readGlb(filePath) {
  const file = await readFile(filePath)
  if (file.toString('ascii', 0, 4) !== 'glTF') {
    throw new Error(`${filePath} is not a binary glTF file`)
  }
  if (file.readUInt32LE(4) !== 2) {
    throw new Error(`${filePath} is not glTF 2.0`)
  }
  if (file.readUInt32LE(8) !== file.byteLength) {
    throw new Error(`${filePath} has an invalid GLB byte length`)
  }

  let json
  let binary = Buffer.alloc(0)
  let offset = 12
  while (offset < file.byteLength) {
    const length = file.readUInt32LE(offset)
    const type = file.toString('ascii', offset + 4, offset + 8)
    const chunk = file.subarray(offset + 8, offset + 8 + length)
    if (type === 'JSON') {
      json = JSON.parse(chunk.toString('utf8').trimEnd())
    } else if (type.startsWith('BIN')) {
      binary = chunk
    }
    offset += 8 + length
  }

  if (!json) throw new Error(`${filePath} has no JSON chunk`)
  return { json, binary }
}

export function readAccessor(model, accessorIndex) {
  const accessor = model.json.accessors?.[accessorIndex]
  if (!accessor) throw new Error(`Missing accessor ${accessorIndex}`)
  if (accessor.sparse) throw new Error(`Sparse accessor ${accessorIndex} is unsupported`)
  const bufferView = model.json.bufferViews?.[accessor.bufferView]
  if (!bufferView) throw new Error(`Accessor ${accessorIndex} has no buffer view`)
  const component = COMPONENT_READERS[accessor.componentType]
  const componentCount = TYPE_COMPONENTS[accessor.type]
  if (!component || !componentCount) throw new Error(`Accessor ${accessorIndex} has an unsupported format`)

  const elementSize = component.bytes * componentCount
  const stride = bufferView.byteStride ?? elementSize
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  const view = new DataView(model.binary.buffer, model.binary.byteOffset, model.binary.byteLength)
  const values = new Array(accessor.count * componentCount)

  for (let index = 0; index < accessor.count; index += 1) {
    const elementOffset = start + index * stride
    for (let componentIndex = 0; componentIndex < componentCount; componentIndex += 1) {
      values[index * componentCount + componentIndex] = component.read(
        view,
        elementOffset + componentIndex * component.bytes,
      )
    }
  }

  return { accessor, componentCount, values }
}

export function inspectGlbJson(json) {
  const meshNodes = (json.nodes ?? [])
    .map((node, index) => ({
      index,
      name: node.name ?? null,
      mesh: node.mesh ?? null,
      skin: node.skin ?? null,
    }))
    .filter(node => node.mesh !== null)

  return {
    generator: json.asset?.generator ?? null,
    version: json.asset?.version ?? null,
    meshes: (json.meshes ?? []).map((mesh, index) => ({
      index,
      name: mesh.name ?? null,
      primitives: mesh.primitives?.length ?? 0,
    })),
    meshNodes,
    skins: (json.skins ?? []).map((skin, index) => ({
      index,
      name: skin.name ?? null,
      joints: skin.joints?.length ?? 0,
    })),
    animations: (json.animations ?? []).map((animation, index) => ({
      index,
      name: animation.name ?? null,
      channels: animation.channels?.length ?? 0,
      samplers: animation.samplers?.length ?? 0,
    })),
    materials: (json.materials ?? []).map((material, index) => ({
      index,
      name: material.name ?? null,
    })),
  }
}

export async function writeGlb(filePath, json, binary) {
  const jsonSource = Buffer.from(JSON.stringify(json))
  const jsonPadding = (4 - (jsonSource.byteLength % 4)) % 4
  const jsonChunk = Buffer.concat([jsonSource, Buffer.alloc(jsonPadding, 0x20)])
  const binaryPadding = (4 - (binary.byteLength % 4)) % 4
  const binaryChunk = Buffer.concat([binary, Buffer.alloc(binaryPadding)])
  const fileLength = 12 + 8 + jsonChunk.byteLength + 8 + binaryChunk.byteLength
  const header = Buffer.alloc(12)
  header.write('glTF', 0, 'ascii')
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(fileLength, 8)
  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(jsonChunk.byteLength, 0)
  jsonHeader.write('JSON', 4, 'ascii')
  const binaryHeader = Buffer.alloc(8)
  binaryHeader.writeUInt32LE(binaryChunk.byteLength, 0)
  binaryHeader.write('BIN\0', 4, 'ascii')
  await writeFile(filePath, Buffer.concat([header, jsonHeader, jsonChunk, binaryHeader, binaryChunk]))
}
