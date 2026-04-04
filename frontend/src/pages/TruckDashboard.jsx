import axios from 'axios'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
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
import { useFleetStore } from '../state/FleetContext.jsx'
import FleetMap from '../components/FleetMap.jsx'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { Zap, AlertCircle, CheckCircle } from 'lucide-react'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://kinetiq-gyrn.onrender.com'
const API_URL = `${API_BASE_URL}/data`

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

function toTimeLabel(isoTimestamp) {
  const d = new Date(isoTimestamp)
  if (Number.isNaN(d.getTime())) return String(isoTimestamp)
  return d.toLocaleTimeString([], { hour12: false })
}

function fmt1(num) {
  if (typeof num !== 'number') return '—'
  return num.toFixed(1)
}

function ratingTone(score10) {
  if (typeof score10 !== 'number') return 'neutral'
  if (score10 < 3) return 'green'
  if (score10 <= 6) return 'yellow'
  return 'red'
}

function statusFromLatest(latestRashness) {
  if (typeof latestRashness !== 'number') return { label: '—', tone: 'neutral' }
  if (latestRashness > 7) return { label: 'CRITICAL', tone: 'red' }
  if (latestRashness > 3) return { label: 'RISKY', tone: 'yellow' }
  return { label: 'SAFE', tone: 'green' }
}

