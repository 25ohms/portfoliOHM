import { useEffect, useState, type SyntheticEvent } from 'react'
import { imageAccentColor, type RGBColor } from '../utils/color'

const ARTIST_SLUG = '25ohms'
const PAGE_SIZE = 50

type RAEvent = {
  id: string
  title: string
  date: string
  contentUrl?: string | null
  flyerFront?: string | null
  images?: Array<{ filename?: string | null; type?: string | null }> | null
  venue?: { name?: string | null; area?: { name?: string | null } | null } | null
  promoters?: Array<{ name?: string | null; contentUrl?: string | null }> | null
}

type ListingResponse = {
  data?: { listing?: { data?: RAEvent[]; totalResults?: number } }
  errors?: Array<{ message: string }>
}

export type Show = {
  id: string
  title: string
  date: string
  venue: string
  area: string
  promoters: Array<{ name: string; url: string | null }>
  eventUrl: string
  flyer: string | null
}

const SHOW_QUERY = `query ArtistShowListing($filters: [FilterInput], $pageSize: Int, $page: Int) {
  listing(indices: [EVENT], filters: $filters, pageSize: $pageSize, page: $page,
    sortField: EVENTDATE, sortOrder: ASCENDING) {
    data { ... on Event {
      id title date contentUrl flyerFront images { filename type }
      venue { name area { name } }
      promoters { name contentUrl }
    } }
    totalResults
  }
}`

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10)
}

function normalizeShow(event: RAEvent): Show {
  const path = event.contentUrl || `/events/${event.id}`
  const promoters = event.promoters?.flatMap(({ name, contentUrl }) => {
    if (!name) return []
    let url: string | null = null
    if (contentUrl) {
      try {
        url = new URL(contentUrl, 'https://ra.co').toString()
      } catch {
        url = null
      }
    }
    return [{ name, url }]
  }) || []
  const flyer = event.flyerFront || event.images?.find((image) => image.type === 'FLYERFRONT')?.filename || event.images?.[0]?.filename
  return {
    id: String(event.id),
    title: event.title,
    date: event.date,
    venue: event.venue?.name || 'Venue TBA',
    area: event.venue?.area?.name || '',
    promoters: promoters.length ? promoters : [{ name: 'Promoter details on RA', url: null }],
    eventUrl: new URL(path, 'https://ra.co').toString(),
    flyer: normalizeImageUrl(flyer),
  }
}

function normalizeImageUrl(url?: string | null): string | null {
  if (!url) return null
  const absolute = /^https?:\/\//i.test(url)
    ? url
    : url.startsWith('//')
      ? `https:${url}`
      : `https://images.ra.co/${url.replace(/^\/+/, '')}`
  try {
    const image = new URL(absolute)
    if (image.protocol !== 'https:') image.protocol = 'https:'
    return image.toString()
  } catch {
    return null
  }
}

function proxiedImageUrl(url: string): string | null {
  if (!import.meta.env.DEV) return null
  try {
    const image = new URL(url)
    if (image.hostname === 'images.ra.co') return `/api/ra-cdn${image.pathname}${image.search}`
    if (image.hostname === 'static.ra.co') return `/api/ra-static-cdn${image.pathname}${image.search}`
  } catch {
    return null
  }
  return null
}

function retryImageThroughProxy(event: SyntheticEvent<HTMLImageElement>) {
  const image = event.currentTarget
  if (image.dataset.proxyAttempted === 'true') {
    image.classList.add('is-unavailable')
    return
  }
  const proxyUrl = image.dataset.proxyUrl
  if (!proxyUrl) {
    image.classList.add('is-unavailable')
    return
  }
  image.dataset.proxyAttempted = 'true'
  image.src = proxyUrl
}

