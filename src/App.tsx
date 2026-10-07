import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import AudioCard from './cards/AudioCard'
import { SoundCloudPlayerProvider, useSoundCloudPlayer } from './audio/SoundCloudPlayer'
import NowPlayingBar from './audio/NowPlayingBar'
import LoadingScreen from './components/LoadingScreen'
import { socialLinks } from './data/artist'

const HeroScene = lazy(() => import('./scene/HeroScene'))

const dialItems = [
  { label: 'Ω', logo: true },
  { label: 'Audio' },
  { label: 'Visual', href: 'https://www.youtube.com/@twentyfiveohms' },
  { label: 'Shows', href: 'https://ra.co/dj/25ohms' },
  { label: 'Contact', href: socialLinks.instagram.href },
]
const scrollableCardSelector = '.content-card, .audio-card-body'

export default function App() {
  return (
    <SoundCloudPlayerProvider>
      <PortfolioExperience />
    </SoundCloudPlayerProvider>
  )
}

function PortfolioExperience() {
  const player = useSoundCloudPlayer()
  const { togglePlayback, skipTrack, seekTo, position, duration } = player
  const [selected, setSelected] = useState(0)
  const [sceneSettled, setSceneSettled] = useState(false)
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [siteReady, setSiteReady] = useState(false)
  const [loaderRemoved, setLoaderRemoved] = useState(false)
  const lastWheelMove = useRef(0)
  const active = dialItems[selected]
  const move = useCallback(
    (step: number) =>
      setSelected((current) => (current + step + dialItems.length) % dialItems.length),
    [],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (target.closest('input:not([type="range"]), textarea, select, [contenteditable="true"]')) return
      if (event.key === ' ' || event.code === 'Space') {
        if (event.repeat) return
        event.preventDefault()
        togglePlayback()
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (event.altKey || event.ctrlKey || event.metaKey) return
        event.preventDefault()
        if (event.shiftKey) skipTrack(event.key === 'ArrowRight' ? 1 : -1)
        else {
          const offset = event.key === 'ArrowRight' ? 10_000 : -10_000
          seekTo(Math.max(0, Math.min(duration, position + offset)))
        }
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        move(event.key === 'ArrowDown' ? 1 : -1)
      } else if (event.key === 'Escape') setSelected(0)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [duration, move, position, seekTo, skipTrack, togglePlayback])

  useEffect(() => {
    const focusedItem = document.activeElement
    if (!focusedItem?.matches('.dial-item')) return
    document
      .querySelector<HTMLButtonElement>('.dial-item.is-selected')
      ?.focus({ preventScroll: true })
  }, [selected])

  useEffect(() => {
    if (!sceneSettled) return
    setLoadingProgress(1)
    setSiteReady(true)
    const timer = window.setTimeout(() => setLoaderRemoved(true), 700)
    return () => window.clearTimeout(timer)
  }, [sceneSettled])

  const settleScene = useCallback(() => setSceneSettled(true), [])

  useEffect(() => {
    const root = document.documentElement
    const accent = selected === 1 ? player.artworkAccent : null
    root.style.setProperty(
      '--accent',
      accent || root.style.getPropertyValue('--default-accent') || '#8effdc',
    )
    root.style.setProperty('--accent-shift', accent ? '100%' : '0%')
  }, [selected, player.artworkAccent])

  useEffect(() => {
    const timers = new Map<HTMLElement, number>()
    const onScroll = (event: Event) => {
      const target = event.target
      if (!(target instanceof HTMLElement) || !target.matches(scrollableCardSelector)) return
      if (target.scrollHeight <= target.clientHeight + 1) return
      target.classList.add('is-scrolling')
      const existing = timers.get(target)
      if (existing) window.clearTimeout(existing)
      timers.set(
        target,
        window.setTimeout(() => {
          target.classList.remove('is-scrolling')
          timers.delete(target)
        }, 700),
      )
    }
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      timers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [])

  return (
    <>
      <main
        className={`experience${selected === 0 ? ' is-home' : ' has-card'}${siteReady ? ' is-revealed' : ' is-loading'}`}
        aria-label="25ohms portfolio"
        aria-hidden={!siteReady}
      >
        <a className="skip-link" href="#dial">
          Skip to menu
        </a>
        <div className="scene-layer">
          <Suspense fallback={null}>
            <HeroScene cardOpen={selected > 0} onSettled={settleScene} />
          </Suspense>
        </div>
        <aside className="dial-rail">
          <a
            className="wordmark"
            href="#home"
            onClick={() => setSelected(0)}
            aria-label="25ohms home"
          >
            25<span>ohms</span>
          </a>
          <div
            className="dial"
            id="dial"
            aria-label="Portfolio menu"
            tabIndex={-1}
            onWheel={(event) => {
              const now = performance.now()
              if (now - lastWheelMove.current < 320) return
              lastWheelMove.current = now
              move(event.deltaY > 0 ? 1 : -1)
            }}
          >
            <span className="dial-marker" aria-hidden="true" />
            <div className="dial-items">
              {dialItems.map((item, index) => {
                const offset = (index - selected + dialItems.length) % dialItems.length
                const distance = offset > dialItems.length / 2 ? offset - dialItems.length : offset
                return (
                  <button
                    className={`dial-item${index === selected ? ' is-selected' : ''}`}
                    key={item.label}
                    style={
                      {
                        '--dial-offset': `${distance * 66}px`,
                        '--dial-portrait-offset': `${distance * 9}svh`,
                        '--dial-curve': `${Math.abs(distance) * 9}px`,
                      } as CSSProperties
                    }
                    aria-pressed={index === selected}
                    onClick={() => setSelected(index)}
                  >
                    {item.logo ? <span className="dial-logo" aria-hidden="true" /> : item.label}
                  </button>
                )
              })}
            </div>
          </div>
        </aside>
        {selected === 0 && (
          <section className="hero-copy" id="home" aria-live="polite">
            <h1 aria-label="between MAN and MACHINE">
              <span className="hero-title-word">between</span>
              <span className="hero-title-emphasis hero-title-man">MAN</span>
              <span className="hero-title-word hero-title-and">and</span>
              <span className="hero-title-emphasis hero-title-machine">MACHINE</span>
            </h1>
          </section>
        )}
        {selected === 1 && <AudioCard />}
        {selected > 1 && active.href && (
          <section className="content-card selection-panel" key={active.label} aria-live="polite">
            <header className="card-heading">
              <div>
                <span className="eyebrow">0{selected} / TRANSMISSION</span>
                <h2>{active.label}</h2>
              </div>
            </header>
            <p>Explore 25ohms {active.label.toLowerCase()}.</p>
            <a className="card-link" href={active.href} target="_blank" rel="noreferrer">
              OPEN {active.label.toUpperCase()} ↗
            </a>
          </section>
        )}
        <NowPlayingBar hidden={selected === 1 || !siteReady || !player.currentTrack} />
        <div className="crt-overlay" aria-hidden="true" />
      </main>
      {!loaderRemoved && <LoadingScreen progress={loadingProgress} leaving={siteReady} />}
    </>
  )
}
