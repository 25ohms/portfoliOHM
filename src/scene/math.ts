import { Color } from 'three'
import type { PaletteStop } from '../config/scene'

export function bayerValue(x: number, y: number, size: 2 | 4 | 8): number {
  let value = 0
  for (let bit = 0; bit < Math.log2(size); bit++) {
    const bx = (x >> bit) & 1
    const by = (y >> bit) & 1
    value = value * 4 + ((bx ^ by) * 2 + by)
  }
  return (value + 0.5) / (size * size)
}

export function paletteBytes(stops: PaletteStop[], width = 256): Uint8Array {
  const bytes = new Uint8Array(width * 4)
  for (let i = 0; i < width; i++) {
    const position = i / (width - 1)
    const right = Math.max(
      1,
      stops.findIndex((s) => s.position >= position),
    )
    const a = stops[right - 1]
    const b = stops[right]
    const color = new Color(a.color)
      .lerp(new Color(b.color), (position - a.position) / (b.position - a.position))
      .convertLinearToSRGB()
    bytes.set(
      [Math.round(color.r * 255), Math.round(color.g * 255), Math.round(color.b * 255), 255],
      i * 4,
    )
  }
  return bytes
}

export function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return state / 4294967296
  }
}

export function cameraDistance(aspect: number, fov: number, radius: number, padding: number) {
  const vertical = (fov * Math.PI) / 360
  const limitingAngle = Math.min(vertical, Math.atan(Math.tan(vertical) * aspect))
  return (radius * padding) / Math.sin(limitingAngle)
}
