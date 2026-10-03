import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { biography, navigation, portfolioSections, socialLinks } from './data/artist'

const HeroScene = lazy(() => import('./scene/HeroScene'))

function Home() {
  return (
    <main id="main" className="home">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-heading">
          <div className="eyebrow">
            <span className="status-dot" /> INDEPENDENT SIGNAL / 25Ω
          </div>
          <h1 id="hero-title">
            between man
            <br />
            &amp; machine<span className="accent">.</span>
          </h1>
          <p>Sound, light &amp; generative systems.</p>
        </div>
        <Suspense fallback={<div className="scene-loading">INITIALIZING VESSEL…</div>}>
          <HeroScene />
        </Suspense>
        <div className="hero-caption">
          <span className="eyebrow">FIG. 001 — OHMEGA</span>
          <p>
            A machine-born vessel.
            <br />
            Reclaimed to preserve humanity.
          </p>
        </div>
        <div className="hero-side" aria-hidden="true">
          SOUND → CODE → LIGHT → LIFE
        </div>
      </section>
      <nav className="facet-grid" aria-label="Explore the portfolio">
        {navigation.slice(0, 3).map((item) => (
          <Link to={item.path} key={item.path} className="facet">
            <span className="facet-top">
              <span>
                {item.index} / {item.detail}
              </span>
              <span className="arrow">↗</span>
            </span>
            <span className="facet-title">{item.label}</span>
          </Link>
        ))}
      </nav>
    </main>
  )
}

function PortfolioPage({ section }: { section: keyof typeof portfolioSections }) {
  const copy = portfolioSections[section]
  return (
    <main id="main" className="content-page">
      <div className="eyebrow">
        {navigation.find((n) => n.path === `/${section}`)?.index} / {copy.tags}
      </div>
      <h1>
        {copy.title}
        <span className="accent">.</span>
      </h1>
      <h2>{copy.subtitle}</h2>
      <p className="page-intro">{copy.description}</p>
      <div className="archive-placeholder">
        <span className="cross" aria-hidden="true">
          +
        </span>
        <p>{copy.empty}</p>
        <a className="text-link" href={copy.link.href} target="_blank" rel="noreferrer">
          {copy.cta} ↗
        </a>
      </div>
    </main>
  )
}

function About() {
  return (
    <main id="main" className="content-page">
      <div className="eyebrow">04 / HUMAN — MACHINE</div>
      <h1>
        25ohms<span className="accent">.</span>
      </h1>
      <h2>Sound. Light. Living systems.</h2>
      <div className="bio">
        {biography.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>
      <div className="social-list">
        {Object.values(socialLinks).map((s) => (
          <a key={s.label} href={s.href} target="_blank" rel="noreferrer">
            {s.label}
            <span>↗</span>
          </a>
        ))}
      </div>
    </main>
  )
}

function Contact() {
  return (
    <main id="main" className="content-page">
      <div className="eyebrow">05 / OPEN A CHANNEL</div>
      <h1>
        Let’s connect<span className="accent">.</span>
      </h1>
      <h2>Start a conversation.</h2>
      <p className="page-intro">
        For bookings, collaborations, and experiments in sound and light, reach out through
        Instagram.
      </p>
      <a
        className="contact-link"
        href={socialLinks.instagram.href}
        target="_blank"
        rel="noreferrer"
      >
        @twentyfiveohms <span>↗</span>
      </a>
    </main>
  )
}

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  useEffect(() => {
    const label = navigation.find((n) => n.path === location.pathname)?.label
    document.title = label ? `${label} — 25ohms` : '25ohms — Sound / Light / Systems'
    window.scrollTo(0, 0)
    const main = document.getElementById('main')
    main?.setAttribute('tabindex', '-1')
    main?.focus({ preventScroll: true })
  }, [location.pathname])
  return (
    <div className="site-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <Link
          className="wordmark"
          to="/"
          aria-label="25ohms home"
          onClick={() => setMenuOpen(false)}
        >
          25<span>ohms</span>
          <sup>Ω</sup>
        </Link>
        <span className="header-note">ARTIST / AUDIOVISUAL SYSTEMS</span>
        <button
          className="menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="primary-nav"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? 'Close −' : 'Menu +'}
        </button>
        <nav
          id="primary-nav"
          className={menuOpen ? 'primary-nav is-open' : 'primary-nav'}
          aria-label="Main navigation"
        >
          {navigation.map((n) => (
            <NavLink key={n.path} to={n.path} onClick={() => setMenuOpen(false)}>
              {n.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/audio" element={<PortfolioPage section="audio" />} />
        <Route path="/visual" element={<PortfolioPage section="visual" />} />
        <Route path="/live" element={<PortfolioPage section="live" />} />
        <Route path="/about" element={<About />} />
        <Route path="/contact" element={<Contact />} />
        <Route
          path="*"
          element={
            <main id="main" className="content-page">
              <div className="eyebrow">404 / SIGNAL NOT FOUND</div>
              <h1>Out of range.</h1>
              <Link className="text-link" to="/">
                Return home ↗
              </Link>
            </main>
          }
        />
      </Routes>
      <footer className="site-footer">
        <span>© {new Date().getFullYear()} 25OHMS</span>
        <span className="footer-center">IN PURSUIT OF SOMETHING HUMAN</span>
        <a href={socialLinks.linktree.href} target="_blank" rel="noreferrer">
          ELSEWHERE ↗
        </a>
      </footer>
    </div>
  )
}
