import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useSoundCloudPlayer } from '../audio/SoundCloudPlayer'
import Waveform from './Waveform'

const soundCloudUrl = 'https://soundcloud.com/25ohms'

function formatTime(milliseconds: number) {
  return `${Math.floor(milliseconds / 60000)}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')}`
}

function fullArtwork(url?: string) {
  return url?.replace(/-(?:large|t500x500)(?=\.)/, '-original')
}

function titleCase(title: string) {
  const letters = title.replace(/[^a-z]/gi, '')
  if (letters && letters === letters.toLowerCase()) return 'lowercase'
  if (letters && letters === letters.toUpperCase()) return 'uppercase'
  return 'mixed'
}

type Color = [number, number, number]

async function artworkAccentColor(url: string, signal: AbortSignal): Promise<Color | null> {
  const response = await fetch(url, { mode: 'cors', signal })
  if (!response.ok) return null
  const bitmap = await createImageBitmap(await response.blob())
  try {
    const canvas = document.createElement('canvas')
    const size = 48
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null
    context.drawImage(bitmap, 0, 0, size, size)
    const pixels = context.getImageData(0, 0, size, size).data
    const samples: Color[] = []
    for (let index = 0; index < pixels.length; index += 16) {
      const color: Color = [pixels[index], pixels[index + 1], pixels[index + 2]]
      if (Math.max(...color) > 36) samples.push(color)
    }
    if (!samples.length) return null

    // Seed five clusters with distinct colors, then refine their average colors.
    const centers: Color[] = [samples[0]]
    while (centers.length < 5) {
      let farthest = samples[0]
      let greatestDistance = -1
      for (const color of samples) {
        const nearestDistance = Math.min(
          ...centers.map((center) =>
            color.reduce((sum, channel, index) => sum + (channel - center[index]) ** 2, 0),
          ),
        )
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
        centers.forEach((center, centerIndex) => {
          const nextDistance = color.reduce(
            (sum, channel, index) => sum + (channel - center[index]) ** 2,
            0,
          )
          if (nextDistance < distance) {
            nearest = centerIndex
            distance = nextDistance
          }
        })
        counts[nearest]++
        color.forEach((channel, index) => {
          sums[nearest][index] += channel
        })
      })
      centers.forEach((_, index) => {
        if (counts[index]) centers[index] = sums[index].map((sum) => sum / counts[index]) as Color
        else centers[index] = samples[(pass + index) % samples.length].slice() as Color
      })
    }
    // Reassign once against the final centers, then choose the brightest of the
    // five most represented clusters using perceptual sRGB luminance.
    const counts = centers.map(() => 0)
    samples.forEach((color) => {
      let nearest = 0
      let distance = Number.POSITIVE_INFINITY
      centers.forEach((center, centerIndex) => {
        const nextDistance = color.reduce(
          (sum, channel, index) => sum + (channel - center[index]) ** 2,
          0,
        )
        if (nextDistance < distance) {
          nearest = centerIndex
          distance = nextDistance
        }
      })
      counts[nearest]++
    })
    const prominentColors = centers
      .map((color, index) => ({ color, count: counts[index] }))
      .filter(({ count, color }) => count > 0 && Math.max(...color) > 36)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
    const luminance = (color: Color) => {
      const linear = color.map((channel) => {
        const value = channel / 255
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      })
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
    }
    return prominentColors.reduce<Color | null>(
      (brightest, entry) =>
        !brightest || luminance(entry.color) > luminance(brightest) ? entry.color : brightest,
      null,
    )
  } finally {
    bitmap.close()
  }
}

