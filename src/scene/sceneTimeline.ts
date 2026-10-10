import { MathUtils } from 'three'

export const APPROACH_START = 22
export const TAXI_START = 70
export const ENGINE_WARMUP_START = 87
export const WARP_START = 93
export const WARP_DURATION = 0.4
export const WARP_TRAIL_FADE = 1.6
export const WARP_LOGO_FADE_DURATION = 0.2
export const TAXI_FLARE_FADE_DURATION = 0.4
export const WARMUP_FLARE_LEAD = 0.5

export function isFinalFrontierTrack(title: string | null | undefined) {
  return title?.trim().toLowerCase().replace(/[^a-z0-9]/g, '') === 'finalfrontier'
}

export function displacementMultiplierAt(time: number) {
  const fadeOut = 1 - MathUtils.smoothstep(time, TAXI_START, WARP_START)
  const fadeIn = MathUtils.smoothstep(time, WARP_START, WARP_START + WARP_DURATION)
  return fadeOut + fadeIn
}
