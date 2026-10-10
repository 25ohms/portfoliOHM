import { logPerformance } from '../utils/performanceLogger'

const THUMBNAIL_SIZE = 80

export type PreparedArtwork = {
  luminance: Uint8Array
  alpha: Uint8Array
}

const preparedArtwork = new Map<string, Promise<PreparedArtwork>>()

function prepare(url: string): Promise<PreparedArtwork> {
  const startedAt = performance.now()
  logPerformance('NOW_PLAYING_ARTWORK_CACHE_STARTED')

  return (async () => {
    const response = await fetch(url, { mode: 'cors', cache: 'force-cache' })
    if (!response.ok) throw new Error('Artwork request failed')
    const downloadedAt = performance.now()
    const blob = await response.blob()
    const bitmap = await createImageBitmap(blob, {
      resizeWidth: THUMBNAIL_SIZE,
      resizeHeight: THUMBNAIL_SIZE,
      resizeQuality: 'high',
    })
    const decodedAt = performance.now()
    try {
      const canvas = document.createElement('canvas')
      canvas.width = THUMBNAIL_SIZE
      canvas.height = THUMBNAIL_SIZE
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('Artwork canvas is unavailable')
      context.drawImage(bitmap, 0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE)
      const pixels = context.getImageData(0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE).data
      const luminance = new Uint8Array(THUMBNAIL_SIZE * THUMBNAIL_SIZE)
      const alpha = new Uint8Array(THUMBNAIL_SIZE * THUMBNAIL_SIZE)
      for (let pixel = 0; pixel < luminance.length; pixel++) {
        const offset = pixel * 4
        luminance[pixel] = Math.round(
          pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722,
        )
        alpha[pixel] = pixels[offset + 3]
      }
      logPerformance('NOW_PLAYING_ARTWORK_CACHE_READY', {
        bytes: blob.size,
        thumbnailWidth: bitmap.width,
        thumbnailHeight: bitmap.height,
        fetchMs: Math.round(downloadedAt - startedAt),
        decodeAndResizeMs: Math.round(decodedAt - downloadedAt),
        totalMs: Math.round(performance.now() - startedAt),
      })
      return { luminance, alpha }
    } finally {
      bitmap.close()
    }
  })()
}

export function preloadArtwork(url: string): Promise<PreparedArtwork> {
  const cached = preparedArtwork.get(url)
  if (cached) return cached
  const pending = prepare(url)
  preparedArtwork.set(url, pending)
  void pending.catch(() => {
    if (preparedArtwork.get(url) === pending) preparedArtwork.delete(url)
    logPerformance('NOW_PLAYING_ARTWORK_CACHE_FAILED')
  })
  return pending
}

export function drawTintedArtwork(
  canvas: HTMLCanvasElement,
  artwork: PreparedArtwork,
  accent: string,
) {
  const context = canvas.getContext('2d')
  const colorContext = document.createElement('canvas').getContext('2d', {
    willReadFrequently: true,
  })
  if (!context || !colorContext) throw new Error('Artwork canvas is unavailable')
  colorContext.fillStyle = accent
  colorContext.fillRect(0, 0, 1, 1)
  const [red, green, blue] = colorContext.getImageData(0, 0, 1, 1).data
  canvas.width = THUMBNAIL_SIZE
  canvas.height = THUMBNAIL_SIZE
  const image = context.createImageData(THUMBNAIL_SIZE, THUMBNAIL_SIZE)
  for (let pixel = 0; pixel < artwork.luminance.length; pixel++) {
    const offset = pixel * 4
    const intensity = artwork.luminance[pixel] / 255
    image.data[offset] = red * intensity
    image.data[offset + 1] = green * intensity
    image.data[offset + 2] = blue * intensity
    image.data[offset + 3] = artwork.alpha[pixel]
  }
  context.putImageData(image, 0, 0)
}
