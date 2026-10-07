import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

const bucketUrl = 'https://pub-16aec37c4acb4d7aafcea0bd47e0382b.r2.dev'
const artworkPaths: Record<string, string> = {
  generationOHMEGA: 'albums/generationOHMEGA/4k_gen0_6_compressed.jpg',
  FIVEBYFIVE: 'eps/FIVEBYFIVE/2025_05_19_FiveByFive_3_4000x4000.png',
}

export type MusicTrack = {
  id: string
  title: string
  audioUrl: string
  artworkUrl: string
}

export type MusicProject = {
  id: string
  title: string
  objectPrefix: string
  artworkUrl: string
  tracks: MusicTrack[]
}

type PlayerState = {
  projects: MusicProject[]
  selectedProjectId: string | null
  tracks: MusicTrack[]
  waveforms: Record<string, number[]>
  waveformsReady: boolean
  waveformError: string | null
  trackIndex: number
  currentTrack: MusicTrack | null
  catalogueStatus: 'loading' | 'ready' | 'error'
  catalogueError: string | null
  playbackError: string | null
  playing: boolean
  duration: number
  position: number
  artworkAccent: string | null
  setArtworkAccent: (color: string | null) => void
  selectProject: (id: string) => void
  skipTrack: (direction: -1 | 1) => void
  changeTrack: (index: number) => void
  requestWaveform: (track: MusicTrack) => void
  togglePlayback: () => void
  seekTo: (milliseconds: number) => void
  retryCatalogue: () => void
}

const PlayerContext = createContext<PlayerState | null>(null)

function publicUrl(path: string) {
  return `${bucketUrl}/${path.split('/').map(encodeURIComponent).join('/')}`
}

