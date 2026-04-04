import { useEffect, useRef } from 'react'
import { useFleetStore } from '../state/FleetContext'
import axios from 'axios'

/**
 * Central delivery monitor hook
 * Runs once from App level and continuously polls all deliveries
 * Updates context automatically without requiring user navigation
 */
export function useDeliveriesMonitor() {
  const {
    setActiveDeliveries,
    setCompletedDeliveries,
    setTruckTelemetry,
  } = useFleetStore()

  const pollingRef = useRef(null)
  const completedDeliveriesRef = useRef(new Map()) // Map of frontend_fleet_id -> delivery data
  const autoStartDoneRef = useRef(false) // Track if we've already auto-started

  useEffect(() => {
    let cancelled = false

    // Auto-start deliveries on first load (kick off telemetry recording for all fleets)
    const autoStartDeliveries = async () => {
      if (autoStartDoneRef.current) return
      
      try {
        const res = await axios.post('https://kinetiq-gyrn.onrender.com/deliveries/auto-start', {}, { timeout: 2000 })
        if (!cancelled) {
          autoStartDoneRef.current = true
          console.log('🚀 Auto-started background deliveries for all fleets')
        }
      } catch (err) {
        console.error('Failed to auto-start deliveries:', err.message)
      }
    }

    async function pollDeliveries() {
      try {
        const res = await axios.get('https://kinetiq-gyrn.onrender.com/deliveries/status-all', { timeout: 800 })
        const data = res.data

        if (cancelled) return

        // Update active deliveries in context - only ONE per fleet
        const activeMap = {}
        data.active_deliveries.forEach(delivery => {
          // Store only latest/primary delivery ID per fleet
          if (!activeMap[delivery.frontend_fleet_id]) {
            activeMap[delivery.frontend_fleet_id] = delivery.delivery_id
          }
        })
        setActiveDeliveries(activeMap)

        // Update truck telemetry from all active deliveries
        data.active_deliveries.forEach(delivery => {
          Object.entries(delivery.fleet_telemetry || {}).forEach(([fleetId, telemetry]) => {
            setTruckTelemetry(prev => ({
              ...prev,
              [fleetId]: {
                ...telemetry,
                delivery_id: delivery.delivery_id,
                progress: delivery.progress,
              }
            }))
          })
        })

        // Handle newly completed deliveries - deduplicate by frontend_fleet_id
        data.completed_deliveries.forEach(delivery => {
          const fleetId = delivery.frontend_fleet_id
          
          // Only track the latest completion for each fleet
          const existingCompletion = completedDeliveriesRef.current.get(fleetId)
          if (existingCompletion && existingCompletion.delivery_id === delivery.delivery_id) {
            return // Already tracked
          }

          // Mark this fleet's completion
          completedDeliveriesRef.current.set(fleetId, delivery)

          // Convert to display format
          const completeEntry = {
            delivery_id: delivery.delivery_id,
            frontend_fleet_id: delivery.frontend_fleet_id,
            frontend_fleet_name: delivery.frontend_fleet_name,
            trucks_involved: delivery.fleet_ids,
            source_hub: delivery.source_hub,
            dest_hub: delivery.dest_hub,
            status: "completed",
            average_score: delivery.average_score || 0,
            total_jerks: delivery.total_jerks || 0,
            duration_seconds: Math.round(delivery.end_time - delivery.start_time),
            completed_at: delivery.end_time,
          }

          console.log(`✅ Delivery completed! ${delivery.frontend_fleet_name}:`, delivery.delivery_id)

          // Update completed deliveries in context - deduplicate by frontend_fleet_id
          setCompletedDeliveries(prev => {
            // Remove old completion for this fleet if exists
            const filtered = prev.filter(d => d.frontend_fleet_id !== fleetId)
            // Add new one
            return [...filtered, completeEntry]
          })

          // Trigger analytics page navigation for this delivery
          window.dispatchEvent(
            new CustomEvent('delivery-completed', {
              detail: { delivery_id: delivery.delivery_id }
            })
          )
        })
      } catch (err) {
        console.error('Deliveries monitor error:', err.message)
      }
    }

    // First: Auto-start deliveries for all fleets (ensures telemetry recording starts)
    autoStartDeliveries()

    // Then: Poll immediately and then every 1 second
    pollDeliveries()
    pollingRef.current = setInterval(pollDeliveries, 3000)

    return () => {
      cancelled = true
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
      }
    }
  }, [setActiveDeliveries, setCompletedDeliveries, setTruckTelemetry])
}