async function fillMissingFlyers(shows: Show[], signal: AbortSignal): Promise<Show[]> {
  const missing = shows.filter((show) => !show.flyer)
  if (!missing.length) return shows

  const selections = missing.map((show, index) =>
    `show${index}: event(id: ${JSON.stringify(show.id)}) { flyerFront images { filename type } }`,
  )
  try {
    const response = await fetch('/api/ra/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: `query ArtistEventArtwork { ${selections.join('\n')} }` }),
      signal,
    })
    if (!response.ok) return shows
    const payload = (await response.json()) as {
      data?: Record<string, Pick<RAEvent, 'flyerFront' | 'images'> | null>
    }
    return shows.map((show) => {
      if (show.flyer) return show
      const index = missing.findIndex((candidate) => candidate.id === show.id)
      const details = index >= 0 ? payload.data?.[`show${index}`] : null
      const image = details?.flyerFront || details?.images?.find((item) => item.type === 'FLYERFRONT')?.filename || details?.images?.[0]?.filename
      return { ...show, flyer: normalizeImageUrl(image) }
    })
  } catch {
    return shows
  }
}

async function loadShows(signal: AbortSignal): Promise<Show[]> {
  const artistResponse = await fetch('/api/ra/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      operationName: 'ResolveArtist',
      query: 'query ResolveArtist($slug: String) { artist(slug: $slug) { id } }',
      variables: { slug: ARTIST_SLUG },
    }),
    signal,
  })
  if (!artistResponse.ok) throw new Error(`Resident Advisor returned ${artistResponse.status}`)
  const artistPayload = (await artistResponse.json()) as {
    data?: { artist?: { id?: string | number } | null }
    errors?: Array<{ message: string }>
  }
  const artistId = artistPayload.data?.artist?.id
  if (artistPayload.errors?.length || artistId == null) {
    throw new Error(artistPayload.errors?.map(({ message }) => message).join('; ') || 'Artist profile not found')
  }

  const today = dateOnly(new Date())
  const ranges = [
    { upcoming: true, gte: today, lte: '2035-12-31' },
    { upcoming: false, gte: '2000-01-01', lte: today },
  ]

  const results = await Promise.all(ranges.map(async ({ upcoming, gte, lte }) => {
    const events: RAEvent[] = []
    let page = 1
    let totalResults = 0
    do {
      const response = await fetch('/api/ra/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operationName: 'ArtistShowListing',
          query: SHOW_QUERY,
          variables: {
            filters: [
              { type: 'ARTIST', value: String(artistId) },
              { type: 'DATERANGE', value: JSON.stringify({ gte, lte }) },
            ],
            pageSize: PAGE_SIZE,
            page,
          },
        }),
        signal,
      })
      if (!response.ok) throw new Error(`Resident Advisor returned ${response.status}`)
      const payload = (await response.json()) as ListingResponse
      if (payload.errors?.length) throw new Error(payload.errors.map(({ message }) => message).join('; '))
      const listing = payload.data?.listing
      if (!listing) throw new Error('Resident Advisor returned no event listing')
      const pageEvents = listing.data || []
      if (!pageEvents.length) break
      events.push(...pageEvents)
      totalResults = listing.totalResults || 0
      page++
    } while (events.length < totalResults)

    return { upcoming, shows: events.map(normalizeShow) }
  }))

  const deduped = new Map<string, { upcoming: boolean; show: Show }>()
  results.forEach(({ upcoming, shows }) => shows.forEach((show) => {
    const previous = deduped.get(show.id)
    if (!previous || (upcoming && !previous.upcoming)) deduped.set(show.id, { upcoming, show })
  }))
  const orderedShows = [...deduped.values()]
    .sort((left, right) => {
      if (left.upcoming !== right.upcoming) return left.upcoming ? -1 : 1
      const difference = new Date(left.show.date).getTime() - new Date(right.show.date).getTime()
      return left.upcoming ? difference : -difference
    })
    .map(({ show }) => show)
  return fillMissingFlyers(orderedShows, signal)
}

