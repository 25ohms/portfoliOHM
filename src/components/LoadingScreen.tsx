import type { CSSProperties } from 'react'

export default function LoadingScreen({
  progress,
  leaving,
}: {
  progress: number
  leaving: boolean
}) {
  const percent = Math.round(progress * 100)

  return (
    <div className={`boot-screen${leaving ? ' is-leaving' : ''}`}>
      <div
        className="boot-omega"
        role="progressbar"
        aria-label="Loading portfolio"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        style={{ '--load-top': `${100 - percent}%` } as CSSProperties}
      >
        <span className="boot-omega-outline" aria-hidden="true">
          Ω
        </span>
        <span className="boot-omega-fill" aria-hidden="true">
          Ω
        </span>
      </div>
    </div>
  )
}
