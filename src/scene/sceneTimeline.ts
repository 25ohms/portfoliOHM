import { MathUtils } from 'three'

export const APPROACH_START = 22
export const TAXI_START = 70
export const ENGINE_WARMUP_START = 87
export const WARP_START = 93
export const WARP_END = 161
export const BABY_DISPLACEMENT_BOOST_START = 163
export const BABY_DISPLACEMENT_BOOST = 1.5
export const WARP_DURATION = 0.4
export const WARP_TRAIL_FADE = 1.6
export const WARP_LOGO_FADE_DURATION = 0.2
export const LOGO_GLOW_DECAY_START = 185
export const LOGO_GLOW_RISE_START = 232
export const LOGO_GLOW_DECAY_END = 285
export const LOGO_GLOW_DECAY_DURATION = 0.3
export const NON_FF_GLOW_SCALE = 0.8
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

export function babyDisplacementMultiplierAt(time: number) {
  const multiplier = displacementMultiplierAt(time)
  return time >= BABY_DISPLACEMENT_BOOST_START
    ? multiplier * BABY_DISPLACEMENT_BOOST
    : multiplier
}

export function warpGlowEnvelopeAt(time: number) {
  const fadeOut = 1 - MathUtils.smoothstep(
    time,
    WARP_START,
    WARP_START + WARP_LOGO_FADE_DURATION,
  )
  const fadeBackIn = MathUtils.smoothstep(
    time,
    WARP_START + WARP_LOGO_FADE_DURATION,
    WARP_END,
  )
  return Math.max(fadeOut, fadeBackIn)
}

export function lateLogoGlowEnvelopeAt(time: number) {
  if (time < LOGO_GLOW_DECAY_START) return 1
  if (time < LOGO_GLOW_DECAY_START + LOGO_GLOW_DECAY_DURATION) {
    return 1 - MathUtils.smoothstep(
      time,
      LOGO_GLOW_DECAY_START,
      LOGO_GLOW_DECAY_START + LOGO_GLOW_DECAY_DURATION,
    )
  }
  if (time < LOGO_GLOW_RISE_START) return 0
  if (time < LOGO_GLOW_DECAY_END) {
    return MathUtils.smoothstep(time, LOGO_GLOW_RISE_START, LOGO_GLOW_DECAY_END)
  }
  if (time < LOGO_GLOW_DECAY_END + LOGO_GLOW_DECAY_DURATION) {
    return 1 - MathUtils.smoothstep(
      time,
      LOGO_GLOW_DECAY_END,
      LOGO_GLOW_DECAY_END + LOGO_GLOW_DECAY_DURATION,
    )
  }
  return 0
}
