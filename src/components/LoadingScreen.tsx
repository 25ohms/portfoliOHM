import DitheredLogo from './DitheredLogo'

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
        className={`boot-omega${progress >= 1 ? ' is-complete' : ''}`}
        role="progressbar"
        aria-label="Loading portfolio"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <DitheredLogo progress={progress} />
      </div>
    </div>
  )
}
