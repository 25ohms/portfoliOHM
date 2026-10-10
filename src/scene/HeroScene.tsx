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
import SceneContents from './SceneContents'

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
  cardOpen = false,
  onSettled,
}: {
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
  const rotationEnabledRef = useRef(rotationEnabled)
  rotationEnabledRef.current = rotationEnabled
  const [audioReleaseActive, setAudioReleaseActive] = useState(false)
  const wasPlaying = useRef(false)
  const region = useRef<HTMLDivElement>(null)
  const pose = useRef<Vec3>([...config.model.rotation])
  const invalidate = useRef<() => void>(() => {})
  const dragging = useRef(false)
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null)
  const runtime = useMemo(() => ({ pose, invalidate, dragging }), [])
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
      if (event.key !== '1' || event.repeat) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      )
        return
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
    if (key === 'Home') resetPose()
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
    pose.current[1] += (event.clientX - previous.x) * 0.006
    pose.current[0] += (event.clientY - previous.y) * 0.006
    previous.x = event.clientX
    previous.y = event.clientY
    invalidate.current()
  }

  const running =
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
              camera={{ position: [0, 0, 5], near: 0.01, far: 1200, fov: config.camera.fov }}
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
              <span className="desktop-instruction">DRAG TO ROTATE · </span>
              <span className="mobile-instruction">SWIPE TO ROTATE · </span>
              <span className="sr-only">
                Drag to rotate. Press 1 to toggle rotation movement. Home resets.{' '}
              </span>
              EXPLORE THE VESSEL
            </>
          )}
        </span>
        {!failed && (
          <div>
            <button aria-label="Reset sculpture pose" onClick={resetPose}>
              ↺
            </button>
          </div>
        )}
      </div>
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
