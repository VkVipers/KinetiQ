import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ShieldAlert, AlertTriangle, Truck, MapPin, Zap } from 'lucide-react';
import { useFleetStore } from '../state/FleetContext.jsx'; // Connect to central store

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://kinetiq-gyrn.onrender.com';

const ROAD_ANOMALIES = [
  { id: 'anom-1', pos: [17.4435, 78.4458], type: 'Severe Pothole Cluster', severity: 'High', reports: 14 },
  { id: 'anom-2', pos: [17.3200, 78.4000], type: 'Uneven Expansion Joint', severity: 'Medium', reports: 6 },
];

// Hidden potholes - only discovered by vehicles during simulation
const HIDDEN_ANOMALIES = [
  { id: 'hidden-1', pos: [17.4269, 78.4391], type: 'Hidden Pothole', severity: 'Unknown', nearRoute: 'Alpha' },
  { id: 'hidden-2', pos: [17.279, 78.3825], type: 'Hidden Road Damage', severity: 'Unknown', nearRoute: 'Bravo' },
  { id: 'hidden-3', pos: [17.3301, 78.4638], type: 'Hidden Deep Rut', severity: 'Unknown', nearRoute: 'Charlie' },
];

const createTruckIcon = (color) => L.divIcon({
  className: 'custom-truck',
  html: `<div style="background-color: ${color}; width: 32px; height: 32px; border-radius: 50%; border: 3px solid white; box-shadow: 0 4px 6px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center;"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17h4V5H2v12h3"/><path d="M20 17h2v-9h-4V5h-4v12h1"/><path d="M7 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/><path d="M17 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/></svg></div>`,
  iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -16]
});

const hazardIcon = L.divIcon({
  className: 'custom-hazard',
  html: `<div style="background-color: #ef4444; width: 28px; height: 28px; border-radius: 6px; border: 2px solid white; box-shadow: 0 4px 6px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; transform: rotate(45deg);"><svg style="transform: rotate(-45deg);" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></div>`,
  iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -14]
});

const hiddenHazardIcon = L.divIcon({
  className: 'hidden-hazard',
  html: `<div style="background-color: #9ca3af; width: 24px; height: 24px; border-radius: 4px; border: 2px solid #d1d5db; box-shadow: 0 2px 4px rgba(0,0,0,0.1); display: flex; align-items: center; justify-content: center; transform: rotate(45deg); opacity: 0.5;"><svg style="transform: rotate(-45deg);" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></div>`,
  iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12]
});

const getDistance = (p1, p2) => Math.sqrt(Math.pow(p2[0] - p1[0], 2) + Math.pow(p2[1] - p1[1], 2));
const getPathLength = (path) => { let len = 0; for (let i = 0; i < path.length - 1; i++) len += getDistance(path[i], path[i+1]); return len; };
const getInterpolatedPosition = (path, percent) => {
  if (!path || path.length === 0) return [17.4, 78.4];
  if (percent >= 100) return path[path.length - 1];
  if (percent <= 0) return path[0];
  const targetDist = (percent / 100) * getPathLength(path);
  let currentDist = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const segDist = getDistance(path[i], path[i+1]);
    if (currentDist + segDist >= targetDist) {
      const weight = (targetDist - currentDist) / segDist;
      return [ path[i][0] + (path[i+1][0] - path[i][0]) * weight, path[i][1] + (path[i+1][1] - path[i][1]) * weight ];
    }
    currentDist += segDist;
  }
  return path[path.length - 1];
};

// Helper function to check if position is near any anomaly
const isNearAnyAnomaly = (position, threshold = 0.035) => {
  const allAnomalies = [...ROAD_ANOMALIES, ...HIDDEN_ANOMALIES];
  return allAnomalies.some(anom => {
    const latDiff = Math.abs(position[0] - anom.pos[0]);
    const lonDiff = Math.abs(position[1] - anom.pos[1]);
    return latDiff < threshold && lonDiff < threshold;
  });
};

