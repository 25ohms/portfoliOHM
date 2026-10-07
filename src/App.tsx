import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import AudioCard from './cards/AudioCard'
import { SoundCloudPlayerProvider } from './audio/SoundCloudPlayer'
import LoadingScreen from './components/LoadingScreen'
import { socialLinks } from './data/artist'

const HeroScene = lazy(() => import('./scene/HeroScene'))

const dialItems = [
  { label: 'Ω' },
  { label: 'Audio' },
  { label: 'Visual', href: 'https://www.youtube.com/@twentyfiveohms' },
  { label: 'Shows', href: 'https://ra.co/dj/25ohms' },
  { label: 'Contact', href: socialLinks.instagram.href },
]
export default function App() {
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
      if (
        (event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')
      )
        return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        move(event.key === 'ArrowDown' ? 1 : -1)
      } else if (event.key === 'Escape') setSelected(0)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [move])

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

  return (
    <SoundCloudPlayerProvider>
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
                    {item.label}
                  </button>
                )
              })}
            </div>
          </div>
        </aside>
        {selected === 0 && (
          <section className="hero-copy" id="home" aria-live="polite">
            <h1>
              between man
              <br />
              &amp; machine
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
        <div className="crt-overlay" aria-hidden="true" />
      </main>
      {!loaderRemoved && <LoadingScreen progress={loadingProgress} leaving={siteReady} />}
    </SoundCloudPlayerProvider>
  )
}
