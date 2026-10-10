import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useMusicPlayer } from './MusicPlayer'
import Waveform from '../cards/Waveform'
import { logPerformance } from '../utils/performanceLogger'
import { drawTintedArtwork, preloadArtwork } from './artworkCache'

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
    const startedAt = performance.now()
    setArtworkFallback(false)
    let cancelled = false
    void preloadArtwork(artwork)
      .then((prepared) => {
        if (cancelled) return
        const processingStartedAt = performance.now()
        drawTintedArtwork(canvas, prepared, accent)
        logPerformance('NOW_PLAYING_ARTWORK_READY', {
          processingMs: Math.round(performance.now() - processingStartedAt),
          totalMs: Math.round(performance.now() - startedAt),
        })
      })
      .catch(() => {
        if (cancelled) return
        logPerformance('NOW_PLAYING_ARTWORK_FAILED', {
          durationMs: Math.round(performance.now() - startedAt),
        })
        setArtworkFallback(true)
      })
    return () => {
      cancelled = true
    }
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
