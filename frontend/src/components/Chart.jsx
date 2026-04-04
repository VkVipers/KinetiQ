import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

function formatTooltipLabel(label) {
  return `Time: ${label}`
}

function TooltipContent({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const p = payload[0]?.payload
  return (
    <div className="tooltip">
      <div className="tooltip__t">{formatTooltipLabel(label)}</div>
      <div className="tooltip__row">
        <span className="tooltip__k">rashness</span>
        <span className="tooltip__v">{typeof p?.rashness_score === 'number' ? p.rashness_score.toFixed(2) : '--'}</span>
      </div>
      <div className="tooltip__row">
        <span className="tooltip__k">event</span>
        <span className="tooltip__v">{p?.event || '—'}</span>
      </div>
      <div className="tooltip__row">
        <span className="tooltip__k">mode</span>
        <span className="tooltip__v">{p?.mode || '—'}</span>
      </div>
    </div>
  )
}

export default function RashnessChart({ data }) {
  const dangerPoints =
    Array.isArray(data) ? data.filter((p) => typeof p?.rashness_score === 'number' && p.rashness_score > 7) : []

  return (
    <div className="card chart">
      <div className="card__header">
        <div className="card__title">Rashness Score (last 50s)</div>
        <div className="card__subtitle">Danger zone highlighted (rashness &gt; 7)</div>
      </div>

      <div className="chart__body">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data} margin={{ top: 5, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
            <ReferenceArea y1={7} y2={10} fill="rgba(251, 113, 133, 0.08)" strokeOpacity={0} />
            <XAxis
              dataKey="time"
              tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              minTickGap={18}
            />
            <YAxis
              tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={32}
              domain={[0, 10]}
            />
            <Tooltip
              content={<TooltipContent />}
            />
            <Line
              type="monotone"
              dataKey="rashness_score"
              stroke="rgba(96, 165, 250, 0.95)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Scatter data={dangerPoints} dataKey="rashness_score" fill="rgba(251, 113, 133, 0.95)" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

