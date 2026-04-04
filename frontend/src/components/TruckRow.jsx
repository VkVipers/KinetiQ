import { Link } from 'react-router-dom'
import { Truck, MapPin, ShieldAlert, Activity } from 'lucide-react'

export default function TruckRow({ truck, risk = '—', coords }) {
  const isHighRisk = risk === 'High'
  const isMedRisk = risk === 'Medium'
  const isLowRisk = risk === 'Low'

  const accentColor = isHighRisk ? 'pink' : isMedRisk ? 'yellow' : isLowRisk ? 'emerald' : 'slate'

  return (
    <Link 
      to={`/truck/${truck.id}`} 
      className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 flex flex-col md:flex-row md:items-center justify-between hover:shadow-md hover:-translate-y-0.5 hover:border-slate-200 transition-all group relative overflow-hidden"
    >
      <div className={`absolute top-0 left-0 w-1.5 h-full bg-${accentColor}-500 transition-colors`}></div>
      
      <div className="flex flex-col md:flex-row md:items-center gap-6 pl-4 flex-1">
        <div className={`p-3 bg-${accentColor}-50 text-${accentColor}-600 rounded-lg shrink-0 self-start md:self-auto`}>
          <Truck size={24} />
        </div>
        
        <div className="w-full md:w-32 lg:w-48 shrink-0">
          <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">Truck ID</div>
          <div className="text-slate-900 font-black text-lg tracking-tight">{truck.id}</div>
        </div>

        <div className="w-full md:w-40 border-t md:border-t-0 md:border-l border-slate-100 pt-3 md:pt-0 pl-0 md:pl-6 shrink-0">
          <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1 flex items-center gap-1"><Activity size={12}/> Driver</div>
          <div className="text-slate-700 font-semibold">{truck.driverName}</div>
        </div>

        <div className="w-full md:w-28 border-t md:border-t-0 md:border-l border-slate-100 pt-3 md:pt-0 pl-0 md:pl-6 shrink-0">
          <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">Status</div>
          <div className="text-slate-700 font-semibold">{truck.status}</div>
        </div>
        
        <div className="w-full md:w-32 border-t md:border-t-0 md:border-l border-slate-100 pt-3 md:pt-0 pl-0 md:pl-6 shrink-0">
          <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1 flex items-center gap-1"><MapPin size={12}/> Coords</div>
          <div className="text-slate-500 font-mono text-sm">{coords || '—'}</div>
        </div>
      </div>

      <div className="flex items-center justify-between md:justify-end gap-4 mt-4 md:mt-0 pt-4 md:pt-0 border-t md:border-t-0 border-slate-100 pr-4 shrink-0">
        <div className="text-left md:text-right">
          <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">Damage Risk</div>
          <div className={`text-${accentColor}-600 font-black tracking-tight uppercase`}>{risk} Risk</div>
        </div>
        <div className={`p-2 bg-${accentColor}-100 rounded-full text-${accentColor}-600 flex shrink-0`}>
          <ShieldAlert size={18} />
        </div>
      </div>
    </Link>
  )
}