function formatShowDate(date: string) {
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return date
  return new Intl.DateTimeFormat('en-CA', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(parsed)
}

export default function ShowsCard({ onAccentChange }: { onAccentChange: (color: string | null) => void }) {
  const [shows, setShows] = useState<Show[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setStatus('loading')
    void loadShows(controller.signal)
      .then((events) => {
        if (controller.signal.aborted) return
        setShows(events)
        setStatus('ready')
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setError(reason instanceof Error ? reason.message : 'Could not load Resident Advisor events.')
        setStatus('error')
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const flyer = shows.find((show) => show.flyer)?.flyer
    if (!flyer) {
      onAccentChange(null)
      return
    }
    const controller = new AbortController()
    void imageAccentColor(proxiedImageUrl(flyer) || flyer, controller.signal)
      .then((color: RGBColor | null) => {
        if (!controller.signal.aborted) onAccentChange(color ? `rgb(${color.map(Math.round).join(' ')})` : null)
      })
      .catch(() => {
        if (!controller.signal.aborted) onAccentChange(null)
      })
    return () => controller.abort()
  }, [onAccentChange, shows])

  const upcoming = shows.filter((show) => new Date(show.date).getTime() >= new Date().setHours(0, 0, 0, 0))
  const past = shows.filter((show) => !upcoming.includes(show))

  return (
    <section className="content-card shows-card" aria-label="Shows">
      <header className="card-heading">
        <div>
          <h2>Shows</h2>
        </div>
        <a className="shows-ra-link" href="https://ra.co/dj/25ohms" target="_blank" rel="noreferrer">
          RESIDENT ADVISOR ↗
        </a>
      </header>

      {status === 'loading' && <p className="shows-message">SYNCING EVENT ARCHIVE…</p>}
      {status === 'error' && (
        <p className="shows-message" role="status">
          Could not load shows from RA. {error}{' '}
          <a href="https://ra.co/dj/25ohms" target="_blank" rel="noreferrer">Open the artist profile ↗</a>
        </p>
      )}
      {status === 'ready' && shows.length === 0 && <p className="shows-message">No RA events found for this artist yet.</p>}
      {status === 'ready' && (
        <div className="show-sections">
          <ShowSection title="Upcoming" shows={upcoming} upcoming />
          <ShowSection title="Past shows" shows={past} />
        </div>
      )}
    </section>
  )
}

function ShowSection({ title, shows, upcoming = false }: { title: string; shows: Show[]; upcoming?: boolean }) {
  return (
    <section className="show-section" aria-label={title}>
      <h3>{title}<span>{String(shows.length).padStart(2, '0')}</span></h3>
      {shows.length === 0 ? (
        <p className="show-empty">{upcoming ? 'No upcoming shows announced.' : 'No past shows listed.'}</p>
      ) : (
        <ol className="show-list">
          {shows.map((show) => (
            <li className="show-row" key={show.id}>
              <div className={`show-flyer-slot${show.flyer ? '' : ' is-empty'}`}>
                {show.flyer && (
                  <img
                    className="show-flyer"
                    src={show.flyer}
                    data-proxy-url={proxiedImageUrl(show.flyer) || undefined}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={retryImageThroughProxy}
                  />
                )}
              </div>
              <div className="show-info">
                <div className="show-date">{formatShowDate(show.date)}</div>
                <div className="show-copy">
                  <h4>{show.title}</h4>
                  <p>{show.venue}{show.area ? ` · ${show.area}` : ''}</p>
                  <p className="show-promoter">
                    <span className="show-promoter-label">PROMOTED BY</span>{' '}
                    <span className="show-promoter-names">
                      {show.promoters.map((promoter, index) => (
                        <span key={`${promoter.name}-${index}`}>
                          {index > 0 && ', '}
                          {promoter.url ? (
                            <a href={promoter.url} target="_blank" rel="noreferrer">{promoter.name}</a>
                          ) : promoter.name}
                        </span>
                      ))}
                    </span>
                  </p>
                </div>
              </div>
              {upcoming && (
                <a className="show-ticket-link" href={show.eventUrl} target="_blank" rel="noreferrer" aria-label={`Tickets or event details for ${show.title} on Resident Advisor`}>
                  EVENT / TICKETS ↗
                </a>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
