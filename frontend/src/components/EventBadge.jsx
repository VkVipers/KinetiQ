function eventTone(event) {
  if (!event) return 'neutral'
  if (event === 'Normal') return 'green'
  if (event === 'Harsh Braking' || event === 'Pothole Impact') return 'red'
  if (event === 'Sharp Turn') return 'yellow'
  return 'neutral'
}

function eventIcon(event) {
  if (event === 'Normal') return '✓'
  if (event === 'Harsh Braking') return '⛔'
  if (event === 'Sharp Turn') return '↻'
  if (event === 'Pothole Impact') return '⚠'
  return '•'
}

export default function EventBadge({ event }) {
  const tone = eventTone(event)
  return (
    <div className={`event event--${tone}`}>
      <span className="event__icon" aria-hidden="true">
        {eventIcon(event)}
      </span>
      <div className="event__body">
        <div className="event__k">Detected Event</div>
        <div className="event__v">{event || '—'}</div>
      </div>
    </div>
  )
}

