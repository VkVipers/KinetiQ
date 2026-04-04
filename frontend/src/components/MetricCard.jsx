export default function MetricCard({ label, value, unit, accent = 'neutral' }) {
  return (
    <div className={`card metric metric--${accent}`}>
      <div className="metric__label">{label}</div>
      <div className="metric__value">
        {value}
        {unit ? <span className="metric__unit">{unit}</span> : null}
      </div>
    </div>
  )
}

