import React, { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useFleetStore } from '../state/FleetContext.jsx'
import {
  Zap,
  LayoutDashboard,
  Truck,
  BarChart3,
  PlusCircle,
  Map as MapIcon,
  Link as LinkIcon,
  Bell,
  Download,
  AlertTriangle
} from 'lucide-react'

export default function DashboardLayout({ children, activeItem = 'Overview', breadcrumbs = null }) {
  const [currentTime, setCurrentTime] = useState('')
  const { truckTelemetry } = useFleetStore()
  const [notifications, setNotifications] = useState([])
  const [isAlertOpen, setIsAlertOpen] = useState(false)
  const lastEventRef = useRef({})

  useEffect(() => {
    if (!truckTelemetry) return
    let updated = false
    const newNotifs = []

    Object.entries(truckTelemetry).forEach(([truckId, data]) => {
      // Look for anomalous events with high risk scores
      if (data.event && data.event !== 'Normal Driving' && data.rashness_score > 5) {
        const lastEvent = lastEventRef.current[truckId]
        // If it's a new or different event type, push to notifications
        if (lastEvent !== data.event) {
          lastEventRef.current[truckId] = data.event
          newNotifs.push({
            id: Date.now() + Math.random(),
            truckId,
            event: data.event,
            score: data.rashness_score,
            time: new Date()
          })
          updated = true
        }
      } else if (data.event === 'Normal Driving' || !data.event) {
        // Reset tracking if truck returns to normal
        lastEventRef.current[truckId] = null
      }
    })

    if (updated) {
      setNotifications(prev => [...newNotifs, ...prev].slice(0, 10)) // Keep latest 10
    }
  }, [truckTelemetry])

  useEffect(() => {
    const updateTime = () => {
      const now = new Date()
      const timeStr = now.toLocaleTimeString('en-US', { hour12: false })
      setCurrentTime(timeStr)
    }
    updateTime()
    const timer = setInterval(updateTime, 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900 overflow-hidden w-full">
      {/* Left Sidebar */}
      <aside className="w-64 bg-[#0b1020] text-white flex flex-col items-center py-6 px-4 shrink-0 shadow-xl z-20 overflow-y-auto">
        <div className="flex flex-col mb-8 w-full px-2">
          <Link to="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center shadow-inner group-hover:bg-slate-800 transition-colors">
              <Zap className="w-5 h-5 text-blue-500 fill-blue-500" />
            </div>
            <div className="flex flex-col">
              <span className="text-[22px] font-black tracking-tight leading-none text-white">KINETIQ</span>
              <span className="text-[9px] font-medium text-slate-400 uppercase tracking-[0.25em] mt-1">Fleet Intelligence</span>
            </div>
          </Link>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-full py-1.5 px-4 flex items-center gap-2 w-full mb-8">
          <div className="w-2 h-2 rounded-full bg-pink-500 animate-pulse"></div>
          <span className="text-pink-500 text-xs font-semibold uppercase tracking-wider">Simulation Mode ON</span>
        </div>

        <nav className="w-full flex flex-col gap-6">
          <div>
            <div className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-2 px-2">Monitor</div>
            <Link to="/" className={`flex items-center gap-3 rounded-lg px-4 py-2.5 transition-colors mb-1 ${activeItem === 'Overview' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}`}>
              <LayoutDashboard size={18} />
              <span className="font-medium">Overview</span>
            </Link>
            <Link to="/fleets" className={`flex items-center gap-3 rounded-lg px-4 py-2.5 transition-colors ${activeItem === 'Fleets' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}`}>
              <Truck size={18} />
              <span className="font-medium">Fleets</span>
            </Link>
          </div>

          <div>
            <div className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-2 px-2">Reports</div>
            <Link to="/deliveries/completed" className={`flex items-center gap-3 rounded-lg px-4 py-2.5 transition-colors ${activeItem === 'Analytics' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}`}>
              <BarChart3 size={18} />
              <span className="font-medium">Analytics</span>
            </Link>
          </div>

          <div>
            <div className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-2 px-2">Operations</div>
            <Link to="/create" className={`flex items-center gap-3 rounded-lg px-4 py-2.5 transition-colors mb-1 ${activeItem === 'Create Fleet' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}`}>
              <PlusCircle size={18} />
              <span className="font-medium">Create Fleet</span>
            </Link>
          </div>

        </nav>

        <div className="mt-auto pt-8 w-full border-t border-slate-800/50 flex flex-col items-center justify-center text-center">
          <div className="text-[10px] text-slate-500 font-medium leading-relaxed tracking-wide">
            <p>© 2026 KinetiQ Logistics.</p>
            <p>All rights reserved.</p>
            <p className="mt-2 text-slate-400 hover:text-white transition-colors cursor-pointer inline-flex items-center gap-1">
              Contact Support
            </p>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-screen overflow-y-auto w-full relative">
        {/* Top Header Bar */}
        <header className="flex justify-between items-center px-8 py-5 border-b border-slate-200 bg-white sticky top-0 z-10 w-full shrink-0">
          <div className="text-slate-500 text-sm font-semibold tracking-wide uppercase flex gap-2 items-center">
            {breadcrumbs}
          </div>

          <div className="flex items-center gap-5">
            <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 text-blue-700 px-3 py-1 rounded-full text-sm font-semibold">
              <div className="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></div>
              Live
            </div>
            <div className="font-mono text-sm font-semibold text-slate-600 bg-slate-100 px-3 py-1 rounded-md">
              {currentTime}
            </div>

            <div className="h-6 w-px bg-slate-200 mx-1"></div>

            <div className="relative">
              <button 
                onClick={() => setIsAlertOpen(!isAlertOpen)}
                className={`relative transition-colors ${notifications.length > 0 ? 'text-slate-700' : 'text-slate-400 hover:text-slate-600'}`}
              >
                <Bell size={20} />
                {notifications.length > 0 && (
                  <div className="absolute -top-1 -right-1.5 min-w-[16px] h-4 px-1 bg-red-500 border-2 border-white rounded-full flex items-center justify-center text-[9px] font-bold text-white shadow-sm">
                    {notifications.length}
                  </div>
                )}
              </button>

              {/* Notifications Dropdown */}
              {isAlertOpen && (
                <div className="absolute top-12 right-0 w-80 bg-white border border-slate-200 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.15)] rounded-2xl overflow-hidden z-50">
                  <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                    <h3 className="font-bold text-slate-800 tracking-tight">Recent Alerts</h3>
                    {notifications.length > 0 && (
                      <button 
                        onClick={() => setNotifications([])} 
                        className="text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
                      >
                        Clear All
                      </button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <div className="p-6 text-center text-slate-400 text-sm font-medium">
                        No recent active alerts
                      </div>
                    ) : (
                      <div className="flex flex-col">
                        {notifications.map(notif => (
                          <div key={notif.id} className="p-4 border-b border-slate-50 hover:bg-slate-50 transition-colors flex gap-3 items-start">
                            <div className={`p-2 rounded-full mt-0.5 shrink-0 ${notif.score > 7 ? 'bg-pink-100 text-pink-600' : 'bg-yellow-100 text-yellow-600'}`}>
                              <AlertTriangle size={16} />
                            </div>
                            <div>
                              <div className="flex justify-between items-start gap-4 mb-1">
                                <span className="font-bold text-slate-800 text-sm">{notif.event}</span>
                                <span className="text-[10px] font-bold text-slate-400 mt-0.5 bg-slate-100 px-1.5 py-0.5 rounded shrink-0">
                                  {notif.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                </span>
                              </div>
                              <p className="text-sm text-slate-500 leading-snug">
                                Truck <strong className="text-slate-700">{notif.truckId}</strong> flagged with risk score of <strong className="text-slate-700">{notif.score.toFixed(1)}</strong>.
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            
          </div>
        </header>

        {children}
      </main>
    </div>
  )
}
