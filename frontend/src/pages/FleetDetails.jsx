import { Link, useParams } from 'react-router-dom'
import TruckRow from '../components/TruckRow.jsx'
import { useFleetStore } from '../state/FleetContext.jsx'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { AlertCircle } from 'lucide-react'

function riskFromRashness(rash) {
  if (typeof rash !== 'number') return '—'
  if (rash < 3) return 'Low'
  if (rash <= 6) return 'Medium'
  return 'High'
}

function fakeCoords(truckId) {
  // Stable fake coords per truck ID (no map required)
  let h = 0
  for (let i = 0; i < truckId.length; i++) h = (h * 31 + truckId.charCodeAt(i)) % 10000
  const lat = (25.05 + (h % 120) / 1000).toFixed(4)
  const lon = (55.10 + ((h / 2) % 120) / 1000).toFixed(4)
  return `${lat}, ${lon}`
}

export default function FleetDetails() {
  const { id } = useParams()
  const { fleets, trucks, truckTelemetry } = useFleetStore()

  const fleet = fleets.find((f) => f.id === id)
  const fleetTrucks = trucks.filter((t) => t.fleetId === id)

  const breadcrumbs = (
    <>
      <Link to="/" className="text-slate-500 hover:text-blue-600 transition-colors font-semibold tracking-wide uppercase cursor-pointer">FLEET MANAGEMENT</Link>
      <span className="mx-2 text-slate-300">/</span>
      <Link to="/fleets" className="text-slate-500 hover:text-blue-600 transition-colors font-semibold tracking-wide uppercase cursor-pointer">ACTIVE FLEETS</Link>
      <span className="mx-2 text-slate-300">/</span>
      <span className="text-slate-800 font-semibold tracking-wide uppercase">{fleet?.name || 'Unknown'}</span>
    </>
  )

  if (!fleet) {
    return (
      <DashboardLayout activeItem="Fleets" breadcrumbs={
        <>
          <Link to="/" className="text-slate-500 hover:text-blue-600 transition-colors font-semibold tracking-wide uppercase cursor-pointer">FLEET MANAGEMENT</Link>
          <span className="mx-2 text-slate-300">/</span>
          <span className="text-slate-800 font-semibold tracking-wide uppercase">Status</span>
        </>
      }>
        <div className="p-8 w-full max-w-[1400px] mx-auto flex-1 flex flex-col">
          <div className="w-full bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-4">
              <div className="p-2 bg-red-100 rounded-lg shrink-0">
                <AlertCircle className="text-red-600" size={24} />
              </div>
              <div>
                <div className="text-red-900 font-bold text-lg tracking-tight">Fleet Not Found</div>
                <div className="text-red-700 text-sm font-medium mt-1">The requested fleet ID does not exist.</div>
              </div>
            </div>
            <Link className="px-4 py-2 bg-white border border-red-200 rounded-lg text-red-600 font-medium text-sm hover:bg-red-50" to="/fleets">
              Go Back
            </Link>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout activeItem="Fleets" breadcrumbs={breadcrumbs}>
      <div className="p-8 w-full max-w-[1400px] mx-auto flex-1 flex flex-col">
        {/* Page Title & Actions */}
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-4">
          <div>
            <div className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-2">
              Meso View • Fleet Breakdown
            </div>
            <h1 
              className="text-4xl leading-none font-black text-slate-900 tracking-tighter"
              style={{ fontStretch: 'expanded' }}
            >
              {fleet.name}
            </h1>
            <div className="text-slate-500 font-medium mt-3 flex items-center gap-2">
              <span className="bg-slate-200 text-slate-700 px-2 py-0.5 rounded text-sm font-bold">{fleet.sourceLocation?.name || fleet.source || 'Start'}</span>
              <span className="text-slate-400">→</span>
              <span className="bg-slate-200 text-slate-700 px-2 py-0.5 rounded text-sm font-bold">{fleet.destinationLocation?.name || fleet.destination || 'End'}</span>
              <span className="mx-2 text-slate-300">•</span>
              <span>ETA {fleet.eta || '—'}</span>
            </div>
          </div>
          
          <Link 
            to="/fleets"
            className="px-5 py-2.5 rounded-lg border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-colors bg-white shadow-sm"
          >
            ← Back to Fleets
          </Link>
        </div>

        {/* Trucks List */}
        <div className="flex flex-col gap-4">
          {fleetTrucks.map((t) => {
            const rash = truckTelemetry?.[t.id]?.rashness_score
            const risk = riskFromRashness(rash)
            return <TruckRow key={t.id} truck={t} risk={risk} coords={fakeCoords(t.id)} />
          })}
        </div>
      </div>
    </DashboardLayout>
  )
}
