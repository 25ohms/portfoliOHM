import { useEffect, useRef } from 'react'

const BIN_COUNT = 48
const ACCENT_TRANSITION_MS = 1800

export default function SpectrumVisualizer({
  analyser,
  playing,
  accent,
}: {
  analyser: AnalyserNode | null
  playing: boolean
  accent: string | null
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const frequencyData = analyser ? new Uint8Array(analyser.frequencyBinCount) : null
    const colorTransitionUntil = performance.now() + ACCENT_TRANSITION_MS
    let frame = 0

    const resize = () => {
      const bounds = canvas.getBoundingClientRect()
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.max(1, Math.round(bounds.width * ratio))
      canvas.height = Math.max(1, Math.round(bounds.height * ratio))
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
    }

    const draw = () => {
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (analyser && frequencyData) analyser.getByteFrequencyData(frequencyData)
      context.clearRect(0, 0, width, height)
      context.fillStyle = getComputedStyle(canvas).getPropertyValue('--accent').trim() || '#8effdc'
      const gap = 3
      const barWidth = (width - gap * (BIN_COUNT - 1)) / BIN_COUNT
      const nyquist = (analyser?.context.sampleRate ?? 48000) / 2
      const frequencyForBin = (index: number) => 28 * (12000 / 28) ** (index / BIN_COUNT)

      for (let index = 0; index < BIN_COUNT; index++) {
        const low = Math.min(nyquist, frequencyForBin(index))
        const high = Math.min(nyquist, frequencyForBin(index + 1))
        const first = Math.max(0, Math.floor((low / nyquist) * (frequencyData?.length ?? 1)))
        const last = Math.max(first + 1, Math.ceil((high / nyquist) * (frequencyData?.length ?? 1)))
        let energy = 0
        let samples = 0
        if (frequencyData) {
          for (let bin = first; bin < Math.min(last, frequencyData.length); bin++) {
            energy += frequencyData[bin]
            samples++
          }
        }
        const level = samples ? energy / samples / 255 : 0
        const barHeight = Math.max(2, level * height * 0.94)
        const x = index * (barWidth + gap)
        const y = height - barHeight
        context.fillRect(x, y, Math.max(1, barWidth), barHeight)
      }
      if ((playing && analyser) || performance.now() < colorTransitionUntil) {
        frame = requestAnimationFrame(draw)
      }
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    draw()

    return () => {
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [accent, analyser, playing])

  return <canvas ref={canvasRef} className="spectrum-canvas" role="img" aria-label="Live audio spectrum" />
}
