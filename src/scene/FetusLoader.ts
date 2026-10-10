import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { logPerformance } from '../utils/performanceLogger'

/** Ignore two MODO export artifacts that FBXLoader cannot consume: an empty
 * normals layer and an unconnected MODO_RenderSettings model. Only their node
 * names change in memory; all geometry bytes, offsets, and the source stay intact. */
export function repairFetusExport(source: ArrayBuffer): ArrayBuffer {
  const buffer = source.slice(0)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  const decoder = new TextDecoder()
  if (decoder.decode(bytes.subarray(0, 19)) !== 'Kaydara FBX Binary ') return source
  const wide = view.getUint32(23, true) >= 7500
  const headerSize = wide ? 25 : 13
  const readOffset = (offset: number) =>
    wide ? Number(view.getBigUint64(offset, true)) : view.getUint32(offset, true)
  function visit(start: number, limit: number): string[] {
    const names: string[] = []
    let cursor = start
    while (cursor + headerSize <= limit) {
      const end = readOffset(cursor)
      if (end === 0) break
      if (end <= cursor || end > limit) throw new Error('Invalid FBX node bounds')
      const length = readOffset(cursor + (wide ? 16 : 8))
      const nameStart = cursor + headerSize
      const nameLength = bytes[cursor + headerSize - 1]
      const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength))
      const childrenStart = nameStart + nameLength + length
      const children = visit(childrenStart, end)
      if (name === 'LayerElementNormal' && !children.includes('Normals'))
        bytes[nameStart] = 'X'.charCodeAt(0)
      if (
        name === 'Model' &&
        decoder
          .decode(bytes.subarray(nameStart + nameLength, childrenStart))
          .includes('MODO_RenderSettings\0')
      )
        bytes[nameStart] = 'X'.charCodeAt(0)
      names.push(name)
      cursor = end
    }
    return names
  }
  visit(27, buffer.byteLength)
  return buffer
}

export class FetusLoader extends FBXLoader {
  override parse(buffer: ArrayBuffer, path: string) {
    const startedAt = performance.now()
    const repaired = repairFetusExport(buffer)
    const object = super.parse(repaired, path)
    logPerformance('FBX_PARSE_COMPLETE', {
      asset: path.toLowerCase().includes('ohmlogo') ? 'ohm-logo' : 'fetus',
      bytes: buffer.byteLength,
      durationMs: Math.round(performance.now() - startedAt),
    })
    return object
  }
}
