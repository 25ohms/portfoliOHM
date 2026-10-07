import { useEffect, useRef, useState } from 'react'
import { DEFAULT_SCENE } from '../config/scene'
import { bayerValue, paletteBytes } from '../scene/math'

const logoSize = 320
const pixelSize = DEFAULT_SCENE.dither.pixelSize
const levels = DEFAULT_SCENE.dither.levels
const matrix = DEFAULT_SCENE.dither.matrix
const strength = DEFAULT_SCENE.dither.strength
const palette = paletteBytes(DEFAULT_SCENE.palette)

export default function DitheredLogo({ progress }: { progress: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [logo, setLogo] = useState<HTMLImageElement | null>(null)

  useEffect(() => {
    const image = new Image()
    image.onload = () => setLogo(image)
    image.src = '/logos/ohmLOGO_3.png'
    return () => {
      image.onload = null
    }
  }, [])

  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context || !logo) return

    const pixelRatio = Math.min(window.devicePixelRatio || 1, DEFAULT_SCENE.quality.maxDpr)
    const renderSize = Math.round(logoSize * pixelRatio)
    const source = document.createElement('canvas')
    source.width = renderSize
    source.height = renderSize
    const sourceContext = source.getContext('2d', { willReadFrequently: true })
    if (!sourceContext) return
    sourceContext.drawImage(logo, 0, 0, renderSize, renderSize)
    const sourcePixels = sourceContext.getImageData(0, 0, renderSize, renderSize).data
    const output = context.createImageData(renderSize, renderSize)

    for (let y = 0; y < renderSize; y += pixelSize) {
      for (let x = 0; x < renderSize; x += pixelSize) {
        let alpha = 0
        let samples = 0
        for (let offsetY = 0; offsetY < pixelSize; offsetY++) {
          for (let offsetX = 0; offsetX < pixelSize; offsetX++) {
            const sourceIndex = ((y + offsetY) * renderSize + x + offsetX) * 4
            alpha += sourcePixels[sourceIndex + 3]
            samples++
          }
        }

        const fill = (y + pixelSize / 2) / renderSize >= 1 - progress ? 1 : 0.38
        const intensity = (alpha / samples / 255) * fill
        const threshold =
          0.5 * (1 - strength) + bayerValue(x / pixelSize, y / pixelSize, matrix) * strength
        const quantized = Math.max(
          0,
          Math.min(levels - 1, Math.floor(intensity * (levels - 1) + threshold)),
        )
        if (quantized === 0) continue

        const paletteIndex = Math.round((quantized / (levels - 1)) * 255) * 4
        for (let offsetY = 0; offsetY < pixelSize; offsetY++) {
          for (let offsetX = 0; offsetX < pixelSize; offsetX++) {
            const outputIndex = ((y + offsetY) * renderSize + x + offsetX) * 4
            output.data[outputIndex] = palette[paletteIndex]
            output.data[outputIndex + 1] = palette[paletteIndex + 1]
            output.data[outputIndex + 2] = palette[paletteIndex + 2]
            output.data[outputIndex + 3] = 255
          }
        }
      }
    }

    element.width = renderSize
    element.height = renderSize
    context.putImageData(output, 0, 0)
  }, [logo, progress])

  return (
    <canvas
      ref={canvas}
      className="boot-omega-canvas"
      width={logoSize}
      height={logoSize}
      aria-hidden="true"
    />
  )
}
