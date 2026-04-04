import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useFleetStore } from '../state/FleetContext.jsx'
import DashboardLayout from '../components/DashboardLayout.jsx'
import {
  AlertTriangle,
  Building2,
  Truck,
  X,
  Activity,
  PhoneCall,
  CheckCircle2,
  TrendingDown,
  Navigation,
  Thermometer,
  Droplets,
  Package
} from 'lucide-react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts'

function countCritical(truckTelemetry) {
  return Object.values(truckTelemetry || {}).filter(
    (t) => typeof t?.rashness_score === 'number' && t.rashness_score > 7,
  ).length
}

function getHighRiskEventDetails({ fleets, trucks, truckTelemetry }) {
  const high = Object.entries(truckTelemetry || {}).find(
    ([, t]) => typeof t?.rashness_score === 'number' && t.rashness_score > 7,
  )
  if (!high) return null
  const truckId = high[0]
  const eventData = high[1]
  const truck = (trucks || []).find((x) => x.id === truckId)
  const fleet = (fleets || []).find((f) => f.id === truck?.fleetId)
  
  return {
    truckId,
    driverName: truck?.driverName || 'Unknown Driver',
    fleetName: fleet?.name || 'Unknown Fleet',
    eventName: eventData.event || 'Critical Incident',
    score: eventData.rashness_score
  }
}

// --- Mock Data for New Widgets ---
const MOCK_ACTIVITY_STREAM = [
  { id: 1, time: '09:21:05', truck: 'T-102', fleet: 'Alpha Logistics', event: 'Harsh Braking Detected', risk: 'High', acknowledged: false },
  { id: 2, time: '09:18:22', truck: 'T-105', fleet: 'Omega Freight', event: 'Excessive Acceleration', risk: 'Medium', acknowledged: true },
  { id: 3, time: '09:12:45', truck: 'T-108', fleet: 'Alpha Logistics', event: 'Cornering Violation', risk: 'Medium', acknowledged: false },
  { id: 4, time: '08:55:10', truck: 'T-101', fleet: 'Beta Transport', event: 'Speeding (85mph)', risk: 'High', acknowledged: true },
]

const MOCK_RISK_TRENDS = [
  { day: 'Mon', score: 6.8 },
  { day: 'Tue', score: 6.5 },
  { day: 'Wed', score: 6.2 },
  { day: 'Thu', score: 6.6 },
  { day: 'Fri', score: 5.8 },
  { day: 'Sat', score: 5.2 },
  { day: 'Sun', score: 4.8 },
]

const MOCK_ETA_DELAYS = [
  { route: 'HUB A → HUB B', fleet: 'Alpha Logistics', risk: 85, reason: 'Traffic Congestion (I-95)' },
  { route: 'HUB C → HUB A', fleet: 'Beta Transport', risk: 62, reason: 'Heavy Rainfall Ahead' },
  { route: 'HUB D → HUB C', fleet: 'Omega Freight', risk: 45, reason: 'Border Check Delay' },
]

const PIE_COLORS = ['#3b82f6', '#94a3b8', '#f43f5e']

