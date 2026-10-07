import { useCallback, useEffect, useRef, type PointerEvent } from 'react'

export default function Waveform({
  peaks,
  progress,
  ready,
  onSeek,
}: {
  peaks?: number[]
  progress: number
  ready: boolean
  onSeek: (progress: number) => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const dragging = useRef(false)

  const seekFromPointer = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    onSeek(Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)))
  }, [onSeek])

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

      const accent = getComputedStyle(element).getPropertyValue('--accent').trim()
      const played = Math.max(0, Math.min(1, progress))
      const barCount = Math.min(128, Math.max(32, Math.floor(width / 4)))
      const step = width / barCount
      const barWidth = Math.max(1, Math.min(3, step * 0.58))
      for (let index = 0; index < barCount; index++) {
        const start = Math.floor((index / barCount) * peaks.length)
        const end = Math.max(start + 1, Math.floor(((index + 1) / barCount) * peaks.length))
        const amplitude = Math.max(
          0,
          Math.min(1, Math.max(...peaks.slice(start, end))),
        )
        const barHeight = Math.max(1, amplitude * height * 0.9)
        context.globalAlpha = index / barCount <= played ? 1 : 0.38
        context.fillStyle = accent
        context.fillRect(index * step, (height - barHeight) / 2, barWidth, barHeight)
      }
      context.globalAlpha = 1
    }

    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(element)
    const paletteObserver = new MutationObserver(draw)
    paletteObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
    return () => {
      observer.disconnect()
      paletteObserver.disconnect()
    }
  }, [peaks, progress])

  return (
    <div
      className="waveform-interaction"
      role="slider"
      aria-label="Seek through track waveform"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      tabIndex={0}
      onPointerDown={(event) => {
        dragging.current = true
        event.currentTarget.setPointerCapture(event.pointerId)
        seekFromPointer(event)
      }}
      onPointerMove={(event) => {
        if (dragging.current) seekFromPointer(event)
      }}
      onPointerUp={() => { dragging.current = false }}
      onPointerCancel={() => { dragging.current = false }}
    >
      <canvas className="waveform-canvas" ref={canvas} aria-hidden="true" />
    </div>
  )
}
