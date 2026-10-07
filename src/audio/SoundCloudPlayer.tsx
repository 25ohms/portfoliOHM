import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

const soundCloudUrl = 'https://soundcloud.com/25ohms'
const widgetUrl = `https://w.soundcloud.com/player/?url=${encodeURIComponent(soundCloudUrl)}&auto_play=false&hide_related=true&show_comments=false&show_user=false&show_reposts=false&visual=false`

export type SoundCloudTrack = {
  id?: number | string
  title?: string
  artwork_url?: string
  waveform_url?: string
  duration?: number
  user?: { username?: string }
}
type SoundCloudProgress = { currentPosition?: number; duration?: number }
type SoundCloudWidget = {
  bind: (event: string, callback: (data?: SoundCloudProgress) => void) => void
  play: () => void
  pause: () => void
  next: () => void
  prev: () => void
  skip: (index: number) => void
  seekTo: (milliseconds: number) => void
  getDuration: (callback: (duration: number) => void) => void
  getCurrentSound: (callback: (sound: SoundCloudTrack) => void) => void
  getSounds: (callback: (sounds: SoundCloudTrack[]) => void) => void
  getCurrentSoundIndex: (callback: (index: number) => void) => void
}
type SoundCloudEvents = {
  READY: string
  PLAY: string
  PAUSE: string
  FINISH: string
  PLAY_PROGRESS: string
  LOAD_PROGRESS: string
}
declare global {
  interface Window {
    SC?: { Widget: { (iframe: HTMLIFrameElement): SoundCloudWidget; Events: SoundCloudEvents } }
  }
}

type PlayerState = {
  tracks: SoundCloudTrack[]
  waveforms: Record<string, number[]>
  trackIndex: number
  currentTrack: SoundCloudTrack | null
  waveformsReady: boolean
  playing: boolean
  duration: number
  position: number
  artworkAccent: string | null
  setArtworkAccent: (color: string | null) => void
  skipTrack: (direction: -1 | 1) => void
  changeTrack: (index: number) => void
  togglePlayback: () => void
  seekTo: (milliseconds: number) => void
}

const PlayerContext = createContext<PlayerState | null>(null)
const WAVEFORM_CACHE_KEY = '25ohms.waveforms.v1'

function sameTrack(first: SoundCloudTrack | null, second: SoundCloudTrack) {
  if (!first) return false
  if (first.id != null && second.id != null) return String(first.id) === String(second.id)
  return first.title === second.title
}

function soundDuration(sound: SoundCloudTrack) {
  return typeof sound.duration === 'number' && Number.isFinite(sound.duration) && sound.duration > 0
    ? sound.duration
    : 0
}

function cachedWaveforms(): Record<string, number[]> {
  try {
    const value = JSON.parse(localStorage.getItem(WAVEFORM_CACHE_KEY) || '{}') as Record<
      string,
      unknown
    >
    return Object.fromEntries(
      Object.entries(value).filter(
        ([, samples]) =>
          Array.isArray(samples) && samples.every((sample) => typeof sample === 'number'),
      ),
    ) as Record<string, number[]>
  } catch {
    return {}
  }
}

