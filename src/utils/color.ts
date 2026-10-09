export type RGBColor = [number, number, number]

function colorDistance(left: RGBColor, right: RGBColor) {
  return left.reduce((sum, channel, index) => sum + (channel - right[index]) ** 2, 0)
}

function luminance(color: RGBColor) {
  const linear = color.map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
}

/** Returns the brightest of the most represented K-means color clusters. */
export function brightestClusterColor(samples: RGBColor[], clusterCount = 5): RGBColor | null {
  if (!samples.length || clusterCount < 1) return null
  const centers: RGBColor[] = [samples[0]]
  while (centers.length < Math.min(clusterCount, samples.length)) {
    let farthest = samples[0]
    let greatestDistance = -1
    for (const color of samples) {
      const nearestDistance = Math.min(...centers.map((center) => colorDistance(color, center)))
      if (nearestDistance > greatestDistance) {
        farthest = color
        greatestDistance = nearestDistance
      }
    }
    centers.push([...farthest])
  }

  for (let pass = 0; pass < 10; pass++) {
    const sums = centers.map(() => [0, 0, 0])
    const counts = centers.map(() => 0)
    samples.forEach((color) => {
      let nearest = 0
      let distance = Number.POSITIVE_INFINITY
      centers.forEach((center, index) => {
        const nextDistance = colorDistance(color, center)
        if (nextDistance < distance) {
          nearest = index
          distance = nextDistance
        }
      })
      counts[nearest]++
      color.forEach((channel, index) => { sums[nearest][index] += channel })
    })
    centers.forEach((_, index) => {
      if (counts[index]) centers[index] = sums[index].map((sum) => sum / counts[index]) as RGBColor
      else centers[index] = [...samples[(pass + index) % samples.length]]
    })
  }

  const counts = centers.map(() => 0)
  samples.forEach((color) => {
    let nearest = 0
    let distance = Number.POSITIVE_INFINITY
    centers.forEach((center, index) => {
      const nextDistance = colorDistance(color, center)
      if (nextDistance < distance) {
        nearest = index
        distance = nextDistance
      }
    })
    counts[nearest]++
  })
  return centers
    .map((color, index) => ({ color, count: counts[index] }))
    .filter(({ count, color }) => count > 0 && Math.max(...color) > 36)
    .sort((left, right) => right.count - left.count)
    .slice(0, clusterCount)
    .reduce<RGBColor | null>(
      (brightest, entry) => !brightest || luminance(entry.color) > luminance(brightest) ? entry.color : brightest,
      null,
    )
}

export async function imageAccentColor(url: string, signal: AbortSignal): Promise<RGBColor | null> {
  const response = await fetch(url, { mode: 'cors', signal })
  if (!response.ok) return null
  const bitmap = await createImageBitmap(await response.blob())
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 48
    canvas.height = 48
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null
    context.drawImage(bitmap, 0, 0, 48, 48)
    const pixels = context.getImageData(0, 0, 48, 48).data
    const samples: RGBColor[] = []
    for (let index = 0; index < pixels.length; index += 16) {
      const color: RGBColor = [pixels[index], pixels[index + 1], pixels[index + 2]]
      if (Math.max(...color) > 36) samples.push(color)
    }
    return brightestClusterColor(samples)
  } finally {
    bitmap.close()
  }
}
