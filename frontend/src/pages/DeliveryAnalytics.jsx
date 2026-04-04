import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import DashboardLayout from '../components/DashboardLayout.jsx';
import {
  AlertTriangle,
  MapPin,
  Truck,
  CheckCircle,
  AlertCircle,
  Clock,
  Award,
  Loader2,
  ShieldAlert,
  Activity,
  CornerUpRight
} from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://kinetiq-gyrn.onrender.com';

const createJerkMarker = () =>
  L.divIcon({
    className: 'driver-jerk-marker',
    html: `<div style="background-color: #f43f5e; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 4px 12px rgba(244, 63, 94, 0.4); display: flex; align-items: center; justify-content: center;"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  });

const createInfrastructureMarker = () =>
  L.divIcon({
    className: 'infrastructure-marker',
    html: `<div style="background-color: #f59e0b; width: 28px; height: 28px; border-radius: 6px; border: 3px solid white; box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4); display: flex; align-items: center; justify-content: center;"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });

const createNewlyDetectedMarker = () =>
  L.divIcon({
    className: 'newly-detected-marker',
    html: `<div style="background-color: #eab308; width: 28px; height: 28px; border-radius: 6px; border: 3px solid white; box-shadow: 0 4px 12px rgba(234, 179, 8, 0.4); display: flex; align-items: center; justify-content: center;"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });

// Known and hidden anomalies
const ROAD_ANOMALIES = [
  { id: 'anom-1', pos: [17.4435, 78.4458], type: 'Severe Pothole Cluster', severity: 'High', reports: 14 },
  { id: 'anom-2', pos: [17.3200, 78.4000], type: 'Uneven Expansion Joint', severity: 'Medium', reports: 6 },
];

const HIDDEN_ANOMALIES = [
  { id: 'hidden-1', pos: [17.4417, 78.4391], type: 'Hidden Pothole', severity: 'Unknown', nearRoute: 'Alpha' },
  { id: 'hidden-2', pos: [17.3419, 78.4047], type: 'Hidden Road Damage', severity: 'Unknown', nearRoute: 'Bravo' },
  { id: 'hidden-3', pos: [17.3301, 78.4638], type: 'Hidden Deep Rut', severity: 'Unknown', nearRoute: 'Charlie' },
];

// Helper function to check if a position is near any anomaly
const isNearAnyAnomaly = (position, threshold = 0.035) => {
  const allAnomalies = [...ROAD_ANOMALIES, ...HIDDEN_ANOMALIES];
  return allAnomalies.some(anom => {
    const latDiff = Math.abs(position[0] - anom.pos[0]);
    const lonDiff = Math.abs(position[1] - anom.pos[1]);
    return latDiff < threshold && lonDiff < threshold;
  });
};

export default function DeliveryAnalytics() {
  const { deliveryId } = useParams();
  const navigate = useNavigate();
  const [analytics, setAnalytics] = useState(null);
  const [routes, setRoutes] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        const [analyticsRes, routesRes] = await Promise.all([
          fetch(`${API_BASE_URL}/delivery/${deliveryId}/analytics`),
          fetch(`${API_BASE_URL}/delivery/${deliveryId}/routes`),
        ]);

        if (!analyticsRes.ok || !routesRes.ok) {
          throw new Error('Failed to load analytics');
        }

        const analyticsData = await analyticsRes.json();
        const routesData = await routesRes.json();

        setAnalytics(analyticsData);
        setRoutes(routesData);
      } catch (err) {
        setError(err.message);
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    if (deliveryId) {
      fetchAnalytics();
    }
  }, [deliveryId]);

  const breadcrumbs = (
    <>
      <Link to="/" className="text-slate-500 hover:text-blue-600 transition-colors font-semibold tracking-wide uppercase cursor-pointer">REPORTS</Link>
      <span className="mx-2 text-slate-300">/</span>
      <Link to="/deliveries" className="text-slate-500 hover:text-blue-600 transition-colors font-semibold tracking-wide uppercase cursor-pointer">ANALYTICS</Link>
      <span className="mx-2 text-slate-300">/</span>
      <span className="text-slate-800 font-semibold tracking-wide uppercase">DELIVERY {deliveryId?.toUpperCase().slice(0, 8)}</span>
    </>
  );

  if (loading) {
    return (
      <DashboardLayout activeItem="Analytics" breadcrumbs={breadcrumbs}>
        <div className="flex-1 flex flex-col items-center justify-center p-16">
          <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
          <div className="text-slate-500 font-medium tracking-wide">Crunching delivery data...</div>
        </div>
      </DashboardLayout>
    );
  }

  if (error || !analytics) {
    return (
      <DashboardLayout activeItem="Analytics" breadcrumbs={breadcrumbs}>
         <div className="p-8 w-full max-w-[1400px] mx-auto flex-1 flex flex-col">
          <div className="w-full bg-red-50 border border-red-200 rounded-xl p-6 flex flex-col items-center justify-center shadow-sm">
            <div className="p-4 bg-red-100 rounded-full mb-4">
              <AlertCircle className="text-red-600 w-12 h-12" />
            </div>
            <div className="text-red-900 font-black text-2xl tracking-tight mb-2">Analytics Error</div>
            <div className="text-red-700 font-medium mb-6">{error || 'Failed to load analytics'}</div>
            <button onClick={() => navigate('/deliveries')} className="px-6 py-3 bg-white border border-red-200 text-red-700 font-bold rounded-lg hover:bg-red-50 transition-colors shadow-sm">
              ← Back to Analytics
            </button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const { driver_scores, infrastructure_issues, routes: routeTaken, total_infrastructure_jerks, duration_seconds, fleets_involved, per_fleet } = analytics;
  
  // Use per-fleet data if available, otherwise fallback to driver_scores
  const fleetAnalytics = per_fleet || driver_scores || {};
  
  // Prepare jerk locations for visualization
  const allJerkLocations = [];
  if (infrastructure_issues) {
    Object.values(infrastructure_issues).forEach((issue) => {
      issue.events.forEach((event) => {
        allJerkLocations.push({
          position: event.jerk.position,
          type: 'infrastructure',
          affected: issue.affected_fleets,
          anomaly_type: event.jerk.anomaly_type, // Track if known or discovered
        });
      });
    });
  }
  
  // Add per-fleet jerk locations
  Object.values(fleetAnalytics).forEach((fleet) => {
    const jerkEvents = fleet.jerk_events || [];
    jerkEvents.forEach((jerk, idx) => {
      allJerkLocations.push({
        position: jerk.position,
        type: 'driver',
        fleet: fleet.fleet_id || fleet.id,
        index: idx,
      });
    });
  });
  
  // Calculate summary stats
  const avgScore = Object.values(fleetAnalytics).reduce((a, b) => a + (b.score || 0), 0) / Math.max(1, Object.keys(fleetAnalytics).length);
  const infrastructureJerkCount = total_infrastructure_jerks || 0;
  const driverJerkCount = Object.values(fleetAnalytics).reduce((a, b) => a + (b.total_jerks || b.driver_jerks || 0), 0);

  const avgScoreTone = avgScore >= 80 ? 'emerald' : avgScore >= 60 ? 'yellow' : 'pink';

  return (
    <DashboardLayout activeItem="Analytics" breadcrumbs={breadcrumbs}>
      <div className="p-8 w-full max-w-[1400px] mx-auto flex-1 flex flex-col">
        {/* Page Title & Actions */}
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-4">
          <div>
            <div className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-500" /> Delivery Completed
            </div>
            <h1 
              className="text-4xl leading-none font-black text-slate-900 tracking-tighter"
              style={{ fontStretch: 'expanded' }}
            >
              Delivery #{deliveryId.toUpperCase().slice(0, 8)}
            </h1>
          </div>
          
          <div className="flex gap-4">
            <button 
              type="button"
              onClick={() => window.print()}
              className="px-5 py-2.5 rounded-lg border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-colors bg-white shadow-sm"
            >
              Print Report
            </button>
            <button 
              type="button"
              onClick={() => navigate('/deliveries')}
              className="px-5 py-2.5 rounded-lg border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-colors bg-white shadow-sm"
            >
              ← Back
            </button>
          </div>
        </div>

        {/* Summary Metrics Grid */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className={`bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden relative p-6`}>
            <div className={`absolute top-0 left-0 w-full h-1.5 bg-${avgScoreTone}-500`}></div>
            <div className="text-slate-500 font-bold text-sm tracking-wide uppercase mb-2 flex items-center gap-2">
              <Award className="w-4 h-4" /> Avg Driver Score
            </div>
            <div className="text-4xl font-black text-slate-800 mb-1" style={{ fontStretch: 'expanded' }}>{avgScore.toFixed(0)}</div>
            <div className="text-slate-400 text-xs font-medium">Composite performance</div>
          </div>

          <div className={`bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden relative p-6`}>
            <div className={`absolute top-0 left-0 w-full h-1.5 bg-slate-300`}></div>
            <div className="text-slate-500 font-bold text-sm tracking-wide uppercase mb-2 flex items-center gap-2">
              <Clock className="w-4 h-4" /> Delivery Duration
            </div>
            <div className="text-4xl font-black text-slate-800 mb-1" style={{ fontStretch: 'expanded' }}>{(duration_seconds / 60).toFixed(1)}m</div>
            <div className="text-slate-400 text-xs font-medium">{Math.round(duration_seconds)}s total</div>
          </div>

          <div className={`bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden relative p-6`}>
            <div className={`absolute top-0 left-0 w-full h-1.5 bg-yellow-500`}></div>
            <div className="text-slate-500 font-bold text-sm tracking-wide uppercase mb-2 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Infrastructure Issues
            </div>
            <div className="text-4xl font-black text-slate-800 mb-1" style={{ fontStretch: 'expanded' }}>{infrastructureJerkCount}</div>
            <div className="text-slate-400 text-xs font-medium">Road anomalies detected</div>
          </div>

          <div className={`bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden relative p-6`}>
            <div className={`absolute top-0 left-0 w-full h-1.5 bg-pink-500`}></div>
            <div className="text-slate-500 font-bold text-sm tracking-wide uppercase mb-2 flex items-center gap-2">
              <Activity className="w-4 h-4" /> Driver Jerks
            </div>
            <div className="text-4xl font-black text-slate-800 mb-1" style={{ fontStretch: 'expanded' }}>{driverJerkCount}</div>
            <div className="text-slate-400 text-xs font-medium">Aggressive maneuvers</div>
          </div>
        </section>

        {/* Map Visualization */}
        <section className="bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 p-6 mb-8 w-full relative z-0">
          <div className="flex justify-between items-end mb-6">
             <div>
               <div className="text-slate-900 font-black text-xl tracking-tight">Route & Jerk Analysis</div>
               <div className="text-slate-400 text-sm font-medium mt-1">Visualizing routes, anomalies, and jerk events</div>
             </div>
             
             <div className="flex gap-4 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">
               <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-emerald-500"></div> Safe Route</div>
               <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-slate-300"></div> Standard Route</div>
             </div>
          </div>
          
          <div className="h-[520px] rounded-xl overflow-hidden shadow-inner relative z-0">
            <MapContainer center={[17.3850, 78.4300]} zoom={12} style={{ height: '100%', width: '100%' }}>
              <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />

              {/* Routes */}
              {routes && fleets_involved.map((fleetId) => {
                const fleetRoute = routes.routes[fleetId];
                if (!fleetRoute) return null;

                return (
                  <React.Fragment key={fleetId}>
                    {fleetRoute.safe && fleetRoute.safe.length > 0 && (
                      <Polyline positions={fleetRoute.safe} color="#10b981" weight={4} opacity={0.8} />
                    )}
                    {fleetRoute.standard && fleetRoute.standard.length > 0 && (
                      <Polyline
                        positions={fleetRoute.standard}
                        color="#64748b"
                        weight={2}
                        opacity={0.6}
                        dashArray="6, 6"
                      />
                    )}
                  </React.Fragment>
                );
              })}

              {/* Known Anomalies */}
              {routes &&
                routes.known_anomalies.map((anom, idx) => (
                  <Marker key={`anom-${idx}`} position={anom.pos} icon={createInfrastructureMarker()} zIndexOffset={1000}>
                    <Popup>
                      <strong>🛣️ Infrastructure Issue</strong>
                      <br />
                      {anom.type}
                      <br />
                      Severity: {(anom.severity * 10).toFixed(0)}/10
                    </Popup>
                  </Marker>
                ))}

              {/* Jerk Locations */}
              {allJerkLocations
                .filter(jerk => jerk.type === 'driver')
                .map((jerk, idx) => {
                  const isAtAnomaly = isNearAnyAnomaly(jerk.position);
                  if (isAtAnomaly) return null;
                  return (
                    <Marker key={`jerk-driver-${idx}`} position={jerk.position} icon={createJerkMarker()} zIndexOffset={100}>
                      <Popup>
                        <strong>🚗 Rash Driving</strong>
                        <br />
                        Fleet: {jerk.fleet}
                      </Popup>
                    </Marker>
                  );
                })}

              {allJerkLocations
                .filter(jerk => jerk.type === 'infrastructure')
                .map((jerk, idx) => {
                  const isDiscovered = jerk.anomaly_type === 'discovered';
                  const markerIcon = isDiscovered ? createNewlyDetectedMarker() : createInfrastructureMarker();
                  return (
                    <Marker key={`jerk-infra-${idx}`} position={jerk.position} icon={markerIcon} zIndexOffset={1000}>
                      <Popup>
                        <strong>🛣️ {isDiscovered ? 'Newly Detected' : 'Known'} Issue</strong>
                        <br />
                        Fleets: {jerk.affected.join(', ')}
                      </Popup>
                    </Marker>
                  );
                })}

              {/* Start & End Points */}
              {routes && (
                <>
                  <Marker position={routes.routes['T-102']?.source || [17.4399, 78.4983]}>
                    <Popup>📍 Start Point</Popup>
                  </Marker>
                  <Marker position={routes.routes['T-102']?.destination || [17.4436, 78.3800]}>
                    <Popup>🏁 End Point</Popup>
                  </Marker>
                </>
              )}
            </MapContainer>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* Driver Performance Scores */}
          <section className="bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 p-6 flex flex-col h-full w-full">
            <div className="mb-6">
               <div className="text-slate-900 font-black text-xl tracking-tight">Fleet Performance Breakdown</div>
               <div className="text-slate-400 text-sm font-medium mt-1">Individual driver and cargo risk assessment</div>
            </div>
            
            <div className="flex flex-col gap-4 flex-1">
              {Object.values(fleetAnalytics).map((fleet, i) => {
                const fleetId = fleet.fleet_id || fleet.id;
                const score = fleet.score || Math.round(fleet.score);
                const totalJerks = fleet.total_jerks || fleet.driver_jerks || 0;
                
                const sTone = score >= 80 ? 'emerald' : score >= 60 ? 'yellow' : 'pink';

                return (
                  <div key={fleetId} className={`p-4 rounded-xl border border-${sTone}-100 bg-${sTone}-50/30 flex flex-col`}>
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <div className="text-slate-900 font-bold flex items-center gap-2">
                          <Truck className="w-4 h-4 text-slate-500" />
                          {fleet.driver || 'Unknown'} <span className="text-slate-400 text-sm">({fleetId})</span>
                        </div>
                        <div className="text-slate-500 text-xs font-medium mt-1">
                          {fleet.cargo || 'General cargo'} • {fleet.personality || 'moderate'} driver
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-2xl font-black text-${sTone}-600 leading-none`}>{score.toFixed(0)}</div>
                        <div className={`text-${sTone}-500 text-[10px] font-bold uppercase tracking-wider mt-1`}>Score</div>
                      </div>
                    </div>

                    <div className="w-full bg-white h-2 rounded-full overflow-hidden border border-slate-200/50 mb-3">
                      <div className={`bg-${sTone}-500 h-full rounded-full transition-all`} style={{ width: `${Math.min(score, 100)}%` }}></div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mt-auto">
                      <div>
                        <div className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">Jerk Events</div>
                        <div className="text-slate-800 font-bold text-lg leading-none mt-1">{totalJerks}</div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">Telemetry Pts</div>
                        <div className="text-slate-800 font-bold text-lg leading-none mt-1">{fleet.telemetry_points || 0}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="flex flex-col gap-8 h-full w-full">
            {/* Infrastructure Issues */}
            {Object.keys(infrastructure_issues).length > 0 && (
              <section className="bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 p-6 flex flex-col">
                <div className="mb-6">
                   <div className="text-slate-900 font-black text-xl tracking-tight">Infrastructure Issues</div>
                   <div className="text-slate-400 text-sm font-medium mt-1">{Object.keys(infrastructure_issues).length} location{Object.keys(infrastructure_issues).length !== 1 ? 's' : ''} with anomalies</div>
                </div>
                
                <div className="flex flex-col gap-3">
                  {Object.entries(infrastructure_issues).map(([location, issue], i) => (
                    <div key={location} className="p-4 rounded-xl border border-yellow-200 bg-yellow-50/50 flex justify-between items-center">
                       <div>
                         <div className="text-slate-800 font-bold text-sm tracking-tight flex items-center gap-1.5"><MapPin className="w-4 h-4 text-yellow-600"/> {location}</div>
                         <div className="text-slate-500 text-xs font-medium mt-1">Affected: <span className="font-bold text-slate-700">{issue.affected_fleets.join(', ')}</span></div>
                       </div>
                       <div className="text-right shrink-0">
                         <div className="text-xl font-black text-yellow-600 leading-none">{issue.jerk_count}</div>
                         <div className="text-yellow-700/60 text-[10px] font-bold uppercase tracking-wider mt-1">Incidents</div>
                       </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Route Details */}
            <section className="bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 p-6 flex flex-col flex-1">
              <div className="mb-6">
                 <div className="text-slate-900 font-black text-xl tracking-tight">Route details</div>
                 <div className="text-slate-400 text-sm font-medium mt-1">Fleet routing behavior & deviations</div>
              </div>
              
              <div className="flex flex-col gap-3">
                {Object.entries(routeTaken || {}).map(([fleetId, route]) => (
                  <div key={fleetId} className="p-4 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-slate-900 mb-1 flex items-center gap-1.5"><Truck className="w-3.5 h-3.5 text-slate-400"/> {fleetId}</div>
                      <div className="text-xs text-slate-500">Route Diversity: <span className="font-bold text-slate-700">{route.diversions}</span></div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Route Used</div>
                      <div className={`px-2 py-1 rounded inline-block text-xs font-bold leading-none ${route.route_used === 'safe' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700'}`}>
                        {route.route_used === 'safe' ? 'OPTIMIZED' : 'STANDARD'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>

      </div>
    </DashboardLayout>
  );
}
