import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { socialLinks } from './data/artist'

const HeroScene = lazy(() => import('./scene/HeroScene'))

const dialItems = [
  { label: 'Ω' },
  { label: 'Audio', href: 'https://25ohms.bandcamp.com/' },
  { label: 'Visual', href: 'https://www.youtube.com/@twentyfiveohms' },
  { label: 'Shows', href: 'https://ra.co/dj/25ohms' },
  { label: 'Contact', href: socialLinks.instagram.href },
]

export default function App() {
  const [selected, setSelected] = useState(0)
  const lastWheelMove = useRef(0)
  const active = dialItems[selected]
  const move = useCallback((step: number) => {
    setSelected((current) => (current + step + dialItems.length) % dialItems.length)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')
      )
        return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        move(event.key === 'ArrowDown' ? 1 : -1)
      } else if (event.key === 'Escape') {
        setSelected(0)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [move])

  useEffect(() => {
    const focusedItem = document.activeElement
    if (!focusedItem?.matches('.dial-item')) return
    document.querySelector<HTMLButtonElement>('.dial-item.is-selected')?.focus({ preventScroll: true })
  }, [selected])

  return (
    <main className="experience" aria-label="25ohms portfolio">
      <a className="skip-link" href="#dial">
        Skip to menu
      </a>
      <div className="scene-layer">
        <Suspense fallback={null}>
          <HeroScene />
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
                  style={{
                    '--dial-offset': `${distance * 66}px`,
                    '--dial-curve': `${Math.abs(distance) * 9}px`,
                  } as CSSProperties}
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

      {active.href && (
        <section className="selection-panel" key={active.label} aria-live="polite">
          <button
            className="panel-close"
            onClick={() => setSelected(0)}
            aria-label="Close selection"
          >
            ×
          </button>
          <h2>{active.label}</h2>
          <a href={active.href} target="_blank" rel="noreferrer">
            Open {active.label}
            <span aria-hidden="true"> ↗</span>
          </a>
        </section>
      )}

      <div className="crt-overlay" aria-hidden="true" />
    </main>
  )
}
