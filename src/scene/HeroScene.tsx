import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Canvas } from '@react-three/fiber'
import { NoToneMapping, SRGBColorSpace } from 'three'
import { useMusicPlayer } from '../audio/MusicPlayer'
import { logPerformance } from '../utils/performanceLogger'
import {
  DEFAULT_SCENE,
  PRESET_KEY,
  parseSceneConfig,
  type SceneConfig,
  type Vec3,
} from '../config/scene'
import SceneContents, { type SceneDebugObjects } from './SceneContents'

const DevPanel = import.meta.env.DEV ? lazy(() => import('./SceneDevPanel')) : null

function saveDraft(config: SceneConfig) {
  if (!import.meta.env.DEV) return
  try {
    localStorage.setItem(PRESET_KEY, JSON.stringify(config))
  } catch {
    // Storage is optional; a private browser session can still tune the scene.
  }
}

function initialConfig(): SceneConfig {
  if (import.meta.env.DEV) {
    try {
      const saved = localStorage.getItem(PRESET_KEY)
      if (saved) {
        const config = parseSceneConfig(JSON.parse(saved))
        config.model.rotation = [...DEFAULT_SCENE.model.rotation]
        config.logo = structuredClone(DEFAULT_SCENE.logo)
        return config
      }
    } catch {
      /* An old or invalid draft must not prevent the scene from loading. */
    }
  }
  return structuredClone(DEFAULT_SCENE)
}

class SceneErrorBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('OHMEGA scene could not load', error, info)
    this.props.onError()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