export default function Home() {
  const { fleets, trucks, truckTelemetry } = useFleetStore()

  const critical = countCritical(truckTelemetry)
  const bannerEvent = getHighRiskEventDetails({ fleets, trucks, truckTelemetry })
  const [closedBanner, setClosedBanner] = useState(false)

  const [activities, setActivities] = useState(MOCK_ACTIVITY_STREAM)

  const handleAcknowledge = (id) => {
    setActivities(prev => prev.map(a => a.id === id ? { ...a, acknowledged: true } : a))
  }

  const breadcrumbs = (
    <>
      <Link to="/" className="text-slate-500 hover:text-blue-600 transition-colors font-semibold tracking-wide uppercase cursor-pointer">COMMAND CENTER</Link>
      <span className="mx-2 text-slate-300">/</span>
      <span className="text-slate-800 font-semibold tracking-wide uppercase">Goods Safety Monitoring</span>
    </>
  )

  // Derived Data for Fleet Utilization
  const movingTrucks = trucks.filter(t => t.status === 'Moving').length || 5
  const idleTrucks = Math.max(0, trucks.length - movingTrucks - 2) || 3
  const pieData = [
    { name: 'Active', value: movingTrucks },
    { name: 'Idle', value: idleTrucks },
    { name: 'Maintenance', value: 2 },
  ]

  return (
    <DashboardLayout activeItem="Overview" breadcrumbs={breadcrumbs}>
      <div className="p-8 w-full flex-1 flex flex-col min-w-0">
        {/* Page Title & Badges */}
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-4">
          <h1 
            className="text-4xl md:text-[2.75rem] leading-none font-black text-slate-900 tracking-tighter"
            style={{ fontStretch: 'expanded' }}
          >
            Goods Safety Monitoring
          </h1>
        </div>

        {/* Critical Alert Banner */}
        {bannerEvent && !closedBanner && (
          <div className="w-full bg-pink-50 border border-pink-200 rounded-xl p-4 flex items-start justify-between mb-8 shadow-sm transition-all duration-500 animate-in fade-in slide-in-from-top-4">
            <div className="flex items-start gap-4">
              <div className="p-2 bg-pink-100 rounded-lg shrink-0 mt-0.5 animate-pulse">
                <AlertTriangle className="text-pink-600" size={24} />
              </div>
              <div>
                <div className="text-pink-900 font-bold text-lg tracking-tight">
                  Critical — Truck {bannerEvent.truckId} ({bannerEvent.driverName}) {bannerEvent.eventName} · Rashness Score: {(bannerEvent.score * 10).toFixed(0)}/100
                </div>
                <div className="text-pink-700 text-sm font-medium mt-1">
                  Live Telemetry Incident
                  <span className="ml-2 pl-2 border-l border-pink-300">Fleet: {bannerEvent.fleetName}</span>
                </div>
              </div>
            </div>
            <button
              onClick={() => setClosedBanner(true)}
              className="text-pink-500 hover:text-pink-800 transition-colors bg-pink-100/50 hover:bg-pink-100 p-1.5 rounded-lg shrink-0 ml-4"
            >
              <X size={20} />
            </button>
          </div>
        )}

        {/* Metric Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full mb-8">
          <div className="bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 overflow-hidden relative group hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all">
            <div className="absolute top-0 left-0 w-full h-1.5 bg-blue-500"></div>
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <div className="text-slate-500 font-bold text-sm tracking-wide uppercase">Total Active Fleets</div>
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg group-hover:scale-110 transition-transform">
                  <Building2 size={24} />
                </div>
              </div>
              <div className="text-5xl font-black tracking-tighter text-slate-800 mb-4" style={{ fontStretch: 'expanded' }}>{fleets.length}</div>
              <div className="flex items-center gap-2">
                <span className="bg-blue-100 text-blue-800 text-xs font-bold px-2 py-1 rounded-md shrink-0">+1 this week</span>
                <span className="text-slate-500 text-sm font-medium leading-tight">Monitoring routes & cargo risk</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 overflow-hidden relative group hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all">
            <div className="absolute top-0 left-0 w-full h-1.5 bg-pink-500"></div>
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <div className="text-slate-500 font-bold text-sm tracking-wide uppercase">Trucks on Road</div>
                <div className="p-2 bg-pink-50 text-pink-600 rounded-lg group-hover:scale-110 transition-transform">
                  <Truck size={24} />
                </div>
              </div>
              <div className="text-5xl font-black tracking-tighter text-slate-800 mb-4" style={{ fontStretch: 'expanded' }}>{trucks.filter((t) => t.status === 'Moving').length}</div>
              <div className="flex items-center gap-2">
                <span className="bg-pink-100 text-pink-800 text-xs font-bold px-2 py-1 rounded-md shrink-0">Live telemetry</span>
                <span className="text-slate-500 text-sm font-medium leading-tight">per truck</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 overflow-hidden relative group hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all">
            <div className="absolute top-0 left-0 w-full h-1.5 bg-emerald-500"></div>
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <div className="text-slate-500 font-bold text-sm tracking-wide uppercase">Critical Alerts</div>
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg group-hover:scale-110 transition-transform">
                  <AlertTriangle size={24} />
                </div>
              </div>
              <div className="text-5xl font-black tracking-tighter text-slate-800 mb-4" style={{ fontStretch: 'expanded' }}>{critical}</div>
              <div className="flex items-center gap-2">
                <span className="bg-emerald-100 text-emerald-800 text-xs font-bold px-2 py-1 rounded-md shrink-0">{critical === 0 ? 'All clear' : 'Action needed'}</span>
                <span className="text-slate-500 text-sm font-medium leading-tight">rashness_score &gt; 7</span>
              </div>
            </div>
          </div>
        </div>

        {/* Live Telemetry & Alert Feed */}
        <section className="bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 overflow-hidden mb-8 w-full">
           <div className="p-6 border-b border-slate-100 flex justify-between items-end">
             <div>
               <div className="text-slate-900 font-black text-xl tracking-tight flex items-center gap-2">
                 <Activity className="w-5 h-5 text-blue-500" /> Live Telemetry Feed
               </div>
               <div className="text-slate-400 text-sm font-medium mt-1">Real-time incident stream across all active fleets</div>
             </div>
           </div>
           <div className="overflow-x-auto w-full">
             <table className="w-full text-left border-collapse">
               <thead>
                 <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 text-xs uppercase tracking-widest font-bold">
                   <th className="py-4 px-6">Time</th>
                   <th className="py-4 px-6">Truck</th>
                   <th className="py-4 px-6">Fleet</th>
                   <th className="py-4 px-6">Event</th>
                   <th className="py-4 px-6">Risk</th>
                   <th className="py-4 px-6 text-right">Actions</th>
                 </tr>
               </thead>
               <tbody>
                 {activities.map((a) => (
                   <tr key={a.id} className={`border-b border-slate-50 hover:bg-slate-50/50 transition-colors ${a.acknowledged ? 'opacity-60 grayscale' : ''}`}>
                     <td className="py-4 px-6 font-mono text-sm text-slate-500">{a.time}</td>
                     <td className="py-4 px-6 font-bold text-slate-900">{a.truck}</td>
                     <td className="py-4 px-6 text-slate-600 text-sm font-medium">{a.fleet}</td>
                     <td className={`py-4 px-6 text-sm font-bold ${a.acknowledged ? 'line-through text-slate-400' : 'text-slate-800'}`}>{a.event}</td>
                     <td className="py-4 px-6">
                       <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${
                         a.risk === 'High' ? 'bg-pink-100 text-pink-700' : 'bg-yellow-100 text-yellow-700'
                       }`}>{a.risk}</span>
                     </td>
                     <td className="py-4 px-6 text-right">
                       <div className="flex items-center justify-end gap-2">
                         {!a.acknowledged && (
                           <button 
                             onClick={() => handleAcknowledge(a.id)}
                             className="p-2 bg-emerald-50 text-emerald-600 rounded hover:bg-emerald-100 transition-colors"
                             title="Acknowledge Alert"
                           >
                             <CheckCircle2 size={16} />
                           </button>
                         )}
                         <button className="p-2 border border-slate-200 text-slate-500 rounded hover:bg-slate-50 transition-colors" title="Contact Driver">
                           <PhoneCall size={16} />
                         </button>
                       </div>
                     </td>
                   </tr>
                 ))}
               </tbody>
             </table>
           </div>
        </section>

        {/* Predictive Analytics, Risk Forecasting & Utilization */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8 w-full">
          {/* ETA & Delay Probability */}
          <section className="bg-white rounded-2xl shadow-[0_4px_20px_rgb(0,0,0,0.03)] border border-slate-100 p-6 flex flex-col h-full">
             <div className="mb-6">
               <div className="text-slate-900 font-black text-xl tracking-tight flex items-center gap-2">
                 <Navigation className="w-5 h-5 text-yellow-500" /> ETA & Delay
               </div>
               <div className="text-slate-400 text-sm font-medium mt-1">AI-forecasted route obstructions</div>
             </div>
             
             <div className="flex flex-col gap-4 flex-1">
               {MOCK_ETA_DELAYS.map((delay, i) => (
                 <div key={i} className="p-4 rounded-xl border border-slate-100 bg-slate-50">
                   <div className="flex justify-between items-start mb-2">
                     <div>
                       <div className="font-bold text-slate-800">{delay.route}</div>
                       <div className="text-xs text-slate-500 font-medium">{delay.fleet}</div>
                     </div>
                     <div className="text-right">
                       <div className="text-lg font-black text-pink-600 leading-none">{delay.risk}%</div>
                       <div className="text-[9px] uppercase tracking-wider text-pink-400 font-bold mt-1">Delay Risk</div>
                     </div>
                   </div>
                   <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden mb-3">
                     <div className="bg-pink-500 h-full rounded-full transition-all" style={{ width: `${delay.risk}%` }}></div>
                   </div>
                   <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 bg-white px-2 py-1 rounded inline-flex border border-slate-100">
                     <AlertTriangle size={12} className="text-yellow-500" /> {delay.reason}
                   </div>
                 </div>
               ))}
             </div>
          </section>

          {/* Driver Risk Trends */}
          <section className="bg-white rounded-2xl shadow-[0_4px_20px_rgb(0,0,0,0.03)] border border-slate-100 p-6 flex flex-col h-full">
             <div className="mb-6">
               <div className="text-slate-900 font-black text-xl tracking-tight flex items-center gap-2">
                 <TrendingDown className="w-5 h-5 text-emerald-500" /> Driver Risk Trends
               </div>
               <div className="text-slate-400 text-sm font-medium mt-1">7-Day average fleet score</div>
             </div>
             
             <div className="flex-1 w-full min-h-[300px] min-w-0">
               <ResponsiveContainer width="100%" height="100%">
                 <AreaChart data={MOCK_RISK_TRENDS} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                   <defs>
                     <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                       <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                       <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                     </linearGradient>
                   </defs>
                   <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8', fontWeight: 600 }} dy={10} />
                   <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8', fontWeight: 600 }} domain={[0, 10]} />
                   <CartesianGrid vertical={false} stroke="#f1f5f9" />
                   <Tooltip 
                     contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', fontWeight: 'bold' }}
                   />
                   <Area type="monotone" dataKey="score" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorScore)" />
                 </AreaChart>
               </ResponsiveContainer>
             </div>
          </section>

          {/* Fleet Utilization Donut Chart */}
          <section className="bg-white rounded-2xl shadow-[0_4px_20px_rgb(0,0,0,0.03)] border border-slate-100 p-6 flex flex-col items-center h-full">
             <div className="w-full text-left mb-6">
               <div className="text-slate-900 font-black text-xl tracking-tight">Fleet Utilization</div>
               <div className="text-slate-400 text-sm font-medium mt-1">Real-time asset allocation</div>
             </div>
             
             <div className="w-full flex-1 flex flex-col justify-center min-h-[220px] relative min-w-0">
               <ResponsiveContainer width="100%" height={260}>
                 <PieChart>
                   <Pie
                     data={pieData}
                     cx="50%"
                     cy="50%"
                     innerRadius={80}
                     outerRadius={110}
                     paddingAngle={5}
                     dataKey="value"
                     stroke="none"
                   >
                     {pieData.map((entry, index) => (
                       <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                     ))}
                   </Pie>
                   <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                 </PieChart>
               </ResponsiveContainer>
               <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none mt-4">
                 <div className="text-4xl font-black text-slate-800 leading-none">{trucks.length || 10}</div>
                 <div className="text-[10px] uppercase tracking-widest font-bold text-slate-400 mt-1">Total</div>
               </div>
             </div>

             <div className="w-full flex justify-center gap-4 mt-8 pb-4">
               {pieData.map((entry, i) => (
                 <div key={entry.name} className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
                   <div className="w-3 h-3 rounded-full" style={{ backgroundColor: PIE_COLORS[i] }}></div>
                   {entry.name}
                 </div>
               ))}
             </div>
          </section>
        </div>

      </div>
    </DashboardLayout>
  )
}
