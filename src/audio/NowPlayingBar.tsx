import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useMusicPlayer } from './MusicPlayer'
import Waveform from '../cards/Waveform'

export default function NowPlayingBar({ hidden }: { hidden: boolean }) {
  const player = useMusicPlayer()
  const { currentTrack, requestWaveform } = player
  const artworkCanvas = useRef<HTMLCanvasElement>(null)
  const [artworkFallback, setArtworkFallback] = useState(false)
  const artwork = player.currentTrack?.artworkUrl
  const progress = player.duration ? player.position / player.duration : 0
  const accent =
    player.artworkAccent ||
    getComputedStyle(document.documentElement).getPropertyValue('--default-accent').trim() ||
    '#8effdc'

  useEffect(() => {
    if (!hidden && currentTrack) {
      requestWaveform(currentTrack)
    }
  }, [currentTrack, hidden, requestWaveform])

  useEffect(() => {
    const canvas = artworkCanvas.current
    if (!canvas || !artwork) return
    const controller = new AbortController()
    setArtworkFallback(false)

    const renderArtwork = async () => {
      const response = await fetch(artwork, { mode: 'cors', signal: controller.signal })
      if (!response.ok) throw new Error('Artwork request failed')
      const bitmap = await createImageBitmap(await response.blob())
      if (controller.signal.aborted) {
        bitmap.close()
        return
      }

      const context = canvas.getContext('2d', { willReadFrequently: true })
      const colorContext = document.createElement('canvas').getContext('2d', {
        willReadFrequently: true,
      })
      if (!context || !colorContext) {
        bitmap.close()
        throw new Error('Artwork canvas is unavailable')
      }

      const size = 80
      canvas.width = size
      canvas.height = size
      context.drawImage(bitmap, 0, 0, size, size)
      bitmap.close()

      colorContext.fillStyle = accent
      colorContext.fillRect(0, 0, 1, 1)
      const color = colorContext.getImageData(0, 0, 1, 1).data
      const image = context.getImageData(0, 0, size, size)
      for (let index = 0; index < image.data.length; index += 4) {
        const luminance =
          (image.data[index] * 0.2126 +
            image.data[index + 1] * 0.7152 +
            image.data[index + 2] * 0.0722) /
          255
        image.data[index] = color[0] * luminance
        image.data[index + 1] = color[1] * luminance
        image.data[index + 2] = color[2] * luminance
      }
      context.putImageData(image, 0, 0)
    }

    void renderArtwork().catch(() => {
      if (!controller.signal.aborted) setArtworkFallback(true)
    })
    return () => controller.abort()
  }, [artwork, accent])

  return (
    <aside
      className={`now-playing-bar${hidden ? ' is-hidden' : ''}`}
      aria-label="Now playing"
      aria-hidden={hidden}
      style={{ '--bar-accent': accent } as CSSProperties}
      inert={hidden}
    >
      {artwork && (
        <div className="now-playing-bar-artwork" aria-hidden="true">
          {artworkFallback ? <img src={artwork} alt="" /> : <canvas ref={artworkCanvas} />}
        </div>
      )}
      <button
        className="now-playing-control"
        aria-label="Previous track"
        onClick={() => player.skipTrack(-1)}
      >
        ◂◂
      </button>
      <button
        className="now-playing-control now-playing-play"
        aria-label={player.playing ? 'Pause current track' : 'Play current track'}
        onClick={player.togglePlayback}
      >
        {player.playing ? 'Ⅱ' : '▶'}
      </button>
      <button
        className="now-playing-control"
        aria-label="Next track"
        onClick={() => player.skipTrack(1)}
      >
        ▸▸
      </button>
      <div className="now-playing-bar-track">
        <span className="now-playing-bar-label">NOW PLAYING</span>
        <strong>{player.currentTrack?.title || 'No track selected'}</strong>
      </div>
      <div className="now-playing-bar-waveform">
        <Waveform
          peaks={player.currentTrack ? player.waveforms[player.currentTrack.id] : undefined}
          progress={progress}
          ready={player.waveformsReady}
          onSeek={(value) => player.duration && player.seekTo(value * player.duration)}
        />
      </div>
      <span className="now-playing-bar-time">
        {player.duration
          ? `${Math.floor(player.position / 60000)}:${String(Math.floor(player.position / 1000) % 60).padStart(2, '0')}`
          : '0:00'}
      </span>
    </aside>
  )
}
