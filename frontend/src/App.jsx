import './App.css'
import { Navigate, Route, Routes } from 'react-router-dom'

import CreateFleet from './pages/CreateFleet.jsx'
import FleetDetails from './pages/FleetDetails.jsx'
import Fleets from './pages/Fleets.jsx'
import Home from './pages/Home.jsx'
import TruckDashboard from './pages/TruckDashboard.jsx'
import DeliveryAnalytics from './pages/DeliveryAnalytics.jsx'
import DeliveriesList from './pages/DeliveriesList.jsx'
import { useDeliveriesMonitor } from './hooks/useDeliveriesMonitor'

function App() {
  // Start central delivery monitoring (tracks all fleets in parallel)
  useDeliveriesMonitor()

  return (
    <>

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/create" element={<CreateFleet />} />
        <Route path="/fleets" element={<Fleets />} />
        <Route path="/fleet/:id" element={<FleetDetails />} />
        <Route path="/truck/:id" element={<TruckDashboard />} />
        <Route path="/delivery/:deliveryId/analytics" element={<DeliveryAnalytics />} />
        <Route path="/deliveries/completed" element={<DeliveriesList />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}

export default App