export default function AudioCard() {
  const player = useSoundCloudPlayer()
  const scrollArea = useRef<HTMLDivElement>(null)
  const headingElement = useRef<HTMLElement>(null)
  const headingTitleElement = useRef<HTMLHeadingElement>(null)
  const artworkElement = useRef<HTMLDivElement>(null)
  const artworkExpandedRef = useRef(true)
  const collapseDistance = useRef(1)
  const [artworkExpanded, setArtworkExpanded] = useState(true)
  const artworkUrl = fullArtwork(player.currentTrack?.artwork_url)
  const displayedPosition = player.duration ? Math.min(player.position, player.duration) : 0

  useEffect(() => {
    const element = scrollArea.current
    const heading = headingElement.current
    const headingTitle = headingTitleElement.current
    const artwork = artworkElement.current
    if (!element || !heading || !headingTitle || !artwork) return
    let frame = 0
    const updateArtworkSize = () => {
      frame = 0
      const maximumWidth = element.clientWidth
      const headingTitleHeight = headingTitle.getBoundingClientRect().height
      const minimumWidth = Math.min(headingTitleHeight, maximumWidth)
      const distance = Math.max(1, maximumWidth - minimumWidth)
      const progress = Math.max(0, Math.min(1, element.scrollTop / distance))
      const mappedWidth = maximumWidth - (maximumWidth - minimumWidth) * progress
      const expandedTop = heading.clientHeight + 20
      const collapsedTop =
        headingTitle.getBoundingClientRect().top - heading.getBoundingClientRect().top
      const artworkTop = expandedTop + (collapsedTop - expandedTop) * progress
      collapseDistance.current = distance
      artwork.style.setProperty('--artwork-width', `${mappedWidth}px`)
      artwork.style.setProperty('--artwork-top', `${artworkTop}px`)
      const expanded = progress < 0.5
      if (expanded !== artworkExpandedRef.current) {
        artworkExpandedRef.current = expanded
        setArtworkExpanded(expanded)
      }
    }
    const scheduleUpdate = () => {
      if (!frame) frame = requestAnimationFrame(updateArtworkSize)
    }
    const resizeObserver = new ResizeObserver(scheduleUpdate)
    resizeObserver.observe(element)
    resizeObserver.observe(heading)
    resizeObserver.observe(headingTitle)
    element.addEventListener('scroll', scheduleUpdate, { passive: true })
    updateArtworkSize()
    return () => {
      element.removeEventListener('scroll', scheduleUpdate)
      resizeObserver.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [artworkUrl])

  useEffect(() => {
    const root = document.documentElement
    return () => {
      const originalAccent = getComputedStyle(root).getPropertyValue('--default-accent').trim()
      root.style.setProperty('--accent', originalAccent || '#8effdc')
      root.style.setProperty('--accent-shift', '0%')
    }
  }, [])

  useEffect(() => {
    const root = document.documentElement
    const originalAccent = getComputedStyle(root).getPropertyValue('--default-accent').trim()
    if (!artworkUrl) {
      root.style.setProperty('--accent', originalAccent || '#8effdc')
      root.style.setProperty('--accent-shift', '0%')
      return
    }
    const controller = new AbortController()
    void artworkAccentColor(artworkUrl, controller.signal)
      .then((color) => {
        root.style.setProperty(
          '--accent',
          color ? `rgb(${color.map(Math.round).join(' ')})` : originalAccent || '#8effdc',
        )
        root.style.setProperty('--accent-shift', color ? '100%' : '0%')
      })
      .catch(() => {
        if (controller.signal.aborted) return
        root.style.setProperty('--accent', originalAccent || '#8effdc')
        root.style.setProperty('--accent-shift', '0%')
        // Cross-origin artwork may not allow pixel access; the default palette remains usable.
      })
    return () => controller.abort()
  }, [artworkUrl])

  return (
    <section className="content-card audio-card" aria-label="Audio player">
      <header ref={headingElement} className="card-heading">
        <div>
          <h2 ref={headingTitleElement}>Audio</h2>
        </div>
        {artworkUrl && (
          <div ref={artworkElement} className="artwork-visual">
            <img src={artworkUrl} alt="" />
            <button
              className="artwork-toggle"
              type="button"
              aria-label={artworkExpanded ? 'Collapse artwork' : 'Expand artwork'}
              aria-expanded={artworkExpanded}
              onClick={() => {
                scrollArea.current?.scrollTo({
                  top: artworkExpanded ? collapseDistance.current : 0,
                  behavior: 'smooth',
                })
              }}
            >
              {artworkExpanded ? '−' : '↗'}
            </button>
          </div>
        )}
      </header>
      <div ref={scrollArea} className="audio-card-body">
        {artworkUrl && <div className="track-artwork" aria-hidden="true" />}
        <div className="now-playing">
          <span className="eyebrow">NOW PLAYING</span>
          <strong className={`now-playing-title is-${titleCase(player.currentTrack?.title || '')}`}>
            {player.currentTrack?.title || 'Select a track'}
          </strong>
          <span>25OHMS / SOUNDCLOUD</span>
        </div>
        <div className="waveform">
          <Waveform
            peaks={
              player.currentTrack?.waveform_url
                ? player.waveforms[player.currentTrack.waveform_url]
                : undefined
            }
            progress={player.duration ? displayedPosition / player.duration : 0}
            ready={player.waveformsReady}
            onSeek={(progress) => {
              if (player.duration) player.seekTo(progress * player.duration)
            }}
          />
        </div>
        <div className="timeline">
          <span>{formatTime(displayedPosition)}</span>
          <input
            aria-label="Track position"
            type="range"
            min="0"
            max={player.duration || 1}
            value={Math.min(displayedPosition, player.duration || 1)}
            onChange={(event) => player.seekTo(Number(event.target.value))}
            style={
              {
                '--timeline-progress': `${player.duration ? (player.position / player.duration) * 100 : 0}%`,
              } as CSSProperties
            }
          />
          <span>{formatTime(player.duration)}</span>
        </div>
        <div className="player-controls">
          <button
            aria-label="Previous track"
            onClick={() => player.changeTrack(player.trackIndex - 1)}
          >
            ◂◂
          </button>
          <button
            className="play-button"
            aria-label={player.playing ? 'Pause' : 'Play'}
            onClick={player.togglePlayback}
          >
            {player.playing ? 'Ⅱ' : '▶'}
          </button>
          <button aria-label="Next track" onClick={() => player.changeTrack(player.trackIndex + 1)}>
            ▸▸
          </button>
        </div>
        <div className="track-list">
          <div className="track-list-head">
            <span>TRACK INDEX</span>
            <span>
              {player.tracks.length
                ? `${String(player.trackIndex + 1).padStart(2, '0')} / ${String(player.tracks.length).padStart(2, '0')}`
                : 'LOADING'}
            </span>
          </div>
          {player.tracks.length ? (
            player.tracks.map((track, index) => (
              <button
                key={`${index}-${track}`}
                className={`track-row${index === player.trackIndex ? ' is-current' : ''}`}
                onClick={() => player.changeTrack(index)}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                <span className="track-row-title">{track.title || 'Untitled track'}</span>
                <span>{index === player.trackIndex && player.playing ? '▮▮' : '▶'}</span>
              </button>
            ))
          ) : (
            <p className="track-loading">Fetching all tracks from the archive…</p>
          )}
        </div>
        <a className="card-link" href={soundCloudUrl} target="_blank" rel="noreferrer">
          OPEN SOUNDCLOUD ↗
        </a>
      </div>
    </section>
  )
}
