export const initialFleets = [
  {
    id: 'alpha',
    name: 'Fleet Alpha',
    cargoType: 'Fragile',
    source: 'Jebel Ali Port',
    destination: 'Dubai Distribution Hub',
    eta: '2h 10m',
    startTime: '09:30',
  },
  {
    id: 'bravo',
    name: 'Fleet Bravo',
    cargoType: 'Perishable',
    source: 'Abu Dhabi Cold Storage',
    destination: 'Sharjah Market',
    eta: '3h 05m',
    startTime: '08:50',
  },
  {
    id: 'charlie',
    name: 'Fleet Charlie',
    cargoType: 'Heavy',
    source: 'RAK Industrial Zone',
    destination: 'Dubai Construction Site',
    eta: '4h 20m',
    startTime: '07:15',
  },
]

export const initialTrucks = [
  { id: 'T-102', fleetId: 'alpha', driverName: 'A. Khan', status: 'Moving' },
  { id: 'T-118', fleetId: 'alpha', driverName: 'S. Patel', status: 'Moving' },
  { id: 'T-205', fleetId: 'bravo', driverName: 'M. Noor', status: 'Idle' },
  { id: 'T-221', fleetId: 'bravo', driverName: 'R. Silva', status: 'Moving' },
  { id: 'T-307', fleetId: 'charlie', driverName: 'J. Chen', status: 'Moving' },
]

export const initialTelemetry = {
  'T-102': { rashness_score: 2.1, driver_score: 79, event: 'Normal', timestamp: new Date().toISOString() },
  'T-118': { rashness_score: 1.8, driver_score: 82, event: 'Normal', timestamp: new Date().toISOString() },
  'T-205': { rashness_score: 5.3, driver_score: 47, event: 'Harsh Braking', timestamp: new Date().toISOString() },
  'T-221': { rashness_score: 6.7, driver_score: 33, event: 'Sharp Turn', timestamp: new Date().toISOString() },
  'T-307': { rashness_score: 4.2, driver_score: 58, event: 'Normal', timestamp: new Date().toISOString() },
}

