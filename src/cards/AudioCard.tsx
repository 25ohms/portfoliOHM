import type { CSSProperties } from 'react'
import { useSoundCloudPlayer } from '../audio/SoundCloudPlayer'
import Waveform from './Waveform'

const soundCloudUrl = 'https://soundcloud.com/25ohms'

function formatTime(milliseconds: number) {
  return `${Math.floor(milliseconds / 60000)}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')}`
}

function largeArtwork(url?: string) {
  return url?.replace(/-large(?=\.)/, '-t500x500')
}

function titleCase(title: string) {
  const letters = title.replace(/[^a-z]/gi, '')
  if (letters && letters === letters.toLowerCase()) return 'lowercase'
  if (letters && letters === letters.toUpperCase()) return 'uppercase'
  return 'mixed'
}

export default function AudioCard() {
  const player = useSoundCloudPlayer()

  return (
    <section className="content-card audio-card" aria-label="Audio player">
      <header className="card-heading">
        <div>
          <span className="eyebrow">01 / SOUND ARCHIVE</span>
          <h2>Audio</h2>
        </div>
        <span className="live-indicator">● LIVE FEED</span>
      </header>
      <div className="track-artwork">
        {largeArtwork(player.currentTrack?.artwork_url) && (
          <img src={largeArtwork(player.currentTrack?.artwork_url)} alt="" />
        )}
      </div>
      <div className="now-playing">
        <span className="eyebrow">NOW PLAYING</span>
        <strong className={`now-playing-title is-${titleCase(player.currentTrack?.title || '')}`}>
          {player.currentTrack?.title || 'Select a track'}
        </strong>
        <span>25OHMS / SOUNDCLOUD</span>
      </div>
      <div className="waveform" aria-hidden="true">
        <Waveform
          peaks={
            player.currentTrack?.waveform_url
              ? player.waveforms[player.currentTrack.waveform_url]
              : undefined
          }
          progress={player.duration ? player.position / player.duration : 0}
          ready={player.waveformsReady}
        />
      </div>
      <div className="timeline">
        <span>{formatTime(player.position)}</span>
        <input
          aria-label="Track position"
          type="range"
          min="0"
          max={player.duration || 1}
          value={Math.min(player.position, player.duration || 1)}
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
    </section>
  )
}
