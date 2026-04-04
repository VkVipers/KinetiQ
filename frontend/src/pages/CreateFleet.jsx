import { useMemo, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useFleetStore } from '../state/FleetContext.jsx'
import DashboardLayout from '../components/DashboardLayout.jsx'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'

// Hub definitions - maps to backend ROUTE_HUBS
const HUBS = {
  HUB_A: { label: 'North Hub (HUB_A)', lat: 17.4399, lon: 78.4983 },
  HUB_B: { label: 'South Hub (HUB_B)', lat: 17.4436, lon: 78.3800 },
  HUB_C: { label: 'West Hub (HUB_C)', lat: 17.2403, lon: 78.4294 },
  HUB_D: { label: 'East Hub (HUB_D)', lat: 17.4000, lon: 78.3500 },
}

const HUB_CHOICES = Object.entries(HUBS).map(([key, value]) => ({
  id: key,
  label: value.label,
}))

function newFleetId(name) {
  return String(name || 'fleet')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 24) || `fleet-${Date.now()}`
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://kinetiq-gyrn.onrender.com';

export default function CreateFleet() {
  const nav = useNavigate()
  const { fleets, setFleets, trucks, setTrucks } = useFleetStore()
  const [success, setSuccess] = useState(false)

  const [form, setForm] = useState({
    fleetName: '',
    cargoType: 'General',
    sourceHub: 'HUB_A',
    destHub: 'HUB_B',
    numberOfTrucks: 2,
  })

  const canSubmit = useMemo(() => {
    return Boolean(
      form.fleetName &&
        form.sourceHub &&
        form.destHub &&
        form.sourceHub !== form.destHub &&
        Number(form.numberOfTrucks) > 0
    )
  }, [form])

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }))
    setSuccess(false)
  }

  const handleSubmit = async e => {
    e.preventDefault()
    if (!canSubmit) return

    const sourceHub = HUBS[form.sourceHub]
    const destHub = HUBS[form.destHub]
    const fleetId = newFleetId(form.fleetName)

    try {
      // 1. Register the fleet with the backend simulator
      const response = await fetch(`${API_BASE_URL}/fleet/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fleet_id: fleetId,
          fleet_name: form.fleetName,
          source_hub: form.sourceHub,
          dest_hub: form.destHub,
          number_of_trucks: Number(form.numberOfTrucks),
          cargo_type: form.cargoType
        })
      })

      if (!response.ok) {
        throw new Error(`Backend error: ${response.status}`)
      }
      
      const data = await response.json()

      // 2. Auto-start the new delivery session
      await fetch(`${API_BASE_URL}/deliveries/auto-start`, { method: 'POST' })

      // 3. Sync local UI state (Restoring ALL expected legacy properties to prevent crashes)
      const truckIds = data.truck_ids || []
      const newTrucks = truckIds.map((tid, i) => ({
        id: tid,
        fleetId: fleetId, 
        driverName: `Driver ${i + 1}`, 
        status: 'Moving',
        cargoType: form.cargoType,
        sourceLocation: { lat: sourceHub.lat, lon: sourceHub.lon, name: sourceHub.label },
        destinationLocation: { lat: destHub.lat, lon: destHub.lon, name: destHub.label },
      }))

      const newFleet = {
        id: fleetId,
        name: form.fleetName,
        source_hub: form.sourceHub,
        destination_hub: form.destHub,
        sourceLocation: { lat: sourceHub.lat, lon: sourceHub.lon, name: sourceHub.label },
        destinationLocation: { lat: destHub.lat, lon: destHub.lon, name: destHub.label },
        source: sourceHub.label,
        destination: destHub.label,
        cargoType: form.cargoType,
        numberOfTrucks: Number(form.numberOfTrucks),
        trucks: truckIds,
        status: 'idle',
        eta: 'Calculating...', 
        startTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }

      setTrucks(prev => [...prev, ...newTrucks])
      setFleets(prev => [...prev, newFleet])

      setSuccess(true)
      setForm({ fleetName: '', cargoType: 'General', sourceHub: 'HUB_A', destHub: 'HUB_B', numberOfTrucks: 2 })
      setTimeout(() => nav('/fleets'), 2000)
    } catch (error) {
      console.error('Failed to create fleet:', error)
      alert('Failed to connect to the simulation backend. Check your terminal for Python errors.')
    }
  }

  const breadcrumbs = (
    <>
      <Link to="/" className="text-slate-500 hover:text-blue-600 transition-colors font-semibold tracking-wide uppercase cursor-pointer">OPERATIONS</Link>
      <span className="mx-2 text-slate-300">/</span>
      <span className="text-slate-800 font-semibold tracking-wide uppercase">Create Fleet</span>
    </>
  )

  return (
    <DashboardLayout activeItem="Create Fleet" breadcrumbs={breadcrumbs}>
      <div className="p-8 w-full max-w-[1400px] mx-auto flex-1 flex flex-col">
        {/* Page Title */}
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-4">
          <div>
            <div className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-2">
              Setup • Configuration
            </div>
            <h1 
              className="text-4xl leading-none font-black text-slate-900 tracking-tighter"
              style={{ fontStretch: 'expanded' }}
            >
              Create Fleet
            </h1>
          </div>
          <button 
            type="button"
            onClick={() => nav(-1)}
            className="px-5 py-2.5 rounded-lg border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-colors bg-white shadow-sm"
          >
            ← Back
          </button>
        </div>

        {success && (
          <div className="w-full max-w-2xl bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-4 mb-8 shadow-sm">
            <div className="p-2 bg-emerald-100 rounded-lg shrink-0">
              <CheckCircle2 className="text-emerald-600" size={24} />
            </div>
            <div>
              <div className="text-emerald-900 font-bold text-lg tracking-tight">
                Fleet created successfully
              </div>
              <div className="text-emerald-700 text-sm font-medium mt-1">
                Redirecting to fleets overview…
              </div>
            </div>
          </div>
        )}

        {/* Form Container */}
        <form 
          className="bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 p-8 max-w-2xl flex flex-col gap-6"
          onSubmit={handleSubmit}
        >
          <div>
            <label className="block text-slate-500 font-bold text-sm tracking-wide uppercase mb-2">
              Fleet Name
            </label>
            <input
              className="w-full px-4 py-3 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors text-slate-900 font-bold"
              value={form.fleetName}
              onChange={e => handleChange('fleetName', e.target.value)}
              placeholder="Fleet Alpha"
            />
          </div>

          <div>
            <label className="block text-slate-500 font-bold text-sm tracking-wide uppercase mb-2">
              Cargo Type
            </label>
            <select 
              className="w-full px-4 py-3 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors text-slate-900 font-bold appearance-none"
              value={form.cargoType} 
              onChange={e => handleChange('cargoType', e.target.value)}
            >
              <option>General</option>
              <option>Fragile</option>
              <option>Perishable</option>
              <option>Heavy</option>
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-slate-500 font-bold text-sm tracking-wide uppercase mb-2">
                Source Hub
              </label>
              <select 
                className="w-full px-4 py-3 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors text-slate-900 font-bold appearance-none"
                value={form.sourceHub} 
                onChange={e => handleChange('sourceHub', e.target.value)}
              >
                {HUB_CHOICES.map(hub => (
                  <option key={hub.id} value={hub.id}>
                    {hub.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-500 font-bold text-sm tracking-wide uppercase mb-2">
                Destination Hub
              </label>
              <select 
                className="w-full px-4 py-3 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors text-slate-900 font-bold appearance-none"
                value={form.destHub} 
                onChange={e => handleChange('destHub', e.target.value)}
              >
                {HUB_CHOICES.map(hub => (
                  <option key={hub.id} value={hub.id}>
                    {hub.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-slate-500 font-bold text-sm tracking-wide uppercase mb-2">
              Number of Trucks
            </label>
            <input
              className="w-full px-4 py-3 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors text-slate-900 font-bold"
              type="number"
              min="1"
              max="10"
              value={form.numberOfTrucks}
              onChange={e => handleChange('numberOfTrucks', Number(e.target.value))}
            />
          </div>

          <div className="flex gap-4 mt-4 pt-6 border-t border-slate-100">
            <button 
              className="px-6 py-3 rounded-lg bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex-1"
              type="submit" 
              disabled={!canSubmit}
            >
              Create Fleet
            </button>
            <button 
              className="px-6 py-3 rounded-lg border border-slate-200 text-slate-600 font-bold text-sm hover:bg-slate-50 transition-colors shadow-sm flex-1"
              type="button" 
              onClick={() => nav('/fleets')}
            >
              View Fleets
            </button>
          </div>
        </form>
      </div>
    </DashboardLayout>
  )
}

