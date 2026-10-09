export const BASS_ATTACK_RATE = 45
export const BASS_RELEASE_RATE = 14

export function readBassLevel(analyser: AnalyserNode, frequencyData: Uint8Array<ArrayBuffer>) {
  analyser.getByteFrequencyData(frequencyData)
  const binWidth = analyser.context.sampleRate / analyser.fftSize
  const first = Math.max(0, Math.floor(28 / binWidth))
  const last = Math.min(frequencyData.length - 1, Math.ceil(150 / binWidth))
  let energy = 0
  for (let bin = first; bin <= last; bin++) energy += frequencyData[bin]
  const average = energy / Math.max(1, last - first + 1) / 255
  return Math.min(1, Math.max(0, (average - 0.08) * 2.4))
}

export function smoothBassLevel(current: number, target: number, delta: number) {
  const rate = target > current ? BASS_ATTACK_RATE : BASS_RELEASE_RATE
  return current + (target - current) * (1 - Math.exp(-Math.min(delta, 0.05) * rate))
}
