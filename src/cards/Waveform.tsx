import { useEffect, useRef } from 'react'

export default function Waveform({
  peaks,
  progress,
  ready,
}: {
  peaks?: number[]
  progress: number
  ready: boolean
}) {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return

    const draw = () => {
      const { width, height } = element.getBoundingClientRect()
      if (!width || !height) return
      const pixelRatio = window.devicePixelRatio || 1
      element.width = Math.round(width * pixelRatio)
      element.height = Math.round(height * pixelRatio)
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      context.clearRect(0, 0, width, height)

      if (!peaks?.length) {
        context.fillStyle = getComputedStyle(element).getPropertyValue('--muted')
        context.font = '9px "Space Mono", monospace'
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.fillText(
          ready ? 'TRACK WAVEFORM UNAVAILABLE' : 'PREPARING TRACK WAVEFORM',
          width / 2,
          height / 2,
        )
        return
      }

      const accent = getComputedStyle(element).getPropertyValue('--accent')
      const played = Math.max(0, Math.min(1, progress))
      const step = width / peaks.length
      const barWidth = Math.max(1, step * 0.66)
      for (let index = 0; index < peaks.length; index++) {
        const amplitude = Math.max(0, Math.min(1, peaks[index]))
        const barHeight = Math.max(1, amplitude * height * 0.9)
        context.fillStyle = index / peaks.length <= played ? accent : `${accent}80`
        context.fillRect(index * step, (height - barHeight) / 2, barWidth, barHeight)
      }
    }

    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(element)
    return () => observer.disconnect()
  }, [peaks, progress])

  return <canvas className="waveform-canvas" ref={canvas} aria-hidden="true" />
}