export default function HeroScene({
  active = true,
  cardOpen = false,
  onSettled,
}: {
  active?: boolean
  cardOpen?: boolean
  onSettled: () => void
}) {
  const [config, setConfig] = useState(initialConfig)
  const { playing } = useMusicPlayer()
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [visible, setVisible] = useState(true)
  const [quality, setQuality] = useState(1)
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelRevision, setPanelRevision] = useState(0)
  const [rotationEnabled, setRotationEnabled] = useState(true)
  const [controlsVisible, setControlsVisible] = useState(false)
  const controlsCloseButton = useRef<HTMLButtonElement>(null)
  const returnFocusTo = useRef<HTMLElement | null>(null)
  const rotationEnabledRef = useRef(rotationEnabled)
  rotationEnabledRef.current = rotationEnabled
  const [audioReleaseActive, setAudioReleaseActive] = useState(false)
  const wasPlaying = useRef(false)
  const region = useRef<HTMLDivElement>(null)
  const pose = useRef<Vec3>([...config.model.rotation])
  const invalidate = useRef<() => void>(() => {})
  const dragging = useRef(false)
  const cameraOrbit = useRef({ theta: 0, phi: Math.PI / 2 })
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null)
  const runtime = useMemo(() => ({ pose, invalidate, dragging, cameraOrbit }), [])
  const debugObjects = useRef<SceneDebugObjects>({
    baby: null,
    enterprise: null,
    enterpriseDirection: null,
    cursorNdc: null,
    cursorProjection: null,
  })
  const handleReady = useCallback(() => {
    setReady(true)
    onSettled()
  }, [onSettled])
  const handleError = useCallback(() => {
    setFailed(true)
    onSettled()
  }, [onSettled])
  const handleSlow = useCallback(() => {
    logPerformance('SUSTAINED_LOW_FPS_QUALITY_REDUCTION', { resolutionScale: 0.65 })
    setQuality(0.65)
  }, [])

  useEffect(() => {
    pose.current = [...config.model.rotation]
    invalidate.current()
  }, [config.model.rotation])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target
      if (event.key === 'Escape') {
        if (event.repeat) return
        event.preventDefault()
        setControlsVisible((visible) => !visible)
        return
      }
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      )
        return
      if (
        event.key.toLowerCase() === 'f' &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        event.preventDefault()
        if (document.fullscreenElement) {
          void document.exitFullscreen().catch(() => {})
        } else {
          void document.documentElement.requestFullscreen().catch(() => {})
        }
        return
      }
      if (target instanceof HTMLElement && target.closest('[role="dialog"]')) return
      if (event.key === '0') {
        cameraOrbit.current = { theta: 0, phi: Math.PI / 2 }
        invalidate.current()
        return
      }
      if (event.key !== '1' || event.repeat) return
      if (rotationEnabledRef.current) {
        pose.current = [0, 0, 0]
        setConfig((current) => ({
          ...current,
          model: { ...current.model, rotation: [0, 0, 0] },
        }))
        rotationEnabledRef.current = false
        setRotationEnabled(false)
        invalidate.current()
      } else {
        rotationEnabledRef.current = true
        setRotationEnabled(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  useEffect(() => {
    if (!controlsVisible) return
    returnFocusTo.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    controlsCloseButton.current?.focus()
    return () => {
      if (returnFocusTo.current?.isConnected) returnFocusTo.current.focus()
    }
  }, [controlsVisible])
  useEffect(() => {
    if (playing) {
      wasPlaying.current = true
      setAudioReleaseActive(false)
      return
    }
    if (!wasPlaying.current) return
    wasPlaying.current = false
    setAudioReleaseActive(true)
    const timer = window.setTimeout(() => setAudioReleaseActive(false), 1200)
    return () => window.clearTimeout(timer)
  }, [playing])
  useEffect(() => {
    let intersecting = true
    const update = () => setVisible(intersecting && !document.hidden)
    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry.isIntersecting
      update()
    })
    if (region.current) observer.observe(region.current)
    document.addEventListener('visibilitychange', update)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  useEffect(() => {
    saveDraft(config)
  }, [config])
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const updateProjectionCursor = (event: globalThis.PointerEvent) => {
      const bounds = region.current?.getBoundingClientRect()
      if (!bounds || bounds.width === 0 || bounds.height === 0) return
      debugObjects.current.cursorNdc = {
        x: ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        y: 1 - ((event.clientY - bounds.top) / bounds.height) * 2,
      }
      invalidate.current()
    }
    window.addEventListener('pointermove', updateProjectionCursor)
    return () => window.removeEventListener('pointermove', updateProjectionCursor)
  }, [])
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const save = () => {
      saveDraft({ ...config, model: { ...config.model, rotation: pose.current } })
    }
    window.addEventListener('pagehide', save)
    return () => {
      save()
      window.removeEventListener('pagehide', save)
    }
  }, [config])

  const resetPose = () => {
    pose.current = [...config.model.rotation]
    invalidate.current()
  }
  const finishDrag = () => {
    dragging.current = false
    pointer.current = null
    saveDraft({ ...config, model: { ...config.model, rotation: pose.current } })
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const { key } = event
    if (key !== 'Home') return
    event.preventDefault()
    resetPose()
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || failed) return
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
    dragging.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.focus({ preventScroll: true })
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const previous = pointer.current
    if (!previous || previous.id !== event.pointerId) return
    cameraOrbit.current.theta -= (event.clientX - previous.x) * 0.006
    cameraOrbit.current.phi = Math.max(
      0.08,
      Math.min(Math.PI - 0.08, cameraOrbit.current.phi + (event.clientY - previous.y) * 0.006),
    )
    previous.x = event.clientX
    previous.y = event.clientY
    invalidate.current()
  }

  const running =
    active &&
    visible &&
    ready &&
    (playing || audioReleaseActive || (config.motion.speed > 0 && rotationEnabled))
  return (
    <div className="scene-wrapper">
      <div
        ref={region}
        className={`scene-viewport${ready ? ' is-ready' : ''}`}
        tabIndex={0}
        role="region"
        aria-label="Interactive OHMEGA wireframe sculpture"
        aria-describedby="scene-instructions"
        onKeyDown={handleKeyDown}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={finishDrag}
      >
        {!failed && (
          <SceneErrorBoundary onError={handleError}>
            <Canvas
              dpr={[1, config.quality.maxDpr]}
              frameloop={running ? 'always' : 'demand'}
              camera={{ position: [0, 0, 5], near: 0.01, far: 5000, fov: config.camera.fov }}
              gl={{
                antialias: false,
                alpha: false,
                powerPreference: 'low-power',
                preserveDrawingBuffer: import.meta.env.DEV,
              }}
              onCreated={({ gl }) => {
                gl.toneMapping = NoToneMapping
                gl.outputColorSpace = SRGBColorSpace
                const context = gl.getContext()
                const debugInfo = context.getExtension('WEBGL_debug_renderer_info')
                logPerformance('WEBGL_CONTEXT_CREATED', {
                  renderer: debugInfo
                    ? context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
                    : context.getParameter(context.RENDERER),
                  vendor: debugInfo
                    ? context.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)
                    : context.getParameter(context.VENDOR),
                  canvasWidth: gl.domElement.width,
                  canvasHeight: gl.domElement.height,
                  pixelRatio: gl.getPixelRatio(),
                  maxTextureSize: context.getParameter(context.MAX_TEXTURE_SIZE),
                })
                gl.domElement.addEventListener('webglcontextlost', handleError, { once: true })
              }}
              fallback={<p>View the OHMEGA still image.</p>}
            >
              <SceneContents
                config={config}
                runtime={runtime}
                cardOpen={cardOpen}
                running={running}
                rotationEnabled={rotationEnabled}
                resolution={config.quality.resolution * quality}
                onReady={handleReady}
                onSlow={handleSlow}
                debugObjects={debugObjects}
              />
            </Canvas>
          </SceneErrorBoundary>
        )}
      </div>
      <div className="scene-coordinate" aria-hidden="true">
        <span>VESSEL_001</span>
        <span>SYS / OHMEGA</span>
      </div>
      <div className="scene-controls">
        <span id="scene-instructions">
          {failed ? (
            'STILL / OHMEGA'
          ) : (
            <>
              <span className="desktop-instruction">DRAG TO ORBIT · </span>
              <span className="mobile-instruction">SWIPE TO ORBIT · </span>
              <span className="sr-only">
                Drag to orbit the camera. Press 0 to reset the camera, 1 to toggle sculpture
                rotation, Home to reset the sculpture pose, F to toggle fullscreen, and Escape
                to show or hide keyboard controls.{' '}
              </span>
              EXPLORE THE VESSEL
            </>
          )}
        </span>
        {!failed && (
          <div>
            <button
              aria-label="Reset camera and sculpture"
              onClick={() => {
                cameraOrbit.current = { theta: 0, phi: Math.PI / 2 }
                resetPose()
              }}
            >
              ↺
            </button>
          </div>
        )}
      </div>
      {controlsVisible && createPortal(
        <div
          className="scene-help-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setControlsVisible(false)
          }}
        >
          <section
            className="scene-keyboard-help"
            role="dialog"
            aria-modal="true"
            aria-labelledby="scene-keyboard-title"
            onKeyDown={(event) => {
              if (event.key !== 'Tab') return
              event.preventDefault()
              controlsCloseButton.current?.focus()
            }}
          >
            <header className="scene-keyboard-heading">
              <div>
                <h2 id="scene-keyboard-title">KEYBOARD MAP</h2>
              </div>
              <button
                ref={controlsCloseButton}
                type="button"
                className="scene-keyboard-help-close"
                aria-label="Close keyboard controls"
                onClick={() => setControlsVisible(false)}
              >
                ×
              </button>
            </header>
            <div className="scene-keymap">
              <section
                className="scene-keymap-section scene-keymap-navigation"
                aria-label="Menu navigation"
              >
                <h3>MENU NAVIGATION</h3>
                <div className="scene-keymap-arrow-layout">
                  <div className="scene-keymap-arrows" aria-hidden="true">
                    <kbd className="key-up">↑</kbd>
                    <kbd className="key-left">←</kbd>
                    <kbd className="key-down">↓</kbd>
                    <kbd className="key-right">→</kbd>
                  </div>
                  <div className="scene-keymap-labels">
                    <p>
                      <span>↑ / ↓</span> Move through menu
                    </p>
                    <p>
                      <span>← / →</span> Seek ±10 seconds
                    </p>
                    <p>
                      <span>SHIFT + ← / →</span> Previous / next track
                    </p>
                  </div>
                </div>
              </section>
              <section className="scene-keymap-section" aria-label="Playback">
                <h3>PLAYBACK</h3>
                <div className="scene-keymap-command">
                  <kbd className="key-space">SPACE</kbd><span>Play / pause</span>
                </div>
                <div className="scene-keymap-command">
                  <kbd>F</kbd><span>Toggle fullscreen</span>
                </div>
              </section>
              <section
                className="scene-keymap-section scene-keymap-scene"
                aria-label="Scene controls"
              >
                <h3>SCENE</h3>
                <div className="scene-keymap-command">
                  <kbd>0</kbd><span>Reset camera view</span>
                </div>
                <div className="scene-keymap-command">
                  <kbd>1</kbd><span>Toggle sculpture rotation</span>
                </div>
                <div className="scene-keymap-command">
                  <kbd>HOME</kbd><span>Reset sculpture pose</span>
                </div>
              </section>
            </div>
            <footer className="scene-keyboard-footer">
              <span><kbd>ESC</kbd> Close map</span>
              <span>DRAG / SWIPE TO ORBIT</span>
            </footer>
          </section>
        </div>,
        document.body,
      )}
      <span role="status" className="sr-only">
        {failed
          ? 'Interactive scene unavailable. Showing a still image.'
          : ready
            ? 'Sculpture loaded.'
            : 'Loading sculpture.'}
      </span>
      {DevPanel && (
        <>
          <button
            className="dev-toggle"
            onClick={() => setPanelOpen(!panelOpen)}
            aria-expanded={panelOpen}
          >
            {panelOpen ? 'Close tuning −' : 'Tune scene +'}
          </button>
          {panelOpen && (
            <Suspense fallback={null}>
              <DevPanel
                key={panelRevision}
                config={config}
                setConfig={setConfig}
                getPose={() => [...pose.current]}
                onReplace={(c) => {
                  setConfig(c)
                  setPanelRevision((v) => v + 1)
                }}
                onClose={() => setPanelOpen(false)}
              />
            </Suspense>
          )}
        </>
      )}
    </div>
  )
}
