export type Vec3 = [number, number, number]
export type PaletteStop = { position: number; color: string }
export interface SceneConfig {
  version: 1
  model: { rotation: Vec3; position: Vec3; scale: number }
  camera: { fov: number; padding: number }
  motion: { speed: number }
  material: { intensity: number; opacity: number }
  stars: { count: number; size: number; brightness: number; seed: number }
  dither: {
    enabled: boolean
    matrix: 2 | 4 | 8
    pixelSize: number
    strength: number
    levels: number
  }
  palette: PaletteStop[]
  quality: { maxDpr: number; resolution: number }
}

export const DEFAULT_SCENE: SceneConfig = {
  version: 1,
  model: { rotation: [0.1, -0.45, -0.18], position: [0, 0, 0], scale: 1 },
  camera: { fov: 36, padding: 1.35 },
  motion: { speed: 0.075 },
  material: { intensity: 0.85, opacity: 0.3 },
  stars: { count: 900, size: 1.35, brightness: 0.65, seed: 25 },
  dither: { enabled: true, matrix: 4, pixelSize: 2, strength: 0.8, levels: 5 },
  palette: [
    { position: 0, color: '#050909' },
    { position: 0.28, color: '#123f43' },
    { position: 0.64, color: '#29988f' },
    { position: 1, color: '#b8fff0' },
  ],
  quality: { maxDpr: 1.5, resolution: 1 },
}

export const PRESET_KEY = '25ohms.scene.v1'

// Reject malformed presets rather than passing NaN or unbounded values to the GPU.
export function parseSceneConfig(input: unknown): SceneConfig {
  const c = input as SceneConfig
  const range = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
  const vec = (v: unknown, bound: number) =>
    Array.isArray(v) && v.length === 3 && v.every((n) => range(n, -bound, bound))
  if (
    !c ||
    c.version !== 1 ||
    !vec(c.model?.rotation, 1000) ||
    !vec(c.model?.position, 5) ||
    !range(c.model?.scale, 0.1, 3) ||
    !range(c.camera?.fov, 15, 75) ||
    !range(c.camera?.padding, 1, 3) ||
    !range(c.motion?.speed, 0, 0.5) ||
    !range(c.material?.intensity, 0, 2) ||
    !range(c.material?.opacity, 0.05, 1) ||
    !range(c.stars?.count, 0, 3000) ||
    !Number.isInteger(c.stars.count) ||
    !range(c.stars?.size, 0.5, 4) ||
    !range(c.stars?.brightness, 0, 1) ||
    !range(c.stars?.seed, 0, 65535) ||
    typeof c.dither?.enabled !== 'boolean' ||
    ![2, 4, 8].includes(c.dither?.matrix) ||
    !range(c.dither?.pixelSize, 1, 6) ||
    !range(c.dither?.strength, 0, 1) ||
    !range(c.dither?.levels, 2, 16) ||
    !range(c.quality?.maxDpr, 1, 2) ||
    !range(c.quality?.resolution, 0.5, 1) ||
    !Array.isArray(c.palette) ||
    c.palette.length < 2 ||
    c.palette.length > 8 ||
    !c.palette.every(
      (s, i) =>
        /^#[0-9a-f]{6}$/i.test(s.color) &&
        range(s.position, 0, 1) &&
        (i === 0 || s.position > c.palette[i - 1].position),
    ) ||
    c.palette[0].position !== 0 ||
    c.palette.at(-1)?.position !== 1
  ) {
    throw new Error(
      'Invalid scene preset. Export a version 1 preset with ordered palette stops from 0 to 1.',
    )
  }
  return structuredClone(c)
}