export default function FleetMap({ activeTruckId }) {
  const [roadPaths, setRoadPaths] = useState(null);
  const [optimizeRoutes, setOptimizeRoutes] = useState(false);
  const [safeRoutesLoading, setSafeRoutesLoading] = useState({});
  const [requestingFleet, setRequestingFleet] = useState(null);
  
  // 1. Pull dynamic state from central store instead of hardcoding
  const { trucks, truckTelemetry } = useFleetStore();

  // 2. Ensure custom trucks map to map-ready objects with default UI properties
  const mapReadyTrucks = trucks.map((t, index) => {
    const colors = ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899'];
    // Preserve hardcoded colors for alpha/bravo/charlie, apply dynamic colors to new fleets
    let color = colors[index % colors.length];
    if (t.id.includes('102') || t.id.includes('118') || t.id.includes('307')) color = '#3b82f6';
    if (t.id.includes('205') || t.id.includes('221') || t.id.includes('101')) color = '#f59e0b';

    return {
      ...t,
      driver: t.driverName || `Driver ${index + 1}`,
      cargo: t.cargoType || 'General',
      color: color,
      personality: t.driverPersonality || 'moderate'
    };
  });

  const displayedFleets = activeTruckId 
    ? mapReadyTrucks.filter(f => f.id === activeTruckId) 
    : mapReadyTrucks;

  // Fetch routes whenever the number of trucks changes
  useEffect(() => {
    fetch(`${API_BASE_URL}/routes`)
      .then(res => res.json())
      .then(data => setRoadPaths(data.routes))
      .catch(err => console.error("Failed to load road paths:", err));
  }, [trucks.length]);

  const handleOptimizeToggle = async () => {
    const newOptimize = !optimizeRoutes;
    setOptimizeRoutes(newOptimize);

    if (newOptimize) {
      setSafeRoutesLoading(Object.fromEntries(displayedFleets.map(f => [f.id, true])));
      
      for (const fleet of displayedFleets) {
        // 3. Read current progress from telemetry context dynamically
        const currentProgress = truckTelemetry[fleet.id]?.progress || 0;
        
        try {
          setRequestingFleet(fleet.id);
          const response = await fetch(`${API_BASE_URL}/safe-route`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fleet_id: fleet.id,
              current_progress_pct: currentProgress,
              enable: true
            })
          });
          
          if (response.ok) {
            const data = await response.json();
            setRoadPaths(prev => ({
              ...prev,
              [fleet.id]: {
                ...prev?.[fleet.id],
                safe: data.safe_route,
                using_safe: true
              }
            }));
          }
        } catch (error) {
          console.error(`Failed to request safe route for ${fleet.id}:`, error);
        } finally {
          setSafeRoutesLoading(prev => ({ ...prev, [fleet.id]: false }));
          setRequestingFleet(null);
        }
      }
    } else {
      for (const fleet of displayedFleets) {
        try {
          await fetch(`${API_BASE_URL}/safe-route`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fleet_id: fleet.id, enable: false })
          });
          
          setRoadPaths(prev => ({
            ...prev,
            [fleet.id]: { ...prev?.[fleet.id], using_safe: false }
          }));
        } catch (error) {
          console.error(`Failed to disable safe route for ${fleet.id}:`, error);
        }
      }
    }
  };

  return (
    <div className="flex flex-col md:flex-row gap-6 p-4 bg-gray-50 rounded-xl w-full">
      <div className="w-full md:w-1/3 flex flex-col gap-4">
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-center gap-3 mb-2">
            <MapPin className="text-blue-600 w-6 h-6" />
            <h2 className="text-xl font-bold text-gray-800">Live Telemetry Map</h2>
          </div>
          <p className="text-sm text-gray-500 mb-6">
            Real-time tracking of fleets with crowdsourced infrastructure data and dynamic route optimization.
          </p>

          {/* <div className="bg-blue-50 border border-blue-100 p-4 rounded-lg mb-6"> */}
                {/* <div className="flex items-center justify-between mb-2"> */}
                {/* <span className="font-semibold text-blue-900 flex items-center gap-2"> */}
                    {/* <Zap className="w-4 h-4" /> Smart Route Optimization */}
                {/* </span> */}
                {/* <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                    type="checkbox" 
                    className="sr-only peer" 
                    checked={optimizeRoutes}
                    onChange={handleOptimizeToggle}
                    disabled={requestingFleet !== null}
                    />
                    <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label> */}
                {/* </div> */}
                {/* <p className="text-xs text-blue-700">
                {requestingFleet ? (
                    <span className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
                    Computing safe routes for {requestingFleet}...
                    </span>
                ) : optimizeRoutes 
                    ? "✓ Active: Safe routes calculated from current position (green). Standard routes shown in red (dashed)."
                    : "Inactive: Fleets following standard routes through known hazard zones."}
                </p> */}
            {/* </div> */}

          <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-red-500" /> Known Hazards
          </h3>
          <div className="flex flex-col gap-3 mb-6">
            {ROAD_ANOMALIES.map(anom => (
              <div key={anom.id} className="flex items-start gap-3 bg-red-50 p-3 rounded-lg border border-red-100">
                <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-red-900">{anom.type}</h4>
                  <p className="text-xs text-red-700 mt-0.5">Severity: <span className="font-bold">{anom.severity}</span></p>
                  <p className="text-xs text-red-600 mt-1">Verified by {anom.reports} sensors</p>
                </div>
              </div>
            ))}
          </div>

          <h3 className="font-semibold text-gray-600 mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-gray-400" /> Hidden Potholes (For Demo)
          </h3>
          <div className="flex flex-col gap-3">
            {HIDDEN_ANOMALIES.map(anom => (
              <div key={anom.id} className="flex items-start gap-3 bg-gray-50 p-3 rounded-lg border border-gray-200 opacity-60">
                <AlertTriangle className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-gray-600">{anom.type}</h4>
                  <p className="text-xs text-gray-500 mt-0.5">Near {anom.nearRoute} route</p>
                  <p className="text-xs text-gray-400 italic mt-1">Discovered when vehicles pass through</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 p-3 bg-gray-50 rounded-lg">
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Monitoring Truck</h4>
            <div className="flex flex-wrap gap-2">
              {displayedFleets.map(f => (
                <span key={f.id} className="text-xs px-2 py-1 bg-white border border-gray-200 rounded-full shadow-sm text-gray-500">
                  {f.id}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="w-full md:w-2/3 h-[500px] md:h-[600px] rounded-xl overflow-hidden shadow-sm border border-gray-200 relative z-0">
        <MapContainer center={[17.3850, 78.4300]} zoom={12} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />

          {ROAD_ANOMALIES.map((anom) => (
            <Marker key={anom.id} position={anom.pos} icon={hazardIcon} zIndexOffset={1000}>
              <Popup>
                <div className="font-sans">
                  <strong className="text-red-600 block text-base mb-1">{anom.type}</strong>
                  <span className="text-sm text-gray-600">Severity: <b>{anom.severity}</b></span><br/>
                  <span className="text-sm text-gray-600">Verified by: {anom.reports} KinetiQ sensors</span>
                </div>
              </Popup>
            </Marker>
          ))}

          {HIDDEN_ANOMALIES.map((anom) => (
            <Marker key={anom.id} position={anom.pos} icon={hiddenHazardIcon} zIndexOffset={1000}>
              <Popup>
                <div className="font-sans">
                  <strong className="text-gray-600 block text-base mb-1">{anom.type}</strong>
                  <span className="text-sm text-gray-500">Status: <b>Not in System</b></span><br/>
                  <span className="text-sm text-gray-500">Located near {anom.nearRoute} route</span><br/>
                  <span className="text-xs italic text-gray-400 mt-2 block">Will be discovered and reported when vehicles pass through during simulation</span>
                </div>
              </Popup>
            </Marker>
          ))}

          {roadPaths ? displayedFleets.map((fleet) => {
            const fleetRoutes = roadPaths[fleet.id];
            if (!fleetRoutes) return null;
            
            // 4. Fetch the real, exact progress dictated by the backend
            const progress = truckTelemetry[fleet.id]?.progress || 0;

            const standardPath = fleetRoutes.standard || [];
            const safePath = fleetRoutes.safe || [];
            const usingSafe = fleetRoutes.using_safe;
            
            const currentPath = usingSafe && safePath.length > 0 ? safePath : standardPath;
            const currentPos = getInterpolatedPosition(currentPath, progress);
            const fleetColor = usingSafe ? '#10b981' : fleet.color;

            return (
              <React.Fragment key={fleet.id}>
                {optimizeRoutes && safePath.length > 0 ? (
                  <>
                    <Polyline positions={standardPath} color="#ef4444" weight={4} opacity={0.4} dashArray="8, 12" />
                    <Polyline positions={safePath} color="#10b981" weight={5} opacity={0.9} />
                  </>
                ) : (
                  <Polyline positions={standardPath} color={fleet.color} weight={4} opacity={0.7} />
                )}

                <Marker position={currentPos} icon={createTruckIcon(fleetColor)}>
                  <Popup>
                    <div className="font-sans min-w-[150px]">
                      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-gray-100">
                        <Truck className="w-4 h-4" color={fleetColor} />
                        <strong className="text-base text-gray-800">{fleet.id}</strong>
                      </div>
                      <p className="text-sm text-gray-600 mb-1">Driver: <b>{fleet.driver}</b></p>
                      <p className="text-sm text-gray-600 mb-1">Cargo: <b>{fleet.cargo}</b></p>
                      <p className="text-xs text-gray-600 mb-1">Personality: <b>{fleet.personality}</b></p>
                      <p className="text-xs mt-2 text-gray-500">
                        Status: <span className={`font-medium ${progress >= 100 ? 'text-green-600' : usingSafe ? 'text-green-600' : 'text-blue-600'}`}>
                          {progress >= 100 ? '✓ Arrived at Destination' : (usingSafe ? '✓ Safe Route' : 'Standard')} ({progress.toFixed(0)}%)
                        </span>
                      </p>
                    </div>
                  </Popup>
                </Marker>
              </React.Fragment>
            );
          }) : null}
        </MapContainer>
      </div>
    </div>
  );
}