import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { useMusicPlayer } from '../audio/MusicPlayer'
import SpectrumVisualizer from '../audio/SpectrumVisualizer'
import { imageAccentColor } from '../utils/color'

function formatTime(milliseconds: number) {
  return `${Math.floor(milliseconds / 60000)}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')}`
}

function titleCase(title: string) {
  const letters = title.replace(/[^a-z]/gi, '')
  if (letters && letters === letters.toLowerCase()) return 'lowercase'
  if (letters && letters === letters.toUpperCase()) return 'uppercase'
  return 'mixed'
}

export default function AudioCard() {
  const player = useMusicPlayer()
  const { selectedProjectId, setArtworkAccent } = player
  const audioBody = useRef<HTMLDivElement>(null)
  const trackListElement = useRef<HTMLDivElement>(null)
  const headingElement = useRef<HTMLElement>(null)
  const headingTitleElement = useRef<HTMLHeadingElement>(null)
  const artworkElement = useRef<HTMLDivElement>(null)
  const artworkSpaceElement = useRef<HTMLDivElement>(null)
  const nowPlayingTitleElement = useRef<HTMLDivElement>(null)
  const nowPlayingTextElement = useRef<HTMLSpanElement>(null)
  const [artworkExpanded, setArtworkExpanded] = useState(false)
  const [titleOverflows, setTitleOverflows] = useState(false)
  const artworkUrl = player.currentTrack?.artworkUrl
  const trackTitle = player.currentTrack?.title || 'Select a track'
  const displayedPosition = player.duration ? Math.min(player.position, player.duration) : 0

  useLayoutEffect(() => {
    const titleViewport = nowPlayingTitleElement.current
    const titleText = nowPlayingTextElement.current
    if (!titleViewport || !titleText) return
    const measure = () => setTitleOverflows(titleText.scrollWidth > titleViewport.clientWidth + 1)
    const observer = new ResizeObserver(measure)
    observer.observe(titleViewport)
    observer.observe(titleText)
    measure()
    return () => observer.disconnect()
  }, [trackTitle])

  useLayoutEffect(() => {
    const heading = headingElement.current
    const headingTitle = headingTitleElement.current
    const artwork = artworkElement.current
    const artworkSpace = artworkSpaceElement.current
    const titleViewport = nowPlayingTitleElement.current
    const body = audioBody.current
    if (!heading || !headingTitle || !artwork || !artworkSpace || !titleViewport || !body) return
    const updateArtworkSize = () => {
      if (artworkExpanded) return
      const maximumWidth = heading.clientWidth
      const headingTop = headingTitle.getBoundingClientRect().top
      const artworkSpaceStyle = getComputedStyle(artworkSpace)
      // Remove the spacer from this measurement so an in-progress collapse
      // still yields the artwork's compact size.
      const artworkSpaceHeight =
        artworkSpace.getBoundingClientRect().height + (parseFloat(artworkSpaceStyle.marginTop) || 0)
      const minimumWidth = Math.min(
        maximumWidth,
        Math.max(
          headingTitle.getBoundingClientRect().height,
          titleViewport.getBoundingClientRect().bottom - headingTop - artworkSpaceHeight,
        ),
      )
      const artworkScale = maximumWidth > 0 ? minimumWidth / maximumWidth : 1
      const collapsedTop =
        headingTop - heading.getBoundingClientRect().top
      heading.style.setProperty('--artwork-width-max', `${maximumWidth}px`)
      heading.style.setProperty('--artwork-scale', String(artworkScale))
      heading.style.setProperty('--artwork-top-min', `${collapsedTop}px`)
      heading.style.setProperty('--artwork-top-max', `${heading.clientHeight + 20}px`)
      artworkSpace.style.setProperty('--artwork-space-height', `${maximumWidth}px`)
      body.style.setProperty('--compact-artwork-width', `${minimumWidth}px`)
    }
    const resizeObserver = new ResizeObserver(updateArtworkSize)
    resizeObserver.observe(heading)
    resizeObserver.observe(headingTitle)
    resizeObserver.observe(titleViewport)
    updateArtworkSize()
    return () => {
      resizeObserver.disconnect()
    }
  }, [artworkExpanded, artworkUrl, selectedProjectId])

  useLayoutEffect(() => {
    trackListElement.current?.scrollTo({ top: 0 })
  }, [selectedProjectId])

  useEffect(() => {
    return () => {
      setArtworkAccent(null)
    }
  }, [setArtworkAccent])

  useEffect(() => {
    if (!artworkUrl) {
      setArtworkAccent(null)
      return
    }
    setArtworkAccent(null)
    const controller = new AbortController()
    void imageAccentColor(artworkUrl, controller.signal)
      .then((color) => {
        if (controller.signal.aborted) return
        setArtworkAccent(color ? `rgb(${color.map(Math.round).join(' ')})` : null)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setArtworkAccent(null)
        // Cross-origin artwork may not allow pixel access; the default palette remains usable.
      })
    return () => controller.abort()
  }, [artworkUrl, setArtworkAccent])

  return (
    <section className="content-card audio-card" aria-label="Audio player">
      <nav className="catalogue-tabs" aria-label="Project catalogue">
        {player.projects.map((project) => (
          <button
            key={project.id}
            type="button"
            className={`catalogue-tab${project.id === player.selectedProjectId ? ' is-selected' : ''}`}
            aria-pressed={project.id === player.selectedProjectId}
            onClick={() => {
              setArtworkExpanded(false)
              player.selectProject(project.id)
            }}
          >
            {project.title}
          </button>
        ))}
      </nav>
      <header
        ref={headingElement}
        className={`card-heading${artworkExpanded ? ' is-artwork-expanded' : ''}`}
      >
        <div>
          <h2 ref={headingTitleElement}>Audio</h2>
        </div>
        {artworkUrl && (
          <div
            ref={artworkElement}
            className={`artwork-visual${artworkExpanded ? ' is-expanded' : ''}`}
          >
            <img src={artworkUrl} alt="" fetchPriority="high" />
          </div>
        )}
        {artworkUrl && (
          <button
            className={`artwork-toggle${artworkExpanded ? ' is-expanded' : ''}`}
            type="button"
            aria-label={artworkExpanded ? 'Collapse artwork' : 'Expand artwork'}
            aria-expanded={artworkExpanded}
            onClick={() => setArtworkExpanded((expanded) => !expanded)}
          >
            {artworkExpanded ? '−' : '↗'}
          </button>
        )}
      </header>
      <div
        ref={audioBody}
        className={`audio-card-body${artworkExpanded ? ' is-artwork-expanded' : ''}`}
      >
        {player.catalogueError && player.tracks.length > 0 && (
          <p className="catalogue-warning" role="status">
            {player.catalogueError}{' '}
            <button className="catalogue-retry" onClick={player.retryCatalogue}>RETRY</button>
          </p>
        )}
        {artworkUrl && <div ref={artworkSpaceElement} className="track-artwork" aria-hidden="true" />}
        <div className="audio-player-main">
          <div className="now-playing">
            <span className="eyebrow">NOW PLAYING</span>
            <div
              ref={nowPlayingTitleElement}
              className={`now-playing-title${titleOverflows ? ' is-overflowing' : ''}`}
            >
              <strong className={`is-${titleCase(trackTitle)}`}>
                <span ref={nowPlayingTextElement}>{trackTitle}</span>
                {titleOverflows && <span aria-hidden="true">{trackTitle}</span>}
              </strong>
            </div>
          </div>
          <div className="spectrum-display">
            <SpectrumVisualizer
              analyser={player.analyser}
              playing={player.playing}
              accent={player.artworkAccent}
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
            <button aria-label="Previous track" onClick={() => player.skipTrack(-1)}>
              ◂◂
            </button>
            <button
              className="play-button"
              aria-label={player.playing ? 'Pause' : 'Play'}
              onClick={player.togglePlayback}
            >
              {player.playing ? 'Ⅱ' : '▶'}
            </button>
            <button aria-label="Next track" onClick={() => player.skipTrack(1)}>
              ▸▸
            </button>
          </div>
        </div>
        <div ref={trackListElement} className="track-list">
          <div className="track-list-head">
            <span>PROJECT TRACKS</span>
            <span>
              {player.tracks.length
                ? `${String(player.trackIndex + 1).padStart(2, '0')} / ${String(player.tracks.length).padStart(2, '0')}`
                : player.catalogueStatus === 'loading' ? 'LOADING' : '—'}
            </span>
          </div>
          {player.tracks.length ? (
            player.tracks.map((track, index) => (
              <button
                key={track.id}
                className={`track-row${index === player.trackIndex ? ' is-current' : ''}`}
                onClick={() => player.changeTrack(index)}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                <span className="track-row-title">{track.title || 'Untitled track'}</span>
                <span>{index === player.trackIndex && player.playing ? '▮▮' : '▶'}</span>
              </button>
            ))
          ) : (
            <div className="track-loading">
              {player.catalogueStatus === 'loading' && <p>READING PROJECT INDEX…</p>}
              {player.catalogueError && (
                <>
                  <p>{player.catalogueError}</p>
                  <button className="catalogue-retry" onClick={player.retryCatalogue}>RETRY</button>
                </>
              )}
            </div>
          )}
        </div>
        {player.playbackError && <p className="track-loading" role="status">{player.playbackError}</p>}
      </div>
    </section>
  )
}