function waveformDataUrl(url: string) {
  return url.replace(/\.(?:png|jpe?g)(?=([?#]|$))/i, '.json')
}

function useSoundCloudPlayerState(iframe: React.RefObject<HTMLIFrameElement | null>): PlayerState {
  const widget = useRef<SoundCloudWidget | null>(null)
  const tracksRef = useRef<SoundCloudTrack[]>([])
  const trackIndexRef = useRef(0)
  const currentTrackRef = useRef<SoundCloudTrack | null>(null)
  const durationRef = useRef(0)
  const [tracks, setTracks] = useState<SoundCloudTrack[]>([])
  const [waveforms, setWaveforms] = useState<Record<string, number[]>>(cachedWaveforms)
  const cachedWaveformsRef = useRef(waveforms)
  const [trackIndex, setTrackIndex] = useState(0)
  const [currentTrack, setCurrentTrack] = useState<SoundCloudTrack | null>(null)
  const [waveformsReady, setWaveformsReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [position, setPosition] = useState(0)
  const [artworkAccent, setArtworkAccent] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    const connect = () => {
      if (!mounted || !iframe.current || !window.SC) return
      const player = window.SC.Widget(iframe.current)
      const events = window.SC.Widget.Events
      widget.current = player
      player.bind(events.READY, () => {
        player.getSounds((sounds) => {
          if (!mounted) return
          tracksRef.current = sounds
          setTracks(sounds)
          const missing = sounds.filter(
            (sound) => sound.waveform_url && !cachedWaveformsRef.current[sound.waveform_url],
          )
          void Promise.all(
            missing.map(async (sound) => {
              const waveformUrl = sound.waveform_url
              if (!waveformUrl) return null
              try {
                const response = await fetch(waveformDataUrl(waveformUrl))
                if (!response.ok) return null
                const payload = (await response.json()) as { samples?: unknown }
                if (!Array.isArray(payload.samples) || !payload.samples.length) return null
                const samples = payload.samples.filter(
                  (sample): sample is number =>
                    typeof sample === 'number' && Number.isFinite(sample),
                )
                const maximum = Math.max(...samples, 1)
                return [waveformUrl, samples.map((sample) => sample / maximum)] as const
              } catch {
                return null
              }
            }),
          ).then((results) => {
            if (!mounted) return
            const next = { ...cachedWaveformsRef.current }
            for (const result of results) {
              if (result) next[result[0]] = result[1]
            }
            cachedWaveformsRef.current = next
            setWaveforms(next)
            setWaveformsReady(true)
            try {
              localStorage.setItem(WAVEFORM_CACHE_KEY, JSON.stringify(next))
            } catch {
              // Waveforms still render for this visit when browser storage is unavailable.
            }
          })
        })
        player.getCurrentSound((sound) => {
          if (!mounted) return
          currentTrackRef.current = sound
          setCurrentTrack(sound)
          if (soundDuration(sound)) {
            durationRef.current = soundDuration(sound)
            setDuration(durationRef.current)
          }
        })
        player.getCurrentSoundIndex((index) => {
          if (!mounted) return
          trackIndexRef.current = index
          setTrackIndex(index)
        })
        player.getDuration((value) => {
          if (!mounted) return
          durationRef.current = value
          setDuration(value)
        })
      })
      player.bind(events.PLAY, () => {
        if (mounted) setPlaying(true)
        player.getCurrentSound((sound) => {
          if (!mounted) return
          if (!sameTrack(currentTrackRef.current, sound)) {
            currentTrackRef.current = sound
            setPosition(0)
            durationRef.current = soundDuration(sound)
            setDuration(durationRef.current)
            if (!durationRef.current) {
              player.getDuration((value) => {
                if (!mounted) return
                durationRef.current = value
                setDuration(value)
              })
            }
          }
          setCurrentTrack(sound)
        })
        player.getCurrentSoundIndex((index) => {
          if (!mounted) return
          trackIndexRef.current = index
          setTrackIndex(index)
        })
      })
      player.bind(events.PAUSE, () => {
        if (mounted) setPlaying(false)
      })
      player.bind(events.FINISH, () => {
        const length = tracksRef.current.length
        if (!length) return
        const target = (trackIndexRef.current + 1) % length
        player.skip(target)
        trackIndexRef.current = target
        setTrackIndex(target)
      })
      player.bind(events.PLAY_PROGRESS, (data) => {
        if (!mounted || !data) return
        if (data.duration && Number.isFinite(data.duration) && data.duration > 0) {
          durationRef.current = data.duration
          setDuration(data.duration)
        }
        const currentDuration = data.duration || durationRef.current
        const currentPosition = data.currentPosition || 0
        setPosition(currentDuration ? Math.min(currentPosition, currentDuration) : currentPosition)
      })
      player.bind(events.LOAD_PROGRESS, () =>
        player.getDuration((value) => {
          if (!mounted) return
          durationRef.current = value
          setDuration(value)
        }),
      )
    }

    if (window.SC) connect()
    else {
      const existing = document.querySelector<HTMLScriptElement>('script[data-soundcloud-widget]')
      const script = existing || document.createElement('script')
      if (!existing) {
        script.src = 'https://w.soundcloud.com/player/api.js'
        script.async = true
        script.dataset.soundcloudWidget = 'true'
      }
      script.addEventListener('load', connect, { once: true })
      if (!existing) document.body.appendChild(script)
    }
    return () => {
      mounted = false
    }
  }, [iframe])

  const changeTrack = (index: number) => {
    const length = tracksRef.current.length
    if (!length) return
    const target = (index + length) % length
    if (target === trackIndexRef.current) widget.current?.play()
    else widget.current?.skip(target)
    trackIndexRef.current = target
    setTrackIndex(target)
  }

  const skipTrack = (direction: -1 | 1) => {
    const length = tracksRef.current.length
    if (!length) return
    const current = trackIndexRef.current
    const target = (current + direction + length) % length
    widget.current?.skip(target)
    trackIndexRef.current = target
    setTrackIndex(target)
  }

  return {
    tracks,
    waveforms,
    trackIndex,
    currentTrack,
    waveformsReady,
    playing,
    duration,
    position,
    artworkAccent,
    setArtworkAccent,
    skipTrack,
    changeTrack,
    togglePlayback: () => (playing ? widget.current?.pause() : widget.current?.play()),
    seekTo: (milliseconds: number) => widget.current?.seekTo(milliseconds),
  }
}

export function SoundCloudPlayerProvider({ children }: { children: ReactNode }) {
  const iframe = useRef<HTMLIFrameElement>(null)
  const state = useSoundCloudPlayerState(iframe)
  return (
    <PlayerContext.Provider value={state}>
      <iframe
        ref={iframe}
        className="soundcloud-source"
        title="SoundCloud audio source"
        src={widgetUrl}
        allow="autoplay"
      />
      {children}
    </PlayerContext.Provider>
  )
}

export function useSoundCloudPlayer() {
  const state = useContext(PlayerContext)
  if (!state) throw new Error('useSoundCloudPlayer must be used inside SoundCloudPlayerProvider')
  return state
}
