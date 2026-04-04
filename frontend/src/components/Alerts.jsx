export default function Alerts({ highImpact }) {
  if (!highImpact) return null
  return (
    <div className="banner banner--danger" role="alert" aria-live="assertive">
      <strong>⚠️ High Impact Detected</strong>
      <span className="banner__sub">rashness_score &gt; 7</span>
    </div>
  )
}

