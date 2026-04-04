import { Link } from 'react-router-dom'
import { MapPin, Package, Clock, Truck } from 'lucide-react'

function toneForRisk(risk) {
  if (risk === 'High') return 'pink'
  if (risk === 'Medium') return 'yellow'
  if (risk === 'Low') return 'emerald'
  return 'slate'
}

export default function FleetCard({ fleet, fleetScore, risk, deliveryStatus }) {
  const tone = toneForRisk(risk)
  const hasActiveDelivery = deliveryStatus === 'active'
  
  return (
    <Link 
      to={`/fleet/${fleet.id}`} 
      className="bg-white rounded-2xl shadow-sm hover:shadow-md border border-slate-100 overflow-hidden relative p-6 transition-all group flex flex-col h-full cursor-pointer"
    >
      {/* Accent Line */}
      <div className={`absolute top-0 left-0 w-full h-1.5 bg-${tone}-500 group-hover:h-2 transition-all`}></div>
      
      {/* Top Header */}
      <div className="flex justify-between items-start mb-4">
        <div>
           <div className="text-slate-900 font-bold text-lg flex items-center gap-2">
             <Truck className="w-5 h-5 text-slate-400" />
             {fleet.name}
           </div>
        </div>
        
        {hasActiveDelivery && (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-700 rounded-md text-[10px] font-bold uppercase tracking-widest border border-blue-100/50">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
            </span>
            In Transit
          </div>
        )}
      </div>

      {/* Routes */}
      <div className="flex items-center text-sm font-medium text-slate-600 mb-6 bg-slate-50 p-3.5 rounded-xl border border-slate-100 shadow-inner">
        <MapPin className="w-4 h-4 text-slate-400 mr-2 shrink-0" />
        <span className="truncate" title={fleet.sourceLocation?.name || fleet.source || 'Start'}>
          {fleet.sourceLocation?.name || fleet.source || 'Start'}
        </span>
        <span className="mx-2 text-slate-300 font-bold shrink-0">→</span>
        <span className="truncate" title={fleet.destinationLocation?.name || fleet.destination || 'End'}>
          {fleet.destinationLocation?.name || fleet.destination || 'End'}
        </span>
      </div>

      {/* Bottom Metadata */}
      <div className="flex gap-8 mt-auto pt-2">
        <div className="bg-white shrink-0">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" /> ETA
          </div>
          <div className="text-slate-800 font-black text-lg tracking-tight whitespace-nowrap">{fleet.eta || '—'}</div>
        </div>
        <div className="bg-white min-w-0">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
            <Package className="w-3.5 h-3.5" /> Cargo
          </div>
          <div className="text-slate-800 font-black text-lg tracking-tight truncate">{fleet.cargoType || 'Unknown'}</div>
        </div>
      </div>
    </Link>
  )
}
