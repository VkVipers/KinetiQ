function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

function toneForScore(score) {
  if (typeof score !== 'number') return 'neutral'
  if (score >= 80) return 'green'
  if (score >= 55) return 'yellow'
  return 'red'
}

export default function DriverScore({ score, avgRashness }) {
  const tone = toneForScore(score)
  const pct = typeof score === 'number' ? clamp(score, 0, 100) : 0

  return (
    <div className={`card panel panel--${tone}`}>
      <div className="panel__k">Driver Score</div>
      <div className="panel__v">{typeof score === 'number' ? Math.round(score) : '—'}</div>
      <div className="panel__sub">
        Rolling avg rashness: {typeof avgRashness === 'number' ? avgRashness.toFixed(2) : '—'} / 10
      </div>
      <div className="bar">
        <div className="bar__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

