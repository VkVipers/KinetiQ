import { createContext, useContext, useMemo, useState } from 'react'

import { initialFleets, initialTrucks } from '../data/mockData.js'

const FleetContext = createContext(null)

export function FleetProvider({ children }) {
  const [fleets, setFleets] = useState(initialFleets)
  const [trucks, setTrucks] = useState(initialTrucks)
  const [truckTelemetry, setTruckTelemetry] = useState({}) // { [truckId]: latestTelemetryPoint }
  const [activeDeliveries, setActiveDeliveries] = useState({}) // { [fleetId]: deliveryId }
  const [completedDeliveries, setCompletedDeliveries] = useState([]) // Array of completed delivery entries

  const value = useMemo(
    () => ({
      fleets,
      setFleets,
      trucks,
      setTrucks,
      truckTelemetry,
      setTruckTelemetry,
      activeDeliveries,
      setActiveDeliveries,
      completedDeliveries,
      setCompletedDeliveries,
    }),
    [fleets, trucks, truckTelemetry, activeDeliveries, completedDeliveries],
  )

  return <FleetContext.Provider value={value}>{children}</FleetContext.Provider>
}

export function useFleetStore() {
  const ctx = useContext(FleetContext)
  if (!ctx) throw new Error('useFleetStore must be used within FleetProvider')
  return ctx
}