function parseIndex(source: string) {
  const rows = source.split(/\r?\n/).map((line) => line.trim())
  const projects: Array<{ id: string; title: string; prefix: string }> = []
  for (let index = 0; index < rows.length; index++) {
    const title = rows[index].match(/^([^:#]+):$/)?.[1]?.trim()
    if (!title) continue
    const path = rows.slice(index + 1).find((line) => line && !line.startsWith('#'))
    if (!path || !path.endsWith('/*')) continue
    projects.push({
      id: title,
      title,
      prefix: path.slice(0, -2).replace(/^\/+|\/+$/g, ''),
    })
    index = rows.indexOf(path, index + 1)
  }
  return projects
}

function trackUrl(projectPrefix: string, title: string) {
  const fileName = title.replace(/\.wav$/i, '')
  return publicUrl(`music/${projectPrefix}/${fileName}.wav`)
}

async function calculateWaveformPeaks(url: string, signal: AbortSignal) {
  const response = await fetch(url, { mode: 'cors', cache: 'no-store', signal })
  if (!response.ok) throw new Error(`Audio request failed (${response.status})`)
  const encodedAudio = await response.arrayBuffer()
  const context = new AudioContext()
  try {
    const decodedAudio = await context.decodeAudioData(encodedAudio)
    const peakCount = 2048
    const samplesPerPeak = Math.max(1, Math.ceil(decodedAudio.length / peakCount))
    const peaks = new Array<number>(Math.ceil(decodedAudio.length / samplesPerPeak)).fill(0)
    for (let channelIndex = 0; channelIndex < decodedAudio.numberOfChannels; channelIndex++) {
      const channel = decodedAudio.getChannelData(channelIndex)
      for (let peakIndex = 0; peakIndex < peaks.length; peakIndex++) {
        const start = peakIndex * samplesPerPeak
        const end = Math.min(channel.length, start + samplesPerPeak)
        let maximum = peaks[peakIndex]
        for (let sampleIndex = start; sampleIndex < end; sampleIndex++) {
          maximum = Math.max(maximum, Math.abs(channel[sampleIndex]))
        }
        peaks[peakIndex] = maximum
      }
    }
    const maximum = Math.max(...peaks, 1e-6)
    return peaks.map((peak) => peak / maximum)
  } finally {
    await context.close()
  }
}

async function fetchCatalogue(signal: AbortSignal) {
  const response = await fetch(`${bucketUrl}/music/indexing.txt`, { cache: 'no-store', signal })
  if (!response.ok) throw new Error(`Project index request failed (${response.status})`)
  const indexText = await response.text()
  const entries = parseIndex(indexText)
  if (!entries.length) throw new Error('The project index does not contain any projects.')

  const results = await Promise.all(
    entries.map(async (entry) => {
      const base = `music/${entry.prefix}`
      const artworkUrl = artworkPaths[entry.title]
        ? publicUrl(`music/${artworkPaths[entry.title]}`)
        : ''
      try {
        const response = await fetch(publicUrl(`${base}/tracklist.txt`), {
          cache: 'no-store',
          signal,
        })
        if (!response.ok) throw new Error(`tracklist request failed (${response.status})`)
        const tracklist = (await response.text())
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith('#'))
        const project: MusicProject = {
          ...entry,
          objectPrefix: entry.prefix,
          artworkUrl,
          tracks: tracklist.map((title, index) => ({
            id: `${entry.id}-${index + 1}`,
            title: title.replace(/\.wav$/i, ''),
            audioUrl: trackUrl(entry.prefix, title),
            artworkUrl,
          })),
        }
        return { project, error: null }
      } catch (error) {
        if (signal.aborted) throw error
        return {
          project: { ...entry, objectPrefix: entry.prefix, artworkUrl, tracks: [] } satisfies MusicProject,
          error: `${entry.title}: ${error instanceof Error ? error.message : 'tracklist unavailable'}`,
        }
      }
    }),
  )
  return {
    projects: results.map((result) => result.project),
    errors: results
      .map((result) => result.error)
      .filter((error): error is string => error !== null),
  }
}

export function MusicPlayerProvider({ children }: { children: ReactNode }) {
  const audio = useRef<HTMLAudioElement>(null)
  const playingRef = useRef(false)
  const autoplayOnSourceChange = useRef(false)
  const catalogueRequest = useRef(0)
  const [projects, setProjects] = useState<MusicProject[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [currentTrack, setCurrentTrack] = useState<MusicTrack | null>(null)
  const [waveforms, setWaveforms] = useState<Record<string, number[]>>({})
  const [waveformsReady, setWaveformsReady] = useState(false)
  const [waveformError, setWaveformError] = useState<string | null>(null)
  const waveformCache = useRef<Record<string, number[]>>({})
  const waveformRequests = useRef(new Map<string, AbortController>())
  const waveformSelection = useRef<string | null>(null)
  const [catalogueStatus, setCatalogueStatus] = useState<PlayerState['catalogueStatus']>('loading')
  const [catalogueError, setCatalogueError] = useState<string | null>(null)
  const [playbackError, setPlaybackError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [position, setPosition] = useState(0)
  const [artworkAccent, setArtworkAccent] = useState<string | null>(null)
  const tracks = useMemo(
    () => projects.find((project) => project.id === selectedProjectId)?.tracks ?? [],
    [projects, selectedProjectId],
  )
  const trackIndex = Math.max(0, tracks.findIndex((track) => track.id === currentTrack?.id))

  const loadCatalogue = useCallback(() => {
    const requestId = ++catalogueRequest.current
    const controller = new AbortController()
    waveformRequests.current.forEach((pending) => pending.abort())
    waveformRequests.current.clear()
    waveformCache.current = {}
    waveformSelection.current = null
    setWaveforms({})
    setWaveformsReady(false)
    setWaveformError(null)
    setCatalogueStatus('loading')
    setCatalogueError(null)
    void fetchCatalogue(controller.signal)
      .then(({ projects: loadedProjects, errors }) => {
        if (requestId !== catalogueRequest.current) return
        setProjects(loadedProjects)
        const selected = loadedProjects[0]
        setSelectedProjectId(selected?.id ?? null)
        setCurrentTrack(selected?.tracks[0] ?? null)
        setWaveformsReady(true)
        setCatalogueError(errors.length ? errors.join(' · ') : null)
        setCatalogueStatus('ready')
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || requestId !== catalogueRequest.current) return
        setCatalogueStatus('error')
        setCatalogueError(
          error instanceof Error ? error.message : 'Unable to load the project catalogue.',
        )
      })
    return () => controller.abort()
  }, [])

  useEffect(() => loadCatalogue(), [loadCatalogue])

  useEffect(() => () => {
    waveformRequests.current.forEach((controller) => controller.abort())
  }, [])

  useEffect(() => {
    const element = audio.current
    if (!element || !currentTrack) return
    if (element.src === currentTrack.audioUrl) {
      if (autoplayOnSourceChange.current) {
        autoplayOnSourceChange.current = false
        void element.play().catch(() =>
          setPlaybackError('Playback was blocked. Press play to try again.'),
        )
      }
      return
    }
    element.pause()
    setPlaybackError(null)
    setPosition(0)
    setDuration(0)
    element.src = currentTrack.audioUrl
    element.load()
    if (autoplayOnSourceChange.current) {
      autoplayOnSourceChange.current = false
      void element.play().catch(() =>
        setPlaybackError('Playback was blocked. Press play to try again.'),
      )
    }
  }, [currentTrack])

  useEffect(() => {
    const element = audio.current
    if (!element) return
    const updatePosition = () => setPosition(element.currentTime * 1000)
    const updateDuration = () => {
      if (Number.isFinite(element.duration)) setDuration(element.duration * 1000)
    }
    const onPlay = () => {
      playingRef.current = true
      setPlaying(true)
      setPlaybackError(null)
    }
    const onPause = () => {
      playingRef.current = false
      setPlaying(false)
    }
    const onEnded = () => {
      const next = tracks[(trackIndex + 1) % tracks.length]
      if (next) {
        autoplayOnSourceChange.current = true
        setCurrentTrack(next)
      }
    }
    const onError = () => {
      if (element.error) setPlaybackError('This track could not be loaded from the music bucket.')
    }
    element.addEventListener('timeupdate', updatePosition)
    element.addEventListener('durationchange', updateDuration)
    element.addEventListener('loadedmetadata', updateDuration)
    element.addEventListener('play', onPlay)
    element.addEventListener('pause', onPause)
    element.addEventListener('ended', onEnded)
    element.addEventListener('error', onError)
    return () => {
      element.removeEventListener('timeupdate', updatePosition)
      element.removeEventListener('durationchange', updateDuration)
      element.removeEventListener('loadedmetadata', updateDuration)
      element.removeEventListener('play', onPlay)
      element.removeEventListener('pause', onPause)
      element.removeEventListener('ended', onEnded)
      element.removeEventListener('error', onError)
    }
  }, [tracks, trackIndex])

  const play = useCallback(async () => {
    const element = audio.current
    if (!element || !currentTrack) return
    try {
      await element.play()
    } catch {
      setPlaybackError('Playback could not start. Press play to try again.')
    }
  }, [currentTrack])

  const playElement = useCallback(async (element: HTMLAudioElement) => {
    try {
      await element.play()
    } catch {
      setPlaybackError('Playback could not start. Press play to try again.')
    }
  }, [])

  const requestWaveform = useCallback((track: MusicTrack) => {
    waveformSelection.current = track.id
    setWaveformError(null)
    waveformRequests.current.forEach((controller, id) => {
      if (id !== track.id) controller.abort()
    })
    const cached = waveformCache.current[track.id]
    if (cached) {
      setWaveformsReady(true)
      return
    }
    if (waveformRequests.current.has(track.id)) return
    const controller = new AbortController()
    waveformRequests.current.set(track.id, controller)
    setWaveformsReady(false)
    void calculateWaveformPeaks(track.audioUrl, controller.signal)
      .then((peaks) => {
        waveformCache.current[track.id] = peaks
        setWaveforms((current) => ({ ...current, [track.id]: peaks }))
        if (waveformSelection.current === track.id) setWaveformsReady(true)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if (waveformSelection.current === track.id) {
          setWaveformError(error instanceof Error ? error.message : 'Waveform data is unavailable.')
          setWaveformsReady(true)
        }
      })
      .finally(() => {
        if (waveformRequests.current.get(track.id) === controller) {
          waveformRequests.current.delete(track.id)
        }
      })
  }, [])

  const selectProject = useCallback((id: string) => {
    const project = projects.find((entry) => entry.id === id)
    if (!project) return
    audio.current?.pause()
    autoplayOnSourceChange.current = false
    setSelectedProjectId(id)
    setCurrentTrack(project.tracks[0] ?? null)
  }, [projects])

  const changeTrack = useCallback((index: number) => {
    if (!tracks.length) return
    const next = tracks[(index + tracks.length) % tracks.length]
    if (!next) return
    requestWaveform(next)
    if (next.id === currentTrack?.id) void play()
    else {
      const element = audio.current
      if (element) {
        element.pause()
        element.src = next.audioUrl
        element.load()
        setPosition(0)
        setDuration(0)
        setPlaybackError(null)
        void playElement(element)
      }
      setCurrentTrack(next)
    }
  }, [currentTrack, play, playElement, requestWaveform, tracks])

  const skipTrack = useCallback((direction: -1 | 1) => {
    if (!tracks.length) return
    changeTrack(trackIndex + direction)
  }, [changeTrack, trackIndex, tracks.length])

  const togglePlayback = useCallback(() => {
    const element = audio.current
    if (!element || !currentTrack) return
    if (playingRef.current) element.pause()
    else void play()
  }, [currentTrack, play])

  const seekTo = useCallback((milliseconds: number) => {
    const element = audio.current
    if (!element || !Number.isFinite(milliseconds)) return
    element.currentTime = Math.max(0, Math.min(milliseconds, duration || milliseconds)) / 1000
  }, [duration])

  const state: PlayerState = {
    projects,
    selectedProjectId,
    tracks,
    waveforms,
    waveformsReady,
    waveformError,
    trackIndex,
    currentTrack,
    catalogueStatus,
    catalogueError,
    playbackError,
    playing,
    duration,
    position,
    artworkAccent,
    setArtworkAccent,
    selectProject,
    skipTrack,
    changeTrack,
    requestWaveform,
    togglePlayback,
    seekTo,
    retryCatalogue: loadCatalogue,
  }

  return (
    <PlayerContext.Provider value={state}>
      <audio
        ref={audio}
        className="music-source"
        crossOrigin="anonymous"
        preload="metadata"
        aria-hidden="true"
      />
      {children}
    </PlayerContext.Provider>
  )
}

export function useMusicPlayer() {
  const state = useContext(PlayerContext)
  if (!state) throw new Error('useMusicPlayer must be used inside MusicPlayerProvider')
  return state
}
