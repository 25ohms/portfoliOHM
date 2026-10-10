const PREFIX = '[25ohms perf]'
const FRAME_INTERVALS = 60
const REPORT_INTERVAL_MS = 1000
const LOGGER_SETTING = '25ohms:perf-logger'

declare global {
  interface Window {
    __25ohmsPerfLogger?: {
      enable: () => void
      disable: () => void
    }
  }
}

type FrameDropWindow = {
  startMs: number
  endMs: number
  count: number
  missedFrames: number
  maxFrameMs: number
}

let started = false
let enabled = false
let dropWindow: FrameDropWindow | null = null
let sceneFrameCount = 0
let sceneFirstFrameAt = 0
let scenePreviousFrameAt = 0
const sceneFrameIntervals: number[] = []

function rounded(value: number) {
  return Math.round(value * 10) / 10
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 16.7
}

function emit(event: string, data: Record<string, unknown> = {}, warning = false) {
  if (!enabled) return
  const entry = { atMs: rounded(performance.now()), ...data }
  if (warning) console.warn(`${PREFIX} ${event}`, entry)
  else console.info(`${PREFIX} ${event}`, entry)
}

export function logPerformance(event: string, data: Record<string, unknown> = {}) {
  if (enabled && started) emit(event, data)
}

export function recordSceneFrame(deltaMs: number) {
  if (!enabled || !started) return
  const now = performance.now()
  if (sceneFrameCount === 0) {
    sceneFirstFrameAt = now
    emit('SCENE_FIRST_FRAME_CALLBACK', { deltaMs: rounded(deltaMs) })
  } else if (scenePreviousFrameAt > 0) {
    sceneFrameIntervals.push(now - scenePreviousFrameAt)
  }
  scenePreviousFrameAt = now
  sceneFrameCount += 1
  if (sceneFrameCount === 100) {
    const elapsedMs = now - sceneFirstFrameAt
    const intervals = sceneFrameIntervals
    const sorted = [...intervals].sort((a, b) => a - b)
    logPerformance('FIRST_100_SCENE_FRAMES', {
      frameCount: sceneFrameCount,
      elapsedMs: rounded(elapsedMs),
      averageFps: rounded((99 * 1000) / elapsedMs),
      medianFrameMs: rounded(median(intervals)),
      p95FrameMs: rounded(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
      maxFrameMs: rounded(Math.max(...intervals)),
    })
  }
}

function flushDropWindow() {
  if (!dropWindow) return
  emit('FRAME_DROP_WINDOW', dropWindow, true)
  dropWindow = null
}

function installLongTaskObserver() {
  if (!('PerformanceObserver' in window)) return
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const task = entry as PerformanceEntry & {
          attribution?: Array<{ containerType?: string; containerName?: string }>
        }
        const source = task.attribution?.[0]
        emit(
          'LONG_TASK',
          {
            startMs: rounded(entry.startTime),
            durationMs: rounded(entry.duration),
            containerType: source?.containerType,
            containerName: source?.containerName,
          },
          true,
        )
      }
    })
    observer.observe({ type: 'longtask', buffered: true })
  } catch {
    // Long task entries are not available in every browser.
  }

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const frame = entry as PerformanceEntry & {
          renderStart?: number
          styleAndLayoutStart?: number
          scripts?: Array<{
            sourceURL?: string
            invoker?: string
            duration?: number
          }>
        }
        emit(
          'LONG_ANIMATION_FRAME',
          {
            startMs: rounded(entry.startTime),
            durationMs: rounded(entry.duration),
            renderMs:
              frame.renderStart && frame.styleAndLayoutStart
                ? rounded(frame.styleAndLayoutStart - frame.renderStart)
                : undefined,
            scripts: frame.scripts?.map((script) => ({
              source: script.sourceURL
                ? new URL(script.sourceURL).pathname.split('/').slice(-2).join('/')
                : undefined,
              invoker: script.invoker,
              durationMs: script.duration === undefined ? undefined : rounded(script.duration),
            })),
          },
          true,
        )
      }
    })
    observer.observe({ type: 'long-animation-frame', buffered: true })
  } catch {
    // Long animation frame attribution is not available in every browser.
  }
}

function installResourceObserver() {
  if (!('PerformanceObserver' in window)) return
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const resource = entry as PerformanceResourceTiming
        const path = new URL(resource.name, location.href).pathname
        let category: string | null = null
        if (path.includes('/models/')) category = 'model-asset'
        else if (path.endsWith('/music/indexing.txt')) category = 'music-index'
        else if (path.endsWith('/tracklist.txt')) category = 'music-tracklist'
        else if (/\.(wav|mp3|ogg|flac)$/i.test(path)) category = 'audio-asset'
        else if (/\.(png|jpe?g|webp|avif)$/i.test(path)) category = 'image-asset'
        else if (/\.(js|css|woff2?)$/i.test(path)) category = 'app-asset'
        if (!category) continue

        emit('RESOURCE_LOADED', {
          category,
          durationMs: rounded(resource.duration),
          startMs: rounded(resource.startTime),
          transferBytes: resource.transferSize || undefined,
          decodedBytes: resource.decodedBodySize || undefined,
        })
      }
    })
    observer.observe({ type: 'resource', buffered: true })
  } catch {
    // Resource timing entries are not available in every browser.
  }
}

