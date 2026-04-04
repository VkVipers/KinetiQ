import React from 'react'
import { Link } from 'react-router-dom'
import FleetCard from '../components/FleetCard.jsx'
import { useFleetStore } from '../state/FleetContext.jsx'
import DashboardLayout from '../components/DashboardLayout.jsx'

function riskFromAvgScore(score) {
  if (typeof score !== 'number') return '—'
  if (score >= 80) return 'Low'
  if (score >= 55) return 'Medium'
  return 'High'
}

function fleetScoreFromTelemetry({ fleetId, trucks, truckTelemetry }) {
  const fleetTrucks = (trucks || []).filter((t) => t.fleetId === fleetId)
  const scores = fleetTrucks
    .map((t) => truckTelemetry?.[t.id]?.driver_score)
    .filter((s) => typeof s === 'number')
  if (!scores.length) return null
  return scores.reduce((a, b) => a + b, 0) / scores.length
}

export default function Fleets() {
  const { fleets, trucks, truckTelemetry, activeDeliveries, completedDeliveries } = useFleetStore()
  const completedFleetIds = new Set(completedDeliveries.map(d => d.frontend_fleet_id))
  
  const visibleFleets = fleets.filter(fleet => 
    activeDeliveries[fleet.id] || !completedFleetIds.has(fleet.id)
  )

  const breadcrumbs = (
    <>
      <Link to="/" className="text-slate-500 hover:text-blue-600 transition-colors font-semibold tracking-wide uppercase cursor-pointer">FLEET MANAGEMENT</Link>
      <span className="mx-2 text-slate-300">/</span>
      <span className="text-slate-800 font-semibold tracking-wide uppercase">Active Fleets</span>
    </>
  )

  return (
    <DashboardLayout activeItem="Fleets" breadcrumbs={breadcrumbs}>
      <div className="p-8 w-full max-w-[1400px] mx-auto flex-1 flex flex-col">
        {/* Page Title & Actions */}
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-4">
          <div>
            <div className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-2">
              Macro View • Fleet Operations
            </div>
            <h1 
              className="text-4xl leading-none font-black text-slate-900 tracking-tighter"
              style={{ fontStretch: 'expanded' }}
            >
              All Fleets
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <Link 
              to="/deliveries/completed"
              className="px-5 py-2.5 rounded-lg border border-blue-200 text-blue-600 font-semibold text-sm hover:bg-blue-50 transition-colors bg-white shadow-sm"
            >
              Completed Deliveries
            </Link>
            <Link
              to="/create"
              className="px-5 py-2.5 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 transition-colors shadow-sm"
            >
              + Create Fleet
            </Link>
          </div>
        </div>

        {/* Fleets Content Area */}
        {visibleFleets.length === 0 ? (
          <div className="w-full bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 p-16 flex flex-col items-center justify-center min-h-[300px]">
            <p className="text-slate-600 font-medium text-lg mb-2">All fleets have completed their deliveries</p>
            <p className="text-slate-400 text-sm">Check the Completed Deliveries tab for their analytics</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 w-full">
            {visibleFleets.map((fleet) => {
              const fleetScore = fleetScoreFromTelemetry({ fleetId: fleet.id, trucks, truckTelemetry })
              const risk = riskFromAvgScore(fleetScore)
              const deliveryStatus = activeDeliveries[fleet.id] ? 'active' : 'idle'
              
              return (
                <FleetCard
                  key={fleet.id}
                  fleet={fleet}
                  fleetScore={fleetScore}
                  risk={risk}
                  deliveryStatus={deliveryStatus}
                />
              )
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}