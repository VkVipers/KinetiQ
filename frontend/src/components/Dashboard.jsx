import axios from 'axios'
import { useEffect, useMemo, useRef, useState } from 'react'

import RashnessChart from './Chart.jsx'
import Alerts from './Alerts.jsx'
import DriverScore from './DriverScore.jsx'
import EventBadge from './EventBadge.jsx'
import MetricCard from './MetricCard.jsx'
import { useFleetStore } from '../state/FleetContext.jsx'
import FleetMap from './FleetMap'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://kinetiq-gyrn.onrender.com';
const API_URL = `${API_BASE_URL}/data`

function toTimeLabel(isoTimestamp) {
  const d = new Date(isoTimestamp)
  if (Number.isNaN(d.getTime())) return String(isoTimestamp)
  return d.toLocaleTimeString([], { hour12: false })
}

function fmt(num) {
  if (typeof num !== 'number') return '--'
  return num.toFixed(2)
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

function rashnessStatus(score) {
  if (typeof score !== 'number') return { label: 'Unknown', tone: 'neutral' }
  if (score < 3) return { label: 'Safe', tone: 'green' }
  if (score <= 6) return { label: 'Moderate', tone: 'yellow' }
  return { label: 'Rash', tone: 'red' }
}

function driverScoreFromAvg(avgRashness) {
  if (typeof avgRashness !== 'number') return null
  return clamp(100 - avgRashness * 10, 0, 100)
}

function computeInsight(points) {
  if (!points?.length) return 'Collecting sensor data…'
  const last = points.slice(-50)
  const counts = last.reduce((acc, p) => {
    const k = p.event || 'Normal'
    acc[k] = (acc[k] || 0) + 1
    return acc
  }, {})

  if ((counts['Pothole Impact'] || 0) >= 4) {
    return 'Repeated pothole impacts detected on this route. Consider rerouting to reduce goods damage.'
  }
  if ((counts['Harsh Braking'] || 0) >= 4) {
    return 'Frequent harsh braking detected. Smoother deceleration can reduce cargo shift and damage risk.'
  }
  if ((counts['Sharp Turn'] || 0) >= 4) {
    return 'Repeated sharp turns detected. Reduce cornering speed to prevent goods tipping or sliding.'
  }
  return 'Driving appears stable. Continue monitoring to prevent cumulative goods damage.'
}

export default function Dashboard({ truck }) {
  const [points, setPoints] = useState([])
  const [error, setError] = useState(null)
  const [mode, setMode] = useState('—')
  const [event, setEvent] = useState('Normal')
  const inFlightRef = useRef(false)
  const { setTruckTelemetry } = useFleetStore()

  useEffect(() => {
    let cancelled = false

    async function fetchOnce() {
      if (inFlightRef.current) return
      inFlightRef.current = true
      try {
        const res = await axios.get(API_URL, { timeout: 800 })
        const payload = res.data
        const history = Array.isArray(payload?.history) ? payload.history : []
        const normalized = history.map((p) => ({
          ...p,
          time: toTimeLabel(p.timestamp),
        }))
        if (!cancelled) {
          const nextPoints = normalized.slice(-50)
          setPoints(nextPoints)
          setMode(payload?.mode || '—')
          setEvent(payload?.event || payload?.current_data?.event || 'Normal')
          setError(null)

          const last = nextPoints.length ? nextPoints[nextPoints.length - 1] : null
          if (truck?.id && last) {
            const avg = nextPoints.reduce((acc, p) => acc + (typeof p.rashness_score === 'number' ? p.rashness_score : 0), 0) / nextPoints.length
            const driverScore = clamp(100 - avg * 10, 0, 100)
            setTruckTelemetry((prev) => ({
              ...prev,
              [truck.id]: { ...last, driver_score: driverScore, mode: payload?.mode || '—' },
            }))
          }
        }
      } catch (e) {
        if (!cancelled) setError('Backend not reachable. Is Flask running on port 5000?')
      } finally {
        inFlightRef.current = false
      }
    }

    fetchOnce()
    const id = setInterval(fetchOnce, 1000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const latest = points.length ? points[points.length - 1] : null
  const status = useMemo(() => rashnessStatus(latest?.rashness_score), [latest?.rashness_score])
  const avgRashness = useMemo(() => {
    if (!points.length) return null
    const sum = points.reduce((acc, p) => acc + (typeof p.rashness_score === 'number' ? p.rashness_score : 0), 0)
    return sum / points.length
  }, [points])
  const driverScore = useMemo(() => driverScoreFromAvg(avgRashness), [avgRashness])

  const highImpact = typeof latest?.rashness_score === 'number' && latest.rashness_score > 7
  const risk =
    typeof latest?.rashness_score !== 'number'
      ? { label: '—', tone: 'neutral' }
      : latest.rashness_score < 3
        ? { label: 'Low', tone: 'green' }
        : latest.rashness_score <= 6
          ? { label: 'Medium', tone: 'yellow' }
          : { label: 'High', tone: 'red' }

  const insightText = useMemo(() => computeInsight(points), [points])

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <div className="kicker">Goods Damage Prevention • IoT + AI (MVP)</div>
          <h1 className="title">Goods Damage Prevention Dashboard</h1>
        </div>
        <div className="topbar__right">
          <div className="topline">
            <div className={`status-pill status-pill--${status.tone}`}>
              <span className="dot" />
              Rashness: {status.label}
            </div>
            <div className="pill">
              <span className="pill__k">Mode</span>
              <span className="pill__v">{mode}</span>
            </div>
          </div>
          <EventBadge event={event} />
        </div>
      </header>

      <Alerts highImpact={highImpact} />

      {error ? <div className="error">{error}</div> : null}

      <section style={{ margin: '2rem 0' }}>
        <FleetMap activeTruckId={truck?.id} />
      </section>

      <section className="grid">
        <MetricCard label="accelex_x" value={fmt(latest?.accelex_x)} unit="g" />
        <MetricCard label="accelex_y" value={fmt(latest?.accelex_y)} unit="g" />
        <MetricCard label="gyro_z" value={fmt(latest?.gyro_z)} unit="°/s" />
        <MetricCard
          label="rashness_score"
          value={fmt(latest?.rashness_score)}
          accent={status.tone}
        />
      </section>

      <section className="grid grid--secondary">
        <DriverScore score={driverScore} avgRashness={avgRashness} />
        <div className={`card panel panel--${risk.tone}`}>
          <div className="panel__k">Damage Risk</div>
          <div className="panel__v">{risk.label}</div>
          <div className="panel__sub">Based on current rashness thresholds</div>
        </div>
        <div className="card panel panel--neutral panel--wide">
          <div className="panel__k">Insight</div>
          <div className="panel__text">{insightText}</div>
        </div>
      </section>

      <section className="stack">
        <RashnessChart data={points} />
        <div className="footer-row">
          <div className="muted">
            Latest timestamp:{' '}
            <span className="mono">{latest?.timestamp ? latest.timestamp : '--'}</span>
          </div>
          <div className="muted">Stored points: {points.length}/50</div>
        </div>
      </section>
    </div>
  )
}

