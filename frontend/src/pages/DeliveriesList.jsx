import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout.jsx';
import { Loader2, AlertCircle, PackageCheck } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://kinetiq-gyrn.onrender.com';

export default function DeliveriesList() {
  const navigate = useNavigate();
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchDeliveries = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/deliveries/completed`);
        const data = await res.json();
        setDeliveries(data.completed_deliveries || []);
      } catch (err) {
        setError('Failed to load deliveries: ' + err.message);
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchDeliveries();
    const interval = setInterval(fetchDeliveries, 10000); // Refresh every 10 seconds
    return () => clearInterval(interval);
  }, []);

  const breadcrumbs = (
    <>
      <Link to="/" className="text-slate-500 hover:text-blue-600 transition-colors font-semibold tracking-wide uppercase cursor-pointer">REPORTS</Link>
      <span className="mx-2 text-slate-300">/</span>
      <span className="text-slate-800 font-semibold tracking-wide uppercase">Analytics</span>
    </>
  );

  return (
    <DashboardLayout activeItem="Analytics" breadcrumbs={breadcrumbs}>
      <div className="p-8 w-full max-w-[1400px] mx-auto flex-1 flex flex-col relative">
        
        {/* Page Title & Actions */}
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-4">
          <div>
            <div className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-2">
              Fleet Operations
            </div>
            <h1 
              className="text-4xl leading-none font-black text-slate-900 tracking-tighter"
              style={{ fontStretch: 'expanded' }}
            >
              Completed Deliveries
            </h1>
          </div>
          
          <button 
            type="button"
            onClick={() => navigate('/fleets')}
            className="px-5 py-2.5 rounded-lg border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-colors bg-white shadow-sm"
          >
            ← View Active Fleets
          </button>
        </div>

        {error && (
          <div className="w-full bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-4 mb-8 shadow-sm">
            <div className="p-2 bg-red-100 rounded-lg shrink-0">
              <AlertCircle className="text-red-600" size={24} />
            </div>
            <div>
              <div className="text-red-900 font-bold text-lg tracking-tight">Error Loading Data</div>
              <div className="text-red-700 text-sm font-medium mt-1">{error}</div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center p-16">
            <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
            <div className="text-slate-500 font-medium tracking-wide">Syncing data stream...</div>
          </div>
        ) : deliveries.length === 0 ? (
          <div className="w-full bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 p-16 flex flex-col items-center justify-center min-h-[300px]">
             <PackageCheck className="w-16 h-16 text-slate-200 mb-4" />
             <p className="text-slate-600 font-bold text-xl mb-2 tracking-tight">No completed deliveries yet</p>
             <p className="text-slate-400 text-sm font-medium">Completed deliveries will appear here as they finish to run post-route analytics.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 w-full pb-8">
            {deliveries.map((delivery) => {
              const isExcellent = delivery.average_score >= 80;
              const isGood = delivery.average_score >= 60 && delivery.average_score < 80;
              
              const accentColor = isExcellent ? 'emerald' : isGood ? 'yellow' : 'pink';
              const fleetName = delivery.frontend_fleet_name || `Delivery ${delivery.delivery_id}`;

              return (
                <div
                  key={`${delivery.delivery_id}-${delivery.frontend_fleet_id}`}
                  onClick={() => navigate(`/delivery/${delivery.delivery_id}/analytics`)}
                  className="bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 overflow-hidden relative group hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all cursor-pointer flex flex-col"
                >
                  {/* Top Color Bar */}
                  <div className={`absolute top-0 left-0 w-full h-1.5 bg-${accentColor}-500 transition-colors`}></div>
                  
                  <div className="p-6 flex-1 flex flex-col">
                    <div className="flex justify-between items-start mb-6">
                      <div>
                        <div className="text-slate-900 font-black text-xl mb-1 tracking-tight truncate pr-4">{fleetName}</div>
                        <div className="text-slate-400 text-xs font-bold uppercase tracking-widest">
                          ID: {delivery.delivery_id.toUpperCase().slice(0, 8)}
                        </div>
                      </div>
                      
                      <div className={`px-3 py-1 rounded-full text-xs font-bold shrink-0 ${
                        isExcellent ? 'bg-emerald-100 text-emerald-700' :
                        isGood ? 'bg-yellow-100 text-yellow-700' :
                        'bg-pink-100 text-pink-700'
                      }`}>
                        {isExcellent ? 'Excellent' : isGood ? 'Fair' : 'Poor'}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 w-full mb-8 bg-slate-50 p-4 rounded-xl border border-slate-100">
                      <div className="flex-1 truncate font-medium text-slate-700 text-sm">{delivery.source_hub}</div>
                      <div className="text-slate-300 font-bold">→</div>
                      <div className="flex-1 text-right truncate font-medium text-slate-700 text-sm">{delivery.dest_hub}</div>
                    </div>

                    <div className="grid grid-cols-3 gap-4 mt-auto pt-6 border-t border-slate-100">
                      <div>
                        <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">Score</div>
                        <div className={`text-2xl font-black ${isExcellent ? 'text-emerald-600' : isGood ? 'text-yellow-600' : 'text-pink-600'}`}>
                          {delivery.average_score.toFixed(0)}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">Time</div>
                        <div className="text-2xl font-black text-slate-700">
                          {(Math.round(delivery.duration_seconds) / 60).toFixed(1)}m
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">Jerks</div>
                        <div className={`text-2xl font-black ${delivery.total_jerks > 0 ? 'text-pink-600' : 'text-slate-700'}`}>
                          {delivery.total_jerks}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