function installFontObserver() {
  document.fonts.addEventListener('loadingdone', (event) => {
    const fontEvent = event as FontFaceSetLoadEvent
    logPerformance('FONT_LOAD_COMPLETE', {
      faces: fontEvent.fontfaces.map((font) => ({ family: font.family, status: font.status })),
    })
  })
  document.fonts.addEventListener('loadingerror', (event) => {
    const fontEvent = event as FontFaceSetLoadEvent
    emit(
      'FONT_LOAD_ERROR',
      { faces: fontEvent.fontfaces.map((font) => ({ family: font.family, status: font.status })) },
      true,
    )
  })
  void document.fonts.ready.then(() => {
    logPerformance('FONTS_READY', {
      faces: [...document.fonts].map((font) => ({ family: font.family, status: font.status })),
    })
  })
}

function startFrameMonitor() {
  let frameCount = 0
  let previousFrame = 0
  let firstFrame = 0
  let expectedFrameMs = 16.7
  const calibration: number[] = []
  const firstHundred: number[] = []

  const recordDrop = (frameMs: number, atMs: number) => {
    const threshold = Math.max(expectedFrameMs * 1.5, expectedFrameMs + 8)
    if (frameMs <= threshold) return
    const missedFrames = Math.max(1, Math.round(frameMs / expectedFrameMs) - 1)
    if (!dropWindow) {
      dropWindow = {
        startMs: rounded(atMs),
        endMs: rounded(atMs),
        count: 0,
        missedFrames: 0,
        maxFrameMs: 0,
      }
    }
    dropWindow.endMs = rounded(atMs)
    dropWindow.count += 1
    dropWindow.missedFrames += missedFrames
    dropWindow.maxFrameMs = Math.max(dropWindow.maxFrameMs, rounded(frameMs))
    if (frameMs >= 50) {
      emit(
        'SEVERE_FRAME_DROP',
        {
          atMs: rounded(atMs),
          frameMs: rounded(frameMs),
          expectedFrameMs: rounded(expectedFrameMs),
          missedFrames,
        },
        true,
      )
    }
  }

  const frame = (timestamp: number) => {
    if (document.visibilityState === 'visible') {
      if (previousFrame === 0 && frameCount > 0) {
        previousFrame = timestamp
        requestAnimationFrame(frame)
        return
      }
      frameCount += 1
      if (frameCount === 1) {
        firstFrame = timestamp
        logPerformance('FIRST_ANIMATION_FRAME')
      } else {
        const interval = timestamp - previousFrame
        firstHundred.push(interval)
        if (frameCount <= FRAME_INTERVALS + 1) calibration.push(interval)

        if (frameCount === FRAME_INTERVALS + 1) {
          const measured = median(calibration)
          expectedFrameMs = measured >= 20 ? 16.7 : measured
          logPerformance('FRAME_RATE_BASELINE', {
            measuredFrameMs: rounded(measured),
            targetFrameMs: rounded(expectedFrameMs),
            estimatedHz: rounded(1000 / measured),
          })
          let calibrationTimestamp = firstFrame
          calibration.forEach((value) => {
            calibrationTimestamp += value
            recordDrop(value, calibrationTimestamp)
          })
        } else if (frameCount > FRAME_INTERVALS + 1) {
          recordDrop(interval, timestamp)
        }

        if (frameCount === 100) {
          const totalMs = timestamp - firstFrame
          logPerformance('FIRST_100_BROWSER_FRAMES', {
            frameCount,
            elapsedMs: rounded(totalMs),
            averageFps: rounded((99 * 1000) / totalMs),
            medianFrameMs: rounded(median(firstHundred)),
            maxFrameMs: rounded(Math.max(...firstHundred)),
            droppedFrameIntervals: firstHundred.filter(
              (value) => value > Math.max(expectedFrameMs * 1.5, expectedFrameMs + 8),
            ).length,
          })
        }

        if (dropWindow && timestamp - dropWindow.startMs >= REPORT_INTERVAL_MS) flushDropWindow()
      }
      previousFrame = timestamp
    } else {
      previousFrame = 0
    }
    requestAnimationFrame(frame)
  }

  document.addEventListener('visibilitychange', () => {
    previousFrame = 0
    if (document.visibilityState === 'hidden') scenePreviousFrameAt = 0
    logPerformance('VISIBILITY_CHANGED', { state: document.visibilityState })
    if (document.visibilityState === 'hidden') flushDropWindow()
  })
  window.addEventListener('pagehide', flushDropWindow)
  requestAnimationFrame(frame)
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  const setEnabled = (value: boolean) => {
    window.localStorage.setItem(LOGGER_SETTING, value ? 'on' : 'off')
    window.location.reload()
  }
  window.__25ohmsPerfLogger = {
    enable: () => setEnabled(true),
    disable: () => setEnabled(false),
  }
  try {
    enabled = window.localStorage.getItem(LOGGER_SETTING) !== 'off'
  } catch {
    enabled = true
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined' && enabled && !started) {
  started = true
  emit('LOGGER_STARTED', {
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    devicePixelRatio: window.devicePixelRatio,
    visibility: document.visibilityState,
  })
  installLongTaskObserver()
  installResourceObserver()
  installFontObserver()
  startFrameMonitor()
}
