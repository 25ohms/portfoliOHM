import { readFileSync } from 'node:fs'
import { Box3, Mesh, Vector3 } from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SCENE, parseSceneConfig } from '../config/scene'
import { FetusLoader, repairFetusExport } from './FetusLoader'
import { bayerValue, cameraDistance, paletteBytes, seededRandom } from './math'

describe('original fetus asset compatibility', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('loads the supplied FBX without modifying the original and produces finite geometry', () => {
    vi.stubGlobal('window', { innerWidth: 1440, innerHeight: 1000 })
    const file = readFileSync(new URL('../../models/fetus/source/scene.fbx', import.meta.url))
    const buffer = file.buffer.slice(
      file.byteOffset,
      file.byteOffset + file.byteLength,
    ) as ArrayBuffer
    const before = new Uint8Array(buffer).slice()
    const repaired = repairFetusExport(buffer)
    expect(new Uint8Array(buffer)).toEqual(before)
    expect(new Uint8Array(repaired).filter((v, i) => v !== before[i])).toHaveLength(2)
    const model = new FetusLoader().parse(buffer, '')
    let vertices = 0
    model.traverse((child) => {
      if (child instanceof Mesh) {
        vertices += child.geometry.attributes.position.count
        expect(Array.from(child.geometry.attributes.position.array).every(Number.isFinite)).toBe(
          true,
        )
      }
    })
    expect(vertices).toBeGreaterThan(1000)
    const size = new Box3().setFromObject(model).getSize(new Vector3())
    expect(size.toArray().every((v) => Number.isFinite(v) && v > 0)).toBe(true)
  })
})

describe('visual configuration', () => {
  it('round-trips exported presets and rejects invalid GPU settings', () => {
    expect(parseSceneConfig(JSON.parse(JSON.stringify(DEFAULT_SCENE)))).toEqual(DEFAULT_SCENE)
    expect(() =>
      parseSceneConfig({ ...DEFAULT_SCENE, stars: { ...DEFAULT_SCENE.stars, count: Infinity } }),
    ).toThrow()
    expect(() =>
      parseSceneConfig({
        ...DEFAULT_SCENE,
        palette: [
          { position: 0, color: '#ffffff' },
          { position: 0, color: '#000000' },
        ],
      }),
    ).toThrow()
    expect(() => parseSceneConfig({ version: 1 })).toThrow()
  })
  it('has evenly distributed unique Bayer thresholds at each size', () => {
    for (const size of [2, 4, 8] as const) {
      const values = Array.from({ length: size * size }, (_, i) =>
        bayerValue(i % size, Math.floor(i / size), size),
      )
      expect(new Set(values).size).toBe(size * size)
      expect(values.reduce((a, b) => a + b) / values.length).toBeCloseTo(0.5)
      expect(Math.min(...values)).toBeGreaterThan(0)
      expect(Math.max(...values)).toBeLessThan(1)
    }
    expect([
      bayerValue(0, 0, 2),
      bayerValue(1, 0, 2),
      bayerValue(0, 1, 2),
      bayerValue(1, 1, 2),
    ]).toEqual([0.125, 0.625, 0.875, 0.375])
  })
  it('maps a grayscale ramp to linear palette endpoints', () => {
    const bytes = paletteBytes([
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ])
    expect(Array.from(bytes.slice(0, 4))).toEqual([0, 0, 0, 255])
    expect(Array.from(bytes.slice(-4))).toEqual([255, 255, 255, 255])
    for (let i = 4; i < bytes.length; i += 4) expect(bytes[i]).toBeGreaterThanOrEqual(bytes[i - 4])
  })
  it('frames the same model farther away in portrait and keeps stars reproducible', () => {
    expect(cameraDistance(0.6, 36, 1, 1.3)).toBeGreaterThan(cameraDistance(1.8, 36, 1, 1.3))
    const a = seededRandom(25),
      b = seededRandom(25)
    expect(Array.from({ length: 20 }, a)).toEqual(Array.from({ length: 20 }, b))
  })
})