function secondsToHm(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}h ${m}m`
}

function tooltipContent({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const p = payload[0]?.payload
  return (
    <div className="bg-white border border-slate-200 shadow-lg rounded-lg p-3 text-sm min-w-[140px]">
      <div className="text-slate-500 font-bold mb-2 border-b border-slate-100 pb-2 uppercase tracking-wider text-xs">Time: {label}</div>
      <div className="flex justify-between items-center gap-4 mb-2">
        <span className="text-slate-400 font-medium tracking-wide">score</span>
        <span className="text-slate-900 font-black">{typeof p?.rashness_score === 'number' ? p.rashness_score.toFixed(2) : '—'}</span>
      </div>
      <div className="flex justify-between items-center gap-4">
        <span className="text-slate-400 font-medium tracking-wide">event</span>
        <span className="text-slate-700 font-bold text-xs bg-slate-100 px-1.5 py-0.5 rounded">{p?.event || '—'}</span>
      </div>
    </div>
  )
}

export default function TruckDashboard() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { trucks, fleets, activeDeliveries, setActiveDeliveries, completedDeliveries, setCompletedDeliveries, truckTelemetry } = useFleetStore()

  const truck = trucks.find((t) => t.id === id)
  const fleet = fleets.find((f) => f.id === truck?.fleetId)

  // Delivery session management
  const [deliveryId, setDeliveryId] = useState(null)
  const [deliveryStatus, setDeliveryStatus] = useState(null)
  const [isDeliveryActive, setIsDeliveryActive] = useState(false)
  const [truckArrived, setTruckArrived] = useState(false)
  const [allTrucksArrived, setAllTrucksArrived] = useState(false)
  const [completionInProgress, setCompletionInProgress] = useState(false)
  
  const deliveryCreatedRef = useRef(false)
  const completionTriggeredRef = useRef(false)

  // Mock decision-layer metrics (static for now, per requirement)
  const mock = useMemo(() => {
    const seed = String(id || 'truck')
      .split('')
      .reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 1000, 17)
    const driverRating = Math.max(6.8, Math.min(9.2, 7.2 + (seed % 18) / 10)) // out of 10
    const totalTrips = 42 + (seed % 28)
    const routeTrips = 6 + (seed % 10)
    const startSeconds = 2 * 3600 + (seed % 110) * 60 // 2h..3h50m
    return { driverRating, totalTrips, routeTrips, startSeconds }
  }, [id])

  const [points, setPoints] = useState([]) // last 120 seconds
  const [currentProgress, setCurrentProgress] = useState(0)
  const [error, setError] = useState(null)
  const inFlightRef = useRef(false)

  const [callOpen, setCallOpen] = useState(false)
  const [driveSeconds, setDriveSeconds] = useState(mock.startSeconds)

  // Sync progress from central monitoring to local state
  useEffect(() => {
    if (truck?.id) {
      const telemetry = truckTelemetry?.[truck.id]
      if (telemetry?.progress !== undefined) {
        setCurrentProgress(telemetry.progress)
        
        // Update truck arrived status when reaching 100%
        if (telemetry.progress >= 100 && !truckArrived) {
          setTruckArrived(true)
          console.log('✓ Truck arrived (from central monitor)')
        }
      }
    }
  }, [truck?.id, truckTelemetry, truckArrived])

  // Start delivery session on mount - only include trucks from current fleet
  useEffect(() => {
    if (deliveryCreatedRef.current || !fleet) {
      return
    }

    const createOrReuseDelivery = async () => {
      try {
        // Get all trucks in this fleet
        const fleetTruckIds = trucks
          .filter(t => t.fleetId === fleet.id)
          .map(t => t.id)

        if (fleetTruckIds.length === 0) {
          console.warn('No trucks in this fleet')
          return
        }

        // Check if delivery already exists for this fleet
        const existingDeliveryId = activeDeliveries[fleet.id]
        if (existingDeliveryId) {
          console.log(`✓ Reusing existing delivery for ${fleet.name}:`, existingDeliveryId)
          setDeliveryId(existingDeliveryId)
          setIsDeliveryActive(true)
          deliveryCreatedRef.current = true
          return
        }

        // Create new delivery only if it doesn't exist
        const res = await axios.post(`${API_BASE_URL}/delivery/create`, {
          fleet_ids: fleetTruckIds,
          fleet_id: fleet.id,  // Include the frontend fleet ID
          fleet_name: fleet.name,
          source_hub: fleet.source_hub || fleet.source,
          dest_hub: fleet.destination_hub || fleet.destination,
        })
        setDeliveryId(res.data.delivery_id)
        setIsDeliveryActive(true)
        deliveryCreatedRef.current = true
        
        // Track active delivery in context
        setActiveDeliveries(prev => ({ ...prev, [fleet.id]: res.data.delivery_id }))
        
        console.log(`✓ Delivery created for ${fleet.name}:`, res.data.delivery_id, `Trucks: ${fleetTruckIds.join(', ')}`)
      } catch (err) {
        console.error('Failed to create delivery:', err)
      }
    }

    createOrReuseDelivery()
  }, [fleet, trucks, setActiveDeliveries, activeDeliveries])

  useEffect(() => {
    setDriveSeconds(mock.startSeconds)
  }, [mock.startSeconds])

  useEffect(() => {
    const t = setInterval(() => setDriveSeconds((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // Fetch live data including progress
  useEffect(() => {
    if (!isDeliveryActive || !deliveryId || completionTriggeredRef.current) {
      return
    }

    let cancelled = false

    async function fetchOnce() {
      if (inFlightRef.current) return
      inFlightRef.current = true
      try {
        // Use delivery-specific endpoint to avoid cross-contamination
        const res = await axios.get(`${API_BASE_URL}/delivery/${deliveryId}/data`, { timeout: 900 })
        
        // Get truck data - try to find it by truck ID first, then fall back to first available fleet
        let current = res.data?.all_fleets?.[truck?.id]?.current_data
        
        // Fallback: if truck ID not found, use the first fleet's data (all fleets share same progress)
        if (!current) {
          const firstFleetId = Object.keys(res.data?.all_fleets || {})[0]
          if (firstFleetId) {
            current = res.data.all_fleets[firstFleetId].current_data
          }
        }
        
        if (!current || typeof current !== 'object') {
          console.warn('No telemetry data available')
          return
        }

        // Get progress from response - all fleets share same progress within a delivery
        const progress = res.data?.progress_pct || 0
        
        const next = {
          ...current,
          time: toTimeLabel(current.timestamp),
        }

        if (!cancelled) {
          setPoints((prev) => [...prev, next].slice(-120))
          setCurrentProgress(progress)
          
          // Check if this truck has arrived
          if (progress >= 100 && !truckArrived) {
            console.log('✓ This truck arrived at destination')
            setTruckArrived(true)
          }
          
          setError(null)
        }
      } catch (e) {
        if (!cancelled) {
          console.error('Fetch error:', e.message)
          setError('Backend not reachable. Is Flask running on port 5000?')
        }
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
  }, [isDeliveryActive, deliveryId, truck?.id, truckArrived])

  // Listen for delivery completion event from central monitor
  useEffect(() => {
    const handleDeliveryCompleted = (event) => {
      const { delivery_id } = event.detail
      
      // If this is the current delivery, navigate to analytics
      if (delivery_id === deliveryId) {
        console.log('🎯 Delivery completed! Navigating to analytics...')
        completionTriggeredRef.current = true
        setCompletionInProgress(true)
        
        setTimeout(() => {
          navigate(`/delivery/${delivery_id}/analytics`)
        }, 500)
      }
    }

    window.addEventListener('delivery-completed', handleDeliveryCompleted)
    return () => {
      window.removeEventListener('delivery-completed', handleDeliveryCompleted)
    }
  }, [deliveryId, navigate])

  // Monitor for delivery completion (backend auto-completes when reached 100%)
  useEffect(() => {
    if (!deliveryId || completionTriggeredRef.current) {
      return
    }

    let cancelled = false

    const checkCompletion = async () => {
      if (cancelled || completionTriggeredRef.current) return

      try {
        const res = await axios.get(`${API_BASE_URL}/delivery/${deliveryId}/check-completion`)
        const data = res.data

        if (!cancelled) {
          console.log(`📊 Delivery status:`, {
            status: data.status,
            progress: data.progress.toFixed(1),
          })

          // Backend auto-completes, just wait for status change
          if (data.status === "completed") {
            console.log('✅ Delivery marked as completed!')
            // Trigger event for navigation
            window.dispatchEvent(
              new CustomEvent('delivery-completed', {
                detail: { delivery_id: deliveryId }
              })
            )
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Error checking delivery status:', err.message)
        }
      }
    }

    // Check every 2 seconds (central monitor is checking every 1 second anyway)
    checkCompletion()
    const interval = setInterval(checkCompletion, 2000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [deliveryId])

  const latest = points.length ? points[points.length - 1] : null
  const last2MinAvg = useMemo(() => {
    if (!points.length) return null
    const slice = points.slice(-120)
    const nums = slice.map((p) => p.rashness_score).filter((x) => typeof x === 'number')
    if (!nums.length) return null
    return nums.reduce((a, b) => a + b, 0) / nums.length
  }, [points])

  const tripRating = last2MinAvg // already 0..10 from backend
  const tripTone = ratingTone(tripRating)
  
  // Update status based on truck arrival
  let status = statusFromLatest(latest?.rashness_score)
  if (truckArrived) {
    status = { label: 'ARRIVED', tone: 'green' }
  }
  
  const dangerPoints = useMemo(
    () => points.filter((p) => typeof p?.rashness_score === 'number' && p.rashness_score > 7),
    [points],
  )

  if (!truck) {
    return (
      <DashboardLayout activeItem="Fleets" breadcrumbs={
        <>
          <Link to="/" className="text-slate-500 hover:text-blue-600 transition-colors font-semibold tracking-wide uppercase cursor-pointer">TRUCK</Link>
          <span className="mx-2 text-slate-300">/</span>
          <span className="text-slate-800 font-semibold tracking-wide uppercase">Not Found</span>
        </>
      }>
        <div className="p-8 w-full max-w-[1400px] mx-auto flex-1">
           <div className="bg-red-50 p-4 rounded-xl border border-red-200 text-red-900 font-bold">Truck not found</div>
           <Link className="mt-4 inline-block px-5 py-2.5 rounded-lg border border-slate-200 bg-white" to="/fleets">← Back</Link>
        </div>
      </DashboardLayout>
    )
  }

  const breadcrumbs = (
    <>
      <Link to="/" className="text-slate-500 hover:text-blue-600 transition-colors font-semibold tracking-wide uppercase cursor-pointer">FLEET MANAGEMENT</Link>
      <span className="mx-2 text-slate-300">/</span>
      <Link to={fleet ? `/fleet/${fleet.id}` : '/fleets'} className="text-slate-500 hover:text-blue-600 transition-colors font-semibold tracking-wide uppercase cursor-pointer">{fleet?.name || 'Fleet'}</Link>
      <span className="mx-2 text-slate-300">/</span>
      <span className="text-slate-800 font-semibold tracking-wide uppercase">Truck {truck.id}</span>
    </>
  )

  return (
    <DashboardLayout activeItem="Fleets" breadcrumbs={breadcrumbs}>
      <div className="p-8 w-full max-w-[1400px] mx-auto flex-1 flex flex-col overflow-y-auto">
        <div className="flex justify-between items-end mb-8">
            <div>
              <div className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-2">
                Micro View • Vehicle Telemetry
              </div>
              <h1 className="text-4xl leading-none font-black text-slate-900 tracking-tighter" style={{ fontStretch: 'expanded' }}>
                Truck {truck.id} <span className="text-slate-400 font-medium tracking-normal text-2xl">• {truck.driverName}</span>
              </h1>
            </div>
            
            <div className="flex items-center gap-3">
              <div className="px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200 flex items-center gap-2">
                 <span className="text-slate-400 text-xs font-bold uppercase">Fleet</span>
                 <span className="text-slate-900 font-bold text-sm">{fleet?.name || '—'}</span>
              </div>
            </div>
        </div>

        {error ? <div className="w-full bg-red-50 text-red-700 p-4 rounded-xl border border-red-200 mb-6 font-bold">{error}</div> : null}

        {/* Top metrics */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className={`bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden relative p-6`}>
            <div className={`absolute top-0 left-0 w-full h-1.5 ${tripTone === 'green' ? 'bg-emerald-500' : tripTone === 'yellow' ? 'bg-yellow-500' : tripTone === 'red' ? 'bg-pink-500' : 'bg-slate-300'}`}></div>
            <div className="text-slate-500 font-bold text-sm tracking-wide uppercase mb-2">Trip Rating (Live)</div>
            <div className="text-4xl font-black text-slate-800 mb-1" style={{ fontStretch: 'expanded' }}>
               {typeof tripRating === 'number' ? fmt1(tripRating) : '—'} <span className="text-lg text-slate-400">/ 10</span>
            </div>
            <div className="text-slate-400 text-xs font-medium">Rolling avg (last 2 mins)</div>
          </div>

          <div className={`bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden relative p-6`}>
            <div className={`absolute top-0 left-0 w-full h-1.5 bg-slate-300`}></div>
            <div className="text-slate-500 font-bold text-sm tracking-wide uppercase mb-2">Driver Rating</div>
            <div className="text-4xl font-black text-slate-800 mb-1" style={{ fontStretch: 'expanded' }}>
               {fmt1(mock.driverRating)} <span className="text-lg text-slate-400">/ 10</span>
            </div>
            <div className="text-slate-400 text-xs font-medium">Mock history</div>
          </div>

          <div className={`bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden relative p-6`}>
            <div className={`absolute top-0 left-0 w-full h-1.5 bg-slate-300`}></div>
            <div className="text-slate-500 font-bold text-sm tracking-wide uppercase mb-2">Driving Time</div>
            <div className="text-4xl font-black text-slate-800 mb-1" style={{ fontStretch: 'expanded' }}>
               {secondsToHm(driveSeconds)} 
            </div>
            <div className="text-slate-400 text-xs font-medium">Simulated increment</div>
          </div>

          <div className={`bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden relative p-6`}>
            <div className={`absolute top-0 left-0 w-full h-1.5 ${status.tone === 'green' ? 'bg-emerald-500' : status.tone === 'yellow' ? 'bg-yellow-500' : status.tone === 'red' ? 'bg-pink-500' : 'bg-slate-300'}`}></div>
            <div className="text-slate-500 font-bold text-sm tracking-wide uppercase mb-2">Status</div>
            <div className="mt-2 mb-1">
               <span className={`px-3 py-1 rounded-full text-sm font-bold ${status.tone === 'green' ? 'bg-emerald-100 text-emerald-700' : status.tone === 'yellow' ? 'bg-yellow-100 text-yellow-700' : status.tone === 'red' ? 'bg-pink-100 text-pink-700' : 'bg-slate-100 text-slate-700'}`}>{status.label}</span>
            </div>
            <div className="text-slate-400 text-xs font-medium mt-3">Live impact score</div>
          </div>
        </section>

        <section className="mb-8 w-full relative z-0">
          <FleetMap activeTruckId={truck?.id} />
        </section>

        <section className="bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 p-6 mb-8 w-full">
           <div className="flex justify-between items-end mb-6">
             <div>
               <div className="text-slate-900 font-black text-xl tracking-tight">Trip Safety Score (Live)</div>
               <div className="text-slate-400 text-sm font-medium mt-1">High-risk spikes highlighted (score &gt; 7)</div>
             </div>
             
             <div className="flex gap-4 text-xs font-bold text-slate-400 uppercase tracking-widest text-right">
               <div>Latest event: <span className="text-slate-700 ml-1">{latest?.event || '—'}</span></div>
               <div>Points: <span className="text-slate-700 ml-1">{points.length}/120</span></div>
             </div>
           </div>
           
           <ResponsiveContainer width="100%" height={320}>
             <LineChart data={points} margin={{ top: 5, right: 12, bottom: 0, left: 0 }}>
               <CartesianGrid stroke="#f1f5f9" vertical={false} />
               <ReferenceArea y1={7} y2={10} fill="rgba(251, 113, 133, 0.1)" strokeOpacity={0} />
               <XAxis
                 dataKey="time"
                 tick={{ fill: '#94a3b8', fontSize: 12, fontWeight: 600 }}
                 tickLine={false}
                 axisLine={false}
                 minTickGap={18}
               />
               <YAxis
                 tick={{ fill: '#94a3b8', fontSize: 12, fontWeight: 600 }}
                 tickLine={false}
                 axisLine={false}
                 width={32}
                 domain={[0, 10]}
               />
               <Tooltip content={tooltipContent} />
               <Line
                 type="monotone"
                 dataKey="rashness_score"
                 stroke="#3b82f6"
                 strokeWidth={2.5}
                 dot={false}
                 isAnimationActive={false}
               />
               <Scatter
                 data={dangerPoints}
                 dataKey="rashness_score"
                 fill="#f43f5e"
                 isAnimationActive={false}
               />
             </LineChart>
           </ResponsiveContainer>
        </section>

        <section className="flex flex-col md:flex-row gap-4 w-full mb-8">
          {!truckArrived ? (
            <>
              <div className="flex items-center gap-3 px-5 py-4 bg-blue-50 border border-blue-200 rounded-xl flex-grow shadow-sm">
                <Zap className="w-6 h-6 text-blue-600 animate-pulse" />
                <div>
                  <p className="text-base font-bold text-blue-900 tracking-tight">Delivery in Progress</p>
                  <p className="text-sm font-medium text-blue-700 mt-0.5">Progress: {currentProgress.toFixed(1)}% • Delivery #{deliveryId?.toUpperCase().slice(0, 8)}</p>
                </div>
              </div>
              <button 
                className="px-6 py-4 bg-slate-900 border border-slate-800 text-white font-bold rounded-xl shadow-sm hover:bg-slate-800 transition-colors"
                onClick={() => setCallOpen(true)}
              >
                📞 Call Driver
              </button>
            </>
          ) : !allTrucksArrived ? (
            <div className="flex items-center gap-3 px-5 py-4 bg-yellow-50 border border-yellow-200 rounded-xl flex-grow shadow-sm">
              <CheckCircle className="w-6 h-6 text-yellow-600 animate-pulse" />
              <div>
                <p className="text-base font-bold text-yellow-900 tracking-tight">✓ This Truck Arrived</p>
                <p className="text-sm font-medium text-yellow-700 mt-0.5">Waiting for other trucks to arrive...</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 px-5 py-4 bg-emerald-50 border border-emerald-200 rounded-xl flex-grow shadow-sm">
              <CheckCircle className="w-6 h-6 text-emerald-600" />
              <div>
                <p className="text-base font-bold text-emerald-900 tracking-tight">✅ All Trucks Arrived</p>
                <p className="text-sm font-medium text-emerald-700 mt-0.5">Redirecting to analytics...</p>
              </div>
            </div>
          )}
        </section>

        {callOpen ? (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setCallOpen(false)}>
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="p-8">
                <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mb-6 mx-auto">
                   <div className="animate-pulse flex items-center justify-center">📞</div>
                </div>
                <div className="text-2xl font-black text-slate-900 tracking-tight mb-2 text-center">Calling Driver…</div>
                <div className="text-slate-500 font-medium text-center">Connecting to <span className="text-slate-800 font-bold">{truck.driverName}</span></div>
              </div>
              <div className="bg-slate-50 border-t border-slate-100 p-4 flex justify-center">
                <button className="px-8 py-3 bg-red-500 text-white font-bold rounded-xl shadow-sm hover:bg-red-600 transition-colors w-full" onClick={() => setCallOpen(false)}>
                  End Call
                </button>
              </div>
            </div>
          </div>
        ) : null}

      </div>
    </DashboardLayout>
  )
}

