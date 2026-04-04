import math
import time
import random
import pandas as pd
from flask import Flask, jsonify, request
from flask_cors import CORS
import requests
import os
import json
from functools import lru_cache
from datetime import datetime
from collections import defaultdict
import uuid

app = Flask(__name__)
CORS(app)

def cleanup_old_deliveries(max_completed=20):
    """Keep only the most recent 'max_completed' finished deliveries to save memory."""
    completed_sessions = [
        (did, session) for did, session in DELIVERY_SESSIONS.items() 
        if session.status == "completed"
    ]
    
    if len(completed_sessions) > max_completed:
        # Sort by end_time descending (newest first)
        completed_sessions.sort(key=lambda x: x[1].end_time or 0, reverse=True)
        
        # Delete everything after the top 20
        to_remove = [did for did, session in completed_sessions[max_completed:]]
        for did in to_remove:
            del DELIVERY_SESSIONS[did]

# ========================== DATA LOADING ==========================
try:
    # Load CSV from parent directory (root of workspace)
    csv_path = os.path.join(os.path.dirname(__file__), "..", "df_datasetRashdrivesIMU.csv")
    df = pd.read_csv(csv_path).fillna(0.0)
    IMU_DATA = df.to_dict('records')
    
    # Single pass: normalize column names in each record
    for record in IMU_DATA:
        # Map 'accele_x' to 'accelex_x' if needed
        if 'accele_x' in record and 'accelex_x' not in record:
            record['accelex_x'] = record['accele_x']
        if 'accele_y' in record and 'accelex_y' not in record:
            record['accelex_y'] = record['accele_y']
        
        # Calculate accelex_z as magnitude of lateral acceleration (not in CSV)
        if 'accelex_z' not in record:
            x = float(record.get('accele_x', record.get('accelex_x', 0)))
            y = float(record.get('accele_y', record.get('accelex_y', 0)))
            record['accelex_z'] = abs(x) + abs(y)
        
        # Use filtered gyro if available
        if 'gyro_z' not in record and 'gyro_z_filtered' in record:
            record['gyro_z'] = record['gyro_z_filtered']
    
    print(f"✓ Loaded {len(IMU_DATA)} IMU records from CSV")
except Exception as e:
    print(f"WARNING: IMU dataset failed to load ({e}).")
    IMU_DATA = [{"accelex_x": 0.0, "accelex_y": 0.0, "accelex_z": 1.0, "gyro_z": 0.0}]

# ========================== INFRASTRUCTURE & ANOMALIES ==========================
# Known anomalies - part of the system already
ANOMALIES = [
    # These are pre-known to the system (shown as bright red on frontend)
    {"pos": [17.4435, 78.4458], "type": "Severe Pothole Cluster", "severity": 0.9},
    {"pos": [17.3200, 78.4000], "type": "Uneven Expansion Joint", "severity": 0.6}
]

# Hidden anomalies - ONLY discovered by vehicles when they pass through
# NOT pre-known to the system (shown as grey translucent on frontend)
# These will be reported in analytics AFTER vehicles hit them
HIDDEN_ANOMALIES = [
    # Alpha route (HUB_A 17.4399,78.4983 → HUB_B 17.4436,78.3800) hidden pothole
    {"pos": [17.4269, 78.4391], "type": "Hidden Pothole", "severity": 0.92},
    
    # Bravo route (HUB_B 17.4436,78.3800 → HUB_C 17.2403,78.4294) hidden pothole
    {"pos": [17.279, 78.3825], "type": "Hidden Road Damage", "severity": 0.88},
    
    # Charlie route (HUB_A 17.4399,78.4983 → HUB_C 17.2403,78.4294) hidden pothole
    {"pos": [17.3301, 78.4638], "type": "Hidden Deep Rut", "severity": 0.85},
]

# Target destinations and route hubs
ROUTE_HUBS = {
    "HUB_A": [17.4399, 78.4983],  # North Hub
    "HUB_B": [17.4436, 78.3800],  # South Hub
    "HUB_C": [17.2403, 78.4294],  # West Hub
    "HUB_D": [17.4000, 78.3500],  # East Hub
}

# Fleet personality profiles (pre-seeded, persistent drivers)
FLEET_PROFILES = {
    "T-102": {
        "driver": "Rajesh K.",
        "cargo": "Fragile Electronics",
        "personality": "safe",
        "rashness_base": 1.5,  # Natural rashness tendency (0-10)
        "reaction_time": 0.8,  # Quick to react to anomalies (0-1)
        "speed_variance": 0.3,  # How much speed varies
    },
    "T-118": {
        "driver": "Sandeep M.",
        "cargo": "Medical Supplies",
        "personality": "safe",
        "rashness_base": 1.2,
        "reaction_time": 0.9,
        "speed_variance": 0.2,
    },
    "T-205": {
        "driver": "Vikranth V.",
        "cargo": "Steel Pipes",
        "personality": "rash",
        "rashness_base": 8,  # Reduced from 6.5 - still aggressive but realistic
        "reaction_time": 0.4,
        "speed_variance": 3,
    },
    "T-221": {
        "driver": "Arjun P.",
        "cargo": "Lumber",
        "personality": "moderate",
        "rashness_base": 3.5,  # Slightly reduced from 4.0 for more balance
        "reaction_time": 0.6,
        "speed_variance": 0.5,
    },
    "T-307": {
        "driver": "Priya S.",
        "cargo": "Textiles",
        "personality": "safe",
        "rashness_base": 2.0,
        "reaction_time": 0.85,
        "speed_variance": 0.25,
    },
    "T-101": {
        "driver": "Kumar M.",
        "cargo": "Construction Materials",
        "personality": "rash",
        "rashness_base": 5.0,  # Reduced from 7.2 - still aggressive but more realistic
        "reaction_time": 0.3,
        "speed_variance": 1.2,
    },
}

# Route pairs: source -> destination for each FLEET (not individual trucks)
# All trucks in a fleet share the same route
FLEET_ROUTE_MAP = {
    "alpha": {"source": "HUB_A", "dest": "HUB_B"},   # Fleet Alpha: T-102, T-118
    "bravo": {"source": "HUB_B", "dest": "HUB_C"},   # Fleet Bravo: T-205, T-221
    "charlie": {"source": "HUB_A", "dest": "HUB_C"}, # Fleet Charlie: T-307, T-101
}

FRONTEND_FLEETS = [
    {"fleet_id": "alpha", "fleet_name": "Fleet Alpha", "trucks": ["T-102", "T-118"], "source": "HUB_A", "dest": "HUB_B"},
    {"fleet_id": "bravo", "fleet_name": "Fleet Bravo", "trucks": ["T-205", "T-221"], "source": "HUB_B", "dest": "HUB_C"},
    {"fleet_id": "charlie", "fleet_name": "Fleet Charlie", "trucks": ["T-307", "T-101"], "source": "HUB_A", "dest": "HUB_C"}
]

# Legacy per-truck routes (for backward compatibility, maps to fleet routes)
FLEET_ROUTES = {
    "T-102": {"source": "HUB_A", "dest": "HUB_B"},   # Alpha fleet route
    "T-118": {"source": "HUB_A", "dest": "HUB_B"},   # Alpha fleet route
    "T-205": {"source": "HUB_B", "dest": "HUB_C"},   # Bravo fleet route
    "T-221": {"source": "HUB_B", "dest": "HUB_C"},   # Bravo fleet route
    "T-307": {"source": "HUB_A", "dest": "HUB_C"},   # Charlie fleet route
    "T-101": {"source": "HUB_A", "dest": "HUB_C"},   # Charlie fleet route
}

# ========================== CUSTOM JERK DATA INJECTION ==========================
# Manual jerk timeseries data for specific fleets (can be filled from CSV)
# Format: fleet_id -> list of {timestamp, accelex_x, accelex_y, accelex_z, gyro_z, rashness_score, event}
RASH_JERK_DATA = {
    # Example: "F-205": [row1, row2, ...] - 500 rows of 5-second rash driving from CSV
}

# Track which row each fleet is using from custom jerk data
CUSTOM_JERK_INDEX = {}


# ========================== ROUTING FUNCTIONS ==========================
def haversine(coord1, coord2):
    """Calculate distance in meters between two coordinates."""
    R = 6371000  # Earth radius in meters
    phi_1, phi_2 = math.radians(coord1[0]), math.radians(coord2[0])
    delta_phi = math.radians(coord2[0] - coord1[0])
    delta_lambda = math.radians(coord2[1] - coord1[1])
    a = math.sin(delta_phi/2)**2 + math.cos(phi_1)*math.cos(phi_2) * math.sin(delta_lambda/2)**2
    return R * (2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)))

def get_path_length(path):
    """Get total distance of a path."""
    if len(path) < 2:
        return 0
    return sum(haversine(path[i], path[i+1]) for i in range(len(path)-1))

def get_interpolated_position(path, progress_pct):
    """Get position along path given progress percentage."""
    if len(path) < 2:
        return path[0] if path else [17.4, 78.4]
    if progress_pct >= 100:
        return path[-1]
    if progress_pct <= 0:
        return path[0]
    
    total_dist = get_path_length(path)
    if total_dist == 0:
        return path[0]
    
    target_dist = (progress_pct / 100.0) * total_dist
    current_dist = 0
    
    for i in range(len(path)-1):
        seg_dist = haversine(path[i], path[i+1])
        if current_dist + seg_dist >= target_dist:
            weight = (target_dist - current_dist) / seg_dist if seg_dist > 0 else 0
            return [
                path[i][0] + (path[i+1][0] - path[i][0]) * weight,
                path[i][1] + (path[i+1][1] - path[i][1]) * weight
            ]
        current_dist += seg_dist
    
    return path[-1]

@lru_cache(maxsize=32)
def fetch_osrm_route(start_lat, start_lon, end_lat, end_lon, cache_suffix=""):
    """Fetch route from OSRM with caching."""
    start = (start_lat, start_lon)
    end = (end_lat, end_lon)
    cache_key = f"{start_lat:.4f}_{start_lon:.4f}_{end_lat:.4f}_{end_lon:.4f}_{cache_suffix}"
    cache_file = f"route_cache_{cache_key}.json"
    
    if os.path.exists(cache_file):
        try:
            with open(cache_file, 'r') as f:
                return json.load(f)
        except Exception:
            pass

    coords_str = f"{start_lon},{start_lat};{end_lon},{end_lat}"
    url = f"https://routing.openstreetmap.de/routed-car/route/v1/driving/{coords_str}?overview=full&geometries=geojson"
    
    try:
        headers = {'User-Agent': 'KinetiQ-Hackathon-App/1.0'}
        response = requests.get(url, headers=headers, timeout=10).json()
        if response.get("code") == "Ok":
            route = response["routes"][0]["geometry"]["coordinates"]
            final_route = [[lat, lon] for lon, lat in route]
            with open(cache_file, 'w') as f:
                json.dump(final_route, f)
            return final_route
    except Exception as e:
        print(f"Routing failed for {cache_key}: {e}")
    
    # Fallback: direct line
    return [start, end]

def get_safe_route(start_pos, end_pos):
    """Generate a safe route from start to end, avoiding known anomalies."""
    # Try to get smart routing from OSRM
    route = fetch_osrm_route(start_pos[0], start_pos[1], end_pos[0], end_pos[1], "safe")
    
    # If route passes through anomalies, add waypoints to avoid them
    # For now, we'll use OSRM's smart routing as the safe route
    return route

def is_position_near_anomaly(position, threshold_meters=250):
    """Check if a position is near any known anomaly."""
    for anom in ANOMALIES:
        dist = haversine(position, anom["pos"])
        if dist < threshold_meters:
            return anom
    return None

def is_position_near_hidden_anomaly(position, threshold_meters=250):
    """Check if a position is near any hidden (unknown) anomaly."""
    for anom in HIDDEN_ANOMALIES:
        dist = haversine(position, anom["pos"])
        if dist < threshold_meters:
            # Mark as discovered
            anom["discovered"] = True
            return anom
    return None

# ========================== SIMULATION INITIALIZATION ==========================
START_TIME = time.time()
TRIP_DURATION_SEC = 60.0  # 60 second trip loop

# Cache for routes
ROUTE_CACHE = {}

class TelemetryDataGenerator:
    """
    Generate realistic IMU telemetry based on driver personality and conditions.
    Simulates a real person driving with consistent behavior patterns.
    Can use custom jerk data from CSV if provided.
    """
    def __init__(self, fleet_id, profile):
        self.fleet_id = fleet_id
        self.profile = profile
        self.csv_index = random.randint(0, len(IMU_DATA) - 1)
        self.custom_jerk_index = 0  # For custom jerk data playback
        
        # Personality traits (normalized 0-1 or 0-10)
        self.rashness_base = profile.get("rashness_base", 4.0)
        self.reaction_time = profile.get("reaction_time", 0.5)
        self.speed_variance = profile.get("speed_variance", 0.5)
        self.last_rashness = 1.5  # Track previous score for smooth transitions

    def generate_normal_driving(self):
        """Generate telemetry for normal driving based on personality."""
        row = IMU_DATA[self.csv_index]
        self.csv_index = (self.csv_index + 1) % len(IMU_DATA)
        
        # Try to get values from normalized column names first, then fallback
        accel_x = float(row.get("accelex_x", row.get("accele_x", random.uniform(-0.2, 0.2))))
        accel_y = float(row.get("accelex_y", row.get("accele_y", random.uniform(-0.2, 0.2))))
        accel_z = float(row.get("accelex_z", abs(accel_x) + abs(accel_y) + 1.0))
        gyro_z = float(row.get("gyro_z", row.get("gyro_z_filtered", random.uniform(-5, 5))))
        
        # NORMAL DRIVING BASELINE: Keep very low for all drivers
        # Smooth transition from last score (prevent sudden jumps)
        baseline_rashness = 1.5 + random.uniform(-0.3, 0.3)  # Reduced variance: 1.2-1.8
        
        # Only rash drivers have small occasional spikes even during normal (due to impatience)
        if self.rashness_base > 4.5 and random.random() < 0.10:  # 10% chance (reduced from 15%)
            rashness = 2.5 + random.uniform(0, 1.0)  # Small spike: 2.5-3.5 (reduced from 3.5-5)
        else:
            rashness = baseline_rashness
        
        # Smooth transition: move gradually from last score (max 0.3 change per tick)
        rashness = self.last_rashness + max(-0.3, min(0.3, rashness - self.last_rashness))
        rashness = max(0.5, min(3.5, rashness))  # Clamp normal driving to 0.5-3.5 range
        self.last_rashness = rashness
        
        return {
            "accel_x": accel_x,
            "accel_y": accel_y,
            "accel_z": accel_z,
            "gyro_z": gyro_z,
            "rashness_score": rashness,
            "event": "Normal"
        }

    def generate_anomaly_response(self, anomaly, near_distance_m):
        """
        Generate telemetry when vehicle encounters an anomaly.
        All drivers feel the jerk, but respond differently based on personality.
        Infrastructure jerks are IMMEDIATE (no smooth escalation) - sudden and sharp!
        """
        severity = anomaly.get("severity", 0.7)
        
        # Universal jerk from pothole hit - IMMEDIATE and SUDDEN
        jerk_magnitude = 2.5 + (severity * 2.5)  # 2.5-5.0 m/s²
        accel_z = jerk_magnitude + random.uniform(-0.3, 0.3)
        gyro_z = 10.0 + (severity * 10.0) + random.uniform(-3, 3)
        
        # How the driver responds depends on personality
        lateral_accel = 0.8 + (self.reaction_time * 1.2)  # Faster reaction = stronger control
        accel_x = random.uniform(-lateral_accel, lateral_accel)
        accel_y = random.uniform(-lateral_accel, lateral_accel)
        
        # Infrastructure jerks are SUDDEN - no smooth escalation
        # Rash drivers are slower to recover, causing higher rashness score
        if self.rashness_base > 4.5:
            rashness = 8.0 + random.uniform(0, 1.0)  # 8.0-9.0 IMMEDIATE jump (no smoothing)
        else:
            rashness = 7.5 + random.uniform(0, 1.0)  # 7.5-8.5 IMMEDIATE jump (no smoothing)
        
        # Update last_rashness for next iteration (but anomaly doesn't use smooth transition)
        self.last_rashness = rashness
        
        return {
            "accel_x": accel_x,
            "accel_y": accel_y,
            "accel_z": accel_z,
            "gyro_z": gyro_z,
            "rashness_score": max(0, min(10, rashness)),
            "event": anomaly.get("type", "Pothole")
        }

    def generate_rash_behavior(self, phase_pct):
        """Generate aggressive driving behavior at specific phases with smooth escalation."""
        # Rash drivers prone to aggressive behavior in many zones
        if phase_pct < 35 or phase_pct > 65:
            # Hard acceleration/braking zone
            accel_x = random.uniform(2.0, 3.5)
            accel_y = random.uniform(-0.3, 0.3)
            event = "Harsh Acceleration"
            target_rashness = 7.5 + random.uniform(0, 1.5)  # 7.5-9.0 (increased from 6.5-8.5)
        elif 35 <= phase_pct <= 65:
            # Sharp turn zone - covers majority of trip
            accel_x = random.uniform(-0.3, 0.3)
            accel_y = random.uniform(1.5, 3.5)
            event = "Sharp Turn"
            target_rashness = 7.0 + random.uniform(0, 1.5)  # 7.0-8.5 (increased from 6.0-8.0)
        else:
            return self.generate_normal_driving()
        
        # Smooth escalation from last score (max 1.0 increase per tick for faster climb)
        rashness = self.last_rashness + max(0, min(1.0, target_rashness - self.last_rashness))
        rashness = max(3.0, min(9.0, rashness))  # Increased max clamp from 8.5 to 9.0
        self.last_rashness = rashness
        
        accel_z = 1.0 + random.uniform(-0.2, 0.2)
        gyro_z = random.uniform(8, 15) if event == "Sharp Turn" else random.uniform(-3, 3)
        
        return {
            "accel_x": accel_x,
            "accel_y": accel_y,
            "accel_z": accel_z,
            "gyro_z": gyro_z,
            "rashness_score": rashness,
            "event": event
        }
    
    def get_custom_jerk_data(self):
        """Get next row of custom jerk data if available."""
        if self.fleet_id in RASH_JERK_DATA:
            data_rows = RASH_JERK_DATA[self.fleet_id]
            if data_rows and len(data_rows) > 0:
                # Get current row and advance index
                row = data_rows[self.custom_jerk_index % len(data_rows)]
                self.custom_jerk_index += 1
                
                return {
                    "accel_x": float(row.get("accelex_x", 0)),
                    "accel_y": float(row.get("accelex_y", 0)),
                    "accel_z": float(row.get("accelex_z", 1.0)),
                    "gyro_z": float(row.get("gyro_z", 0)),
                    "rashness_score": max(0, min(10, float(row.get("rashness_score", 7.0)))),
                    "event": row.get("event", "Rash Behavior")
                }
        return None


class FleetSimulator:
    """
    Simulates a fleet with real-world properties:
    - Persistent driver personality
    - Dynamic position tracking
    - Current route (can switch to safe route)
    - Realistic telemetry generation
    """
    def __init__(self, fleet_id, profile, start_pos, end_pos):
        self.fleet_id = fleet_id
        self.profile = profile
        self.start_pos = start_pos
        self.end_pos = end_pos
        
        # Route management
        self.current_route = fetch_osrm_route(start_pos[0], start_pos[1], end_pos[0], end_pos[1], "standard")
        self.safe_route = None
        self.using_safe_route = False
        self.safe_route_start_time = None
        
        # State tracking
        self.history = []
        self.telemetry_gen = TelemetryDataGenerator(fleet_id, profile)
        
        # Personality persistence (affects behavior predictably)
        self.personality = profile.get("personality", "moderate")
        seed_base = sum(ord(char) * (i + 1) for i, char in enumerate(fleet_id))
        self.seed_random = (seed_base * 7919) % 100000
        random.seed(self.seed_random)

    def get_current_position(self, progress_pct):
        """Get vehicle position based on progress along current route."""
        if self.using_safe_route and self.safe_route:
            return get_interpolated_position(self.safe_route, progress_pct)
        return get_interpolated_position(self.current_route, progress_pct)

    def generate_tick(self, progress_pct, is_optimized=False):
        """
        Generate one tick of telemetry data.
        progress_pct: 0-100, position along the current route
        is_optimized: whether safe route optimization is enabled
        """
        current_pos = self.get_current_position(progress_pct)
        
        # Priority 1: Use custom jerk data if available (for manual rash behavior)
        custom_jerk = self.telemetry_gen.get_custom_jerk_data()
        anomaly_type = None  # Track whether anomaly is known or discovered
        if custom_jerk:
            telemetry = custom_jerk
        else:
            # Priority 2: Check for known anomalies at current position
            nearby_anomaly = is_position_near_anomaly(current_pos, threshold_meters=200)
            
            if nearby_anomaly:
                # All drivers feel infrastructure jerks - KNOWN anomaly
                anomaly_type = "known"
                nearby_distance = haversine(current_pos, nearby_anomaly["pos"])
                telemetry = self.telemetry_gen.generate_anomaly_response(nearby_anomaly, nearby_distance)
            else:
                # Priority 2.5: Check for HIDDEN anomalies (unknown to system, will be discovered)
                hidden_anomaly = is_position_near_hidden_anomaly(current_pos, threshold_meters=200)
                if hidden_anomaly:
                    # Same jerk response, but mark as "discovered" (was hidden, now detected)
                    anomaly_type = "discovered"
                    nearby_distance = haversine(current_pos, hidden_anomaly["pos"])
                    telemetry = self.telemetry_gen.generate_anomaly_response(hidden_anomaly, nearby_distance)
                # Priority 3: Personality-based aggressive behavior
                # Rash drivers : 50% for rash driving (need higher frequency to hit score > 7 consistently)
                # Safe drivers: 8% for rash driving (realistic - very rare moments of aggressive behavior)
                elif self.personality == "rash" and random.random() < 0.50:  # Increased from 40% to 50%
                    telemetry = self.telemetry_gen.generate_rash_behavior(progress_pct)
                elif self.personality == "safe" and random.random() < 0.08:  # Increased from 5% slightly for visibility
                    telemetry = self.telemetry_gen.generate_rash_behavior(progress_pct)
                # Priority 4: Normal driving
                else:
                    telemetry = self.telemetry_gen.generate_normal_driving()
        
        point = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
            "lat": current_pos[0],
            "lon": current_pos[1],
            "accelex_x": telemetry["accel_x"],
            "accelex_y": telemetry["accel_y"],
            "accelex_z": telemetry["accel_z"],
            "gyro_z": telemetry["gyro_z"],
            "rashness_score": telemetry["rashness_score"],
            "event": telemetry["event"],
            "anomaly_type": anomaly_type  # Track if known or discovered infrastructure
        }
        
        self.history.append(point)
        if len(self.history) > 100:
            self.history.pop(0)
        
        return point

    def set_safe_route(self):
        """Calculate and set a safe route from current position to destination."""
        if not self.safe_route:
            # Calculate safe route using OSRM
            current_pos = self.get_current_position(0)  # This will get position from current route
            self.safe_route = fetch_osrm_route(
                current_pos[0], current_pos[1],
                self.end_pos[0], self.end_pos[1],
                "safe"
            )
            self.using_safe_route = True
    
    def clear_safe_route(self):
        """Return to standard route."""
        self.using_safe_route = False


# ========================== DELIVERY SESSION MANAGEMENT ==========================
class DeliverySession:
    """Manages a single delivery session with full telemetry and analytics."""
    def __init__(self, delivery_id, fleet_ids, source_hub, dest_hub, frontend_fleet_id=None, frontend_fleet_name=None):
        self.delivery_id = delivery_id
        self.fleet_ids = fleet_ids  # List of fleets (truck IDs) participating
        self.source_hub = source_hub
        self.dest_hub = dest_hub
        self.frontend_fleet_id = frontend_fleet_id  # Frontend fleet identifier (alpha, bravo, charlie)
        self.frontend_fleet_name = frontend_fleet_name  # Display name (Fleet Alpha, etc.)
        self.start_time = time.time()
        self.end_time = None
        self.status = "active"  # active, completed
        
        # SNAPSHOT routes at delivery creation so report matches transit
        self.route_snapshot = {}  # Fleet -> {standard, safe, using_safe at snapshot}
        for fleet_id in fleet_ids:
            if fleet_id in fleets:
                sim = fleets[fleet_id]
                self.route_snapshot[fleet_id] = {
                    "standard": list(sim.current_route),  # Deep copy
                    "safe": list(sim.safe_route) if sim.safe_route else [],
                    "using_safe_at_creation": sim.using_safe_route
                }
        
        # Telemetry collection
        self.telemetry_log = defaultdict(list)  # fleet_id -> list of points
        self.jerk_events = defaultdict(list)    # fleet_id -> list of jerk events
        self.diversions = defaultdict(list)     # fleet_id -> list of route changes
        
        # Known anomalies encountered
        self.anomalies_detected = {}  # location -> set of affected fleet_ids
        
        # Delivery lifecycle tracking
        self.completion_triggered = False  # Prevent multiple completions
        self.cached_analytics = None  # Lazy cache for analytics report
        
    def record_telemetry(self, fleet_id, point):
        """Record a telemetry point from a fleet."""
        self.telemetry_log[fleet_id].append(point)
        
        # Detect jerks (rashness_score > 7)
        if point.get("rashness_score", 0) > 7:
            jerk_event = {
                "timestamp": point["timestamp"],
                "position": [point["lat"], point["lon"]],
                "rashness": point["rashness_score"],
                "event": point["event"],
                "accel_z": point.get("accelex_z", 0),
                "anomaly_type": point.get("anomaly_type")  # Track if known or discovered
            }
            self.jerk_events[fleet_id].append(jerk_event)
    
    def record_route_change(self, fleet_id, reason):
        """Record when a fleet switches to safe route."""
        self.diversions[fleet_id].append({
            "timestamp": datetime.now().isoformat(),
            "reason": reason
        })
    
    def complete(self):
        """Mark delivery as complete and generate analytics immediately."""
        if self.completion_triggered:
            return  # Prevent double-completion
        
        self.end_time = time.time()
        self.status = "completed"
        self.completion_triggered = True
        
        # Generate analytics immediately (don't wait for lazy computation)
        self.cached_analytics = self.get_analytics()
        print(f"✅ Analytics generated immediately for delivery {self.delivery_id}")
    
    def get_analytics(self):
        """
        Compute comprehensive analytics for the delivery using SNAPSHOT routes.
        
        Returns:
        - jerk_analysis: Infrastructure vs driver attribution
        - driver_scores: Performance score per driver
        - route_summary: Paths taken, deviations
        - anomaly_report: Infrastructure issues encountered
        """
        analytics = {
            "delivery_id": self.delivery_id,
            "source": self.source_hub,
            "destination": self.dest_hub,
            "duration_seconds": self.end_time - self.start_time if self.end_time else None,
            "status": self.status,
            "fleets_involved": self.fleet_ids,
        }
        
        # ===== JERK ANALYSIS WITH DISTANCE-BASED CLUSTERING =====
        # Group jerks by proximity (within 150 meters) to detect infrastructure issues
        jerk_clusters = []  # List of clusters: {position, fleets, events}
        assigned = set()  # Track which jerks are already clustered
        
        all_jerks = []
        for fleet_id, jerks in self.jerk_events.items():
            for jerk in jerks:
                all_jerks.append({"fleet_id": fleet_id, "jerk": jerk})
        
        for i, item in enumerate(all_jerks):
            if i in assigned:
                continue
            
            cluster = {
                "position": item["jerk"]["position"],
                "fleets": {item["fleet_id"]},
                "events": [{"fleet": item["fleet_id"], "jerk": item["jerk"]}]
            }
            assigned.add(i)
            
            # Find other jerks within 150 meters
            for j, other_item in enumerate(all_jerks):
                if j <= i or j in assigned:
                    continue
                
                dist = haversine(item["jerk"]["position"], other_item["jerk"]["position"])
                if dist < 150:  # Within 150 meters = likely infrastructure
                    cluster["fleets"].add(other_item["fleet_id"])
                    cluster["events"].append({"fleet": other_item["fleet_id"], "jerk": other_item["jerk"]})
                    assigned.add(j)
            
            jerk_clusters.append(cluster)
        
        # Classify clusters as infrastructure vs driver behavior
        infrastructure_jerks = {}
        driver_jerks = defaultdict(list)
        
        for idx, cluster in enumerate(jerk_clusters):
            num_fleets = len(cluster["fleets"])
            
            # If multiple fleets felt it at same location → likely infrastructure
            if num_fleets > 1:
                cluster_key = (round(cluster["position"][0], 4), round(cluster["position"][1], 4))
                infrastructure_jerks[str(cluster_key)] = {
                    "location": cluster["position"],
                    "affected_fleets": list(cluster["fleets"]),
                    "jerk_count": len(cluster["events"]),
                    "attribution": "Infrastructure - Road Anomaly",
                    "events": cluster["events"],
                    "severity": "high" if len(cluster["events"]) > 3 else "medium"
                }
            else:
                # Single fleet → driver behavior
                fleet_id = list(cluster["fleets"])[0]
                driver_jerks[fleet_id].append({
                    "location": cluster["position"],
                    "jerk_count": len(cluster["events"]),
                    "attribution": "Driver Behavior",
                    "events": cluster["events"]
                })
        
        # ===== DRIVER SCORING =====
        driver_scores = {}
        all_driver_jerks = sum(len(jerks) for jerks in driver_jerks.values())
        
        for fleet_id in self.fleet_ids:
            profile = FLEET_PROFILES.get(fleet_id, {})
            driver_name = profile.get("driver", "Unknown")
            personality = profile.get("personality", "moderate")
            
            # Count jerks attributed to this driver
            driver_jerk_count = len(driver_jerks.get(fleet_id, []))
            
            # Base score
            base_score = 90 if personality == "safe" else 75 if personality == "moderate" else 60
            
            # Deduct for driver jerks (proportional to total)
            jerk_penalty = (driver_jerk_count / max(1, all_driver_jerks + 1)) * 25 if all_driver_jerks > 0 else 0
            final_score = max(0, base_score - jerk_penalty)
            
            driver_scores[fleet_id] = {
                "fleet_id": fleet_id,
                "driver": driver_name,
                "personality": personality,
                "score": round(final_score, 1),
                "driver_jerks": driver_jerk_count,
                "jerk_events": driver_jerks.get(fleet_id, [])
            }
        
        # ===== ROUTE SUMMARY (USE SNAPSHOT) =====
        routes_taken = {}
        for fleet_id in self.fleet_ids:
            snapshot = self.route_snapshot.get(fleet_id, {})
            routes_taken[fleet_id] = {
                "standard_route": snapshot.get("standard", []),
                "safe_route": snapshot.get("safe", []),
                "route_used": "safe" if snapshot.get("safe") else "standard",
                "diversions": len(self.diversions.get(fleet_id, []))
            }
        
        analytics["infrastructure_issues"] = infrastructure_jerks
        analytics["driver_scores"] = driver_scores
        analytics["routes"] = routes_taken
        analytics["total_infrastructure_jerks"] = sum(
            len(data["events"]) for data in infrastructure_jerks.values()
        )
        
        # ===== ADD PER-FLEET BREAKDOWNS =====
        per_fleet = {}
        for fleet_id in self.fleet_ids:
            profile = FLEET_PROFILES.get(fleet_id, {})
            fleet_jerks = self.jerk_events.get(fleet_id, [])
            fleet_telemetry = self.telemetry_log.get(fleet_id, [])
            
            # Count jerks for this fleet
            fleet_jerk_count = len(fleet_jerks)
            
            # Determine if jerks are infra or driver behavior
            jerk_type = "infrastructure" if any(
                fleet_id in infra["affected_fleets"] 
                for infra in infrastructure_jerks.values()
            ) else "driver_behavior" if fleet_jerk_count > 0 else "none"
            
            # Calculate score
            base_score = 90 if profile.get("personality") == "safe" else 70
            score = max(0, base_score - (fleet_jerk_count * 2))
            
            per_fleet[fleet_id] = {
                "fleet_id": fleet_id,
                "driver": profile.get("driver", "Unknown"),
                "personality": profile.get("personality", "moderate"),
                "cargo": profile.get("cargo", "Unknown"),
                "total_jerks": fleet_jerk_count,
                "jerk_type": jerk_type,
                "jerk_events": fleet_jerks,
                "telemetry_points": len(fleet_telemetry),
                "score": round(score, 1),
                "status": "✓ SAFE" if score > 80 else "⚠ CAUTION" if score > 60 else "✗ CRITICAL"
            }
        
        analytics["per_fleet"] = per_fleet
        
        return analytics

# Active delivery sessions
DELIVERY_SESSIONS = {}  # delivery_id -> DeliverySession
CURRENT_DELIVERY_ID = None
FLEET_COMPLETION_TRACKER = {}  # fleet_id -> {completed_at, delivery_id}
USER_FLEETS = {}  # user_fleet_id -> {fleet_name, trucks, source_hub, dest_hub}


# ========================== FLEET INITIALIZATION ==========================
print("🚚 Initializing intelligent fleet simulator...")
print(f"   - {len(FLEET_PROFILES)} fleets with distinct personalities")
print(f"   - {len(ANOMALIES)} known infrastructure hazards")
print(f"   - Dynamic route calculation enabled")

# Initialize fleet simulators with dynamic routing
fleets = {}
for fleet_id, profile in FLEET_PROFILES.items():
    route_info = FLEET_ROUTES[fleet_id]
    start = ROUTE_HUBS[route_info["source"]]
    end = ROUTE_HUBS[route_info["dest"]]
    fleets[fleet_id] = FleetSimulator(fleet_id, profile, start, end)
    print(f"   ✓ {fleet_id}: {profile['driver']} ({profile['personality']})")

print("✅ Fleet simulator ready!\n")


# ========================== API ENDPOINTS ==========================

@app.route('/routes', methods=['GET'])
def get_routes():
    """Get all fleet routes and timing info."""
    routes_data = {}
    for fleet_id, simulator in fleets.items():
        routes_data[fleet_id] = {
            "standard": simulator.current_route,
            "safe": simulator.safe_route or [],  # Empty until requested
            "using_safe": simulator.using_safe_route
        }
    
    return jsonify({
        "routes": routes_data,
        "start_time": START_TIME,
        "duration": TRIP_DURATION_SEC
    })


@app.route('/data', methods=['GET'])
def get_data():
    """Get live telemetry from all fleets."""
    global CURRENT_DELIVERY_ID
    
    # Use current delivery's start time, not global START_TIME
    if CURRENT_DELIVERY_ID and CURRENT_DELIVERY_ID in DELIVERY_SESSIONS:
        session = DELIVERY_SESSIONS[CURRENT_DELIVERY_ID]
        elapsed = time.time() - session.start_time
    else:
        # Fallback if no active delivery (shouldn't happen in normal operation)
        elapsed = time.time() - START_TIME
    
    progress = (elapsed / TRIP_DURATION_SEC) * 100
    progress = min(progress, 100)  # Clamp at 100, don't loop
    
    response_data = {}
    for fleet_id, simulator in fleets.items():
        point = simulator.generate_tick(progress)
        response_data[fleet_id] = {
            "current_data": point,
            "history": simulator.history,
            "progress": progress,  # Include progress for each fleet
            "arrived": progress >= 100  # Whether this fleet reached destination
        }
        
        # FIXED: Record telemetry for ALL active deliveries (not just CURRENT_DELIVERY_ID)
        # This ensures background fleets get telemetry even when not viewing them
        for delivery_id, session in DELIVERY_SESSIONS.items():
            if session.status == "active" and fleet_id in session.fleet_ids:
                session.record_telemetry(fleet_id, point)
    
    # Primary fleet for backward compatibility (frontend now uses all_fleets)
    primary_fleet = "T-102"
    
    # Check if we have data, handle empty fleets gracefully
    if not response_data:
        print(f"WARNING: No fleets in response_data. Fleets dict size: {len(fleets)}")
        return jsonify({
            "mode": "Intelligent Fleet Simulator",
            "timestamp": time.time(),
            "progress_pct": 0,
            "primary_fleet": primary_fleet,
            "delivery_id": CURRENT_DELIVERY_ID,
            "error": "No fleets initialized",
            "all_fleets": {}
        }), 500
    
    return jsonify({
        "mode": "Intelligent Fleet Simulator",
        "timestamp": time.time(),
        "progress_pct": progress,
        "primary_fleet": primary_fleet,
        "delivery_id": CURRENT_DELIVERY_ID,
        "event": response_data[primary_fleet]["current_data"]["event"],
        "current_data": response_data[primary_fleet]["current_data"],
        "history": response_data[primary_fleet]["history"],
        "all_fleets": response_data
    })


@app.route('/delivery/<delivery_id>/data', methods=['GET'])
def get_delivery_data(delivery_id):
    """Get live telemetry for a specific delivery's fleets."""
    if delivery_id not in DELIVERY_SESSIONS:
        return jsonify({"error": "Delivery not found"}), 404
    
    session = DELIVERY_SESSIONS[delivery_id]
    
    # Use this delivery's start time
    elapsed = time.time() - session.start_time
    progress = (elapsed / TRIP_DURATION_SEC) * 100
    progress = min(progress, 100)  # Clamp at 100
    
    response_data = {}
    for fleet_id, simulator in fleets.items():
        # Only include data for fleets in this delivery
        if fleet_id not in session.fleet_ids:
            continue
            
        point = simulator.generate_tick(progress)
        response_data[fleet_id] = {
            "current_data": point,
            "history": simulator.history,
            "progress": progress,
            "arrived": progress >= 100
        }
        
        # Record in this delivery session
        if session.status == "active":
            session.record_telemetry(fleet_id, point)
    
    primary_fleet = session.fleet_ids[0] if session.fleet_ids else "T-102"
    primary_data = response_data.get(primary_fleet, {})
    
    return jsonify({
        "mode": "Intelligent Fleet Simulator",
        "timestamp": time.time(),
        "progress_pct": progress,
        "primary_fleet": primary_fleet,
        "delivery_id": delivery_id,
        "delivery_status": session.status,
        "event": primary_data.get("current_data", {}).get("event", "Normal"),
        "current_data": primary_data.get("current_data", {}),
        "history": primary_data.get("history", []),
        "all_fleets": response_data
    })


@app.route('/safe-route', methods=['POST'])
def request_safe_route():
    """
    Request a safe route for a specific fleet from their current position.
    
    Request body:
    {
        "fleet_id": "T-102",
        "current_progress_pct": 30.5,
        "enable": true/false
    }
    """
    data = request.get_json()
    fleet_id = data.get("fleet_id", "T-102")
    current_progress = data.get("current_progress_pct", 0)
    enable = data.get("enable", True)
    
    if fleet_id not in fleets:
        return jsonify({"error": "Fleet not found"}), 404
    
    simulator = fleets[fleet_id]
    
    if enable:
        # Calculate safe route from current position
        current_pos = simulator.get_current_position(current_progress)
        
        # Get safe route to destination
        simulator.safe_route = fetch_osrm_route(
            current_pos[0], current_pos[1],
            simulator.end_pos[0], simulator.end_pos[1],
            f"safe_{fleet_id}"
        )
        simulator.using_safe_route = True
        
        return jsonify({
            "status": "success",
            "fleet_id": fleet_id,
            "message": f"Safe route activated for {fleet_id}",
            "safe_route": simulator.safe_route,
            "current_position": current_pos
        })
    else:
        # Disable safe route
        simulator.using_safe_route = False
        
        return jsonify({
            "status": "success",
            "fleet_id": fleet_id,
            "message": f"Safe route deactivated for {fleet_id}",
            "using_safe_route": False
        })


@app.route('/fleet-info', methods=['GET'])
def get_fleet_info():
    """Get information about all fleets and their current state."""
    fleet_list = []
    for fleet_id, simulator in fleets.items():
        elapsed = time.time() - START_TIME
        progress = (elapsed / TRIP_DURATION_SEC) * 100
        progress = progress % 100
        
        current_pos = simulator.get_current_position(progress)
        
        fleet_list.append({
            "id": fleet_id,
            "driver": simulator.profile["driver"],
            "cargo": simulator.profile["cargo"],
            "personality": simulator.profile["personality"],
            "current_position": current_pos,
            "progress_pct": progress,
            "using_safe_route": simulator.using_safe_route,
            "rashness_tendency": simulator.profile["rashness_base"]
        })
    
    return jsonify({"fleets": fleet_list})


@app.route('/deliveries/status-all', methods=['GET'])
def deliveries_status_all():
    """
    Get status of ALL deliveries (active + completed) with real-time progress.
    ALSO records fresh telemetry for all active fleets (ensures background fleets get data).
    Frontend polls this once per second to monitor all fleets in parallel.
    """
    
    cleanup_old_deliveries(max_completed=20)

    active_deliveries = []
    completed_deliveries = []
    
    for delivery_id, session in list(DELIVERY_SESSIONS.items()):
        # Calculate progress for this delivery
        elapsed = time.time() - session.start_time
        progress = min((elapsed / TRIP_DURATION_SEC) * 100, 100)
        
        # FIRST: Record fresh telemetry for all fleets in this delivery
        # This ensures background fleets get data even if not being viewed
        if session.status == "active":
            for fleet_id in session.fleet_ids:
                if fleet_id in fleets:
                    point = fleets[fleet_id].generate_tick(progress)
                    session.record_telemetry(fleet_id, point)
        
        delivery_info = {
            "delivery_id": delivery_id,
            "status": session.status,
            "progress": progress,
            "fleet_ids": session.fleet_ids,
            "frontend_fleet_id": session.frontend_fleet_id,
            "frontend_fleet_name": session.frontend_fleet_name,
            "source_hub": session.source_hub,
            "dest_hub": session.dest_hub,
            "start_time": session.start_time,
            "end_time": session.end_time,
        }
        
        # THEN: Get latest telemetry from the session (includes what we just recorded)
        fleet_telemetry = {}
        for fleet_id in session.fleet_ids:
            if session.telemetry_log[fleet_id]:
                latest = session.telemetry_log[fleet_id][-1]
                fleet_telemetry[fleet_id] = {
                    "rashness_score": latest.get("rashness_score", 0),
                    "event": latest.get("event", "Normal"),
                    "position": [latest.get("lat", 0), latest.get("lon", 0)],
                }
        delivery_info["fleet_telemetry"] = fleet_telemetry
        
        if session.status == "active":
            active_deliveries.append(delivery_info)
            
            # Auto-complete if reached 100% and not already completed
            if progress >= 100 and not session.completion_triggered:
                session.complete()
                delivery_info["status"] = "completed"
                completed_deliveries.append(delivery_info)
                active_deliveries.pop()  # Remove from active
                print(f"✅ Auto-completed delivery {delivery_id} via status endpoint")

                config = next((c for c in FRONTEND_FLEETS if c["fleet_id"] == session.frontend_fleet_id), None)
                if config:
                    new_id = str(uuid.uuid4())[:8]
                    new_session = DeliverySession(
                        new_id, config["trucks"], config["source"], 
                        config["dest"], config["fleet_id"], config["fleet_name"]
                    )
                    DELIVERY_SESSIONS[new_id] = new_session
                    print(f"🔄 INFINITE LOOP: Respawned {config['fleet_name']} -> {new_id}")
        else:
            completed_deliveries.append(delivery_info)
    
    return jsonify({
        "active_deliveries": active_deliveries,
        "completed_deliveries": completed_deliveries,
        "total_active": len(active_deliveries),
        "total_completed": len(completed_deliveries),
        "timestamp": time.time()
    })


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({
        "status": "healthy",
        "fleets_active": len(fleets),
        "uptime_sec": time.time() - START_TIME
    })


# ========================== DELIVERY MANAGEMENT ENDPOINTS ==========================

@app.route('/delivery/create', methods=['POST'])
def create_delivery():
    """Start a new delivery session."""
    global CURRENT_DELIVERY_ID
    data = request.get_json()
    fleet_ids = data.get("fleet_ids", list(fleets.keys()))
    source_hub = data.get("source_hub", "HUB_A")
    dest_hub = data.get("dest_hub", "HUB_B")
    frontend_fleet_id = data.get("fleet_id")  # Frontend fleet ID (alpha, bravo, etc.)
    frontend_fleet_name = data.get("fleet_name")  # Frontend fleet name (Fleet Alpha, etc.)
    
    delivery_id = str(uuid.uuid4())[:8]
    session = DeliverySession(delivery_id, fleet_ids, source_hub, dest_hub, frontend_fleet_id, frontend_fleet_name)
    DELIVERY_SESSIONS[delivery_id] = session
    CURRENT_DELIVERY_ID = delivery_id
    
    return jsonify({
        "status": "success",
        "delivery_id": delivery_id,
        "fleet_ids": fleet_ids,
        "frontend_fleet_id": frontend_fleet_id,
        "frontend_fleet_name": frontend_fleet_name,
        "source": source_hub,
        "destination": dest_hub,
        "start_time": session.start_time
    })


@app.route('/fleet/register', methods=['POST'])
def register_user_fleet():
    """
    Register a new user-created fleet for centralized tracking.
    Creates synthetic profiles for trucks and stores fleet config.
    """
    data = request.get_json()
    fleet_id = data.get("fleet_id")
    fleet_name = data.get("fleet_name")
    source_hub = data.get("source_hub", "HUB_A")
    dest_hub = data.get("dest_hub", "HUB_B")
    num_trucks = data.get("number_of_trucks", 2)
    cargo_type = data.get("cargo_type", "General")
    
    if not fleet_id or not fleet_name:
        return jsonify({"error": "fleet_id and fleet_name required"}), 400
    
    if source_hub == dest_hub:
        return jsonify({"error": "source_hub and dest_hub must be different"}), 400
    
    # Generate synthetic truck profiles for this fleet
    truck_ids = []
    personalities = ["safe", "moderate", "rash"]  # Mix of personalities
    
    for i in range(num_trucks):
        truck_id = f"{fleet_id}-{str(i+1).zfill(3)}"
        truck_ids.append(truck_id)
        
        # Assign personality (round-robin)
        personality = personalities[i % len(personalities)]
        
        # Generate synthetic profile matching personality
        if personality == "safe":
            profile = {
                "driver": f"Driver {i+1}",
                "cargo": cargo_type,
                "personality": "safe",
                "rashness_base": random.uniform(1.0, 2.5),
                "reaction_time": random.uniform(0.75, 0.95),
                "speed_variance": random.uniform(0.2, 0.4),
            }
        elif personality == "moderate":
            profile = {
                "driver": f"Driver {i+1}",
                "cargo": cargo_type,
                "personality": "moderate",
                "rashness_base": random.uniform(3.0, 4.5),
                "reaction_time": random.uniform(0.5, 0.7),
                "speed_variance": random.uniform(0.4, 0.8),
            }
        else:  # rash
            profile = {
                "driver": f"Driver {i+1}",
                "cargo": cargo_type,
                "personality": "rash",
                "rashness_base": random.uniform(7.0, 9.0),
                "reaction_time": random.uniform(0.25, 0.45),
                "speed_variance": random.uniform(1.0, 2.0),
            }
        
        FLEET_PROFILES[truck_id] = profile
        start_pos = ROUTE_HUBS.get(source_hub, ROUTE_HUBS["HUB_A"])
        end_pos = ROUTE_HUBS.get(dest_hub, ROUTE_HUBS["HUB_B"])
        fleets[truck_id] = FleetSimulator(truck_id, profile, start_pos, end_pos)
    # Store fleet config
    USER_FLEETS[fleet_id] = {
        "fleet_name": fleet_name,
        "trucks": truck_ids,
        "source": source_hub,
        "dest": dest_hub,
        "cargo_type": cargo_type,
        "num_trucks": num_trucks,
        "created_at": time.time(),
    }
    
    return jsonify({
        "status": "success",
        "fleet_id": fleet_id,
        "fleet_name": fleet_name,
        "truck_ids": truck_ids,
        "message": f"Fleet {fleet_name} registered with {num_trucks} trucks"
    })


@app.route('/deliveries/auto-start', methods=['POST'])
def auto_start_deliveries():
    """
    Auto-create delivery sessions for all frontend fleets (alpha, bravo, charlie).
    Safe to call repeatedly - only creates deliveries that don't exist yet.
    Ensures telemetry recording starts immediately when app loads.
    """
    created_deliveries = []
    
    for fleet_config in FRONTEND_FLEETS:
        # Check if this fleet already has an active delivery
        has_active = any(
            s.frontend_fleet_id == fleet_config["fleet_id"] and s.status == "active"
            for s in DELIVERY_SESSIONS.values()
        )
        
        if not has_active:
            delivery_id = str(uuid.uuid4())[:8]
            session = DeliverySession(
                delivery_id,
                fleet_config["trucks"],
                fleet_config["source"],
                fleet_config["dest"],
                fleet_config["fleet_id"],
                fleet_config["fleet_name"]
            )
            DELIVERY_SESSIONS[delivery_id] = session
            created_deliveries.append({
                "delivery_id": delivery_id,
                "fleet_name": fleet_config["fleet_name"]
            })
            print(f"🚀 Started delivery for {fleet_config['fleet_name']}: {delivery_id}")
    
    return jsonify({"status": "success", "created": len(created_deliveries)})


@app.route('/delivery/<delivery_id>/status', methods=['GET'])
def delivery_status(delivery_id):
    """Get current delivery session status."""
    if delivery_id not in DELIVERY_SESSIONS:
        return jsonify({"error": "Delivery not found"}), 404
    
    session = DELIVERY_SESSIONS[delivery_id]
    elapsed = DELIVERY_SESSIONS[delivery_id].end_time - session.start_time if session.end_time else time.time() - session.start_time
    
    return jsonify({
        "delivery_id": delivery_id,
        "status": session.status,
        "duration_sec": elapsed,
        "fleets": session.fleet_ids,
        "jerk_events_count": sum(len(jerks) for jerks in session.jerk_events.values()),
        "diversions_count": sum(len(divs) for divs in session.diversions.values())
    })


@app.route('/delivery/<delivery_id>/check-completion', methods=['GET'])
def check_delivery_completion(delivery_id):
    """Check if delivery can be completed (all fleets reached destination)."""
    if delivery_id not in DELIVERY_SESSIONS:
        return jsonify({"error": "Delivery not found"}), 404
    
    session = DELIVERY_SESSIONS[delivery_id]
    
    # Use this delivery's start time, not global START_TIME
    elapsed = time.time() - session.start_time
    progress = min((elapsed / TRIP_DURATION_SEC) * 100, 100)
    
    # Check each fleet
    fleet_status = {}
    all_arrived = True
    
    for fleet_id in session.fleet_ids:
        if fleet_id not in fleets:
            fleet_status[fleet_id] = {"progress": 0, "arrived": False}
            all_arrived = False
            continue
        
        # All trucks in this delivery follow same progress
        fleet_status[fleet_id] = {
            "progress": progress,
            "arrived": progress >= 100
        }
        
        if progress < 100:
            all_arrived = False
    
    # Auto-complete if all arrived and session is still active
    if all_arrived and session.status == "active" and not session.completion_triggered:
        session.complete()
        print(f"✅ Auto-completed delivery {delivery_id} (all trucks arrived)")

        config = next((c for c in FRONTEND_FLEETS if c["fleet_id"] == session.frontend_fleet_id), None)
        if config:
            new_id = str(uuid.uuid4())[:8]
            new_session = DeliverySession(
                new_id, config["trucks"], config["source"], 
                config["dest"], config["fleet_id"], config["fleet_name"]
            )
            DELIVERY_SESSIONS[new_id] = new_session
            print(f"🔄 INFINITE LOOP: Respawned {config['fleet_name']} -> {new_id} via dashboard check")
    
    return jsonify({
        "delivery_id": delivery_id,
        "status": session.status,
        "progress": progress,
        "fleet_status": fleet_status,
        "all_fleets_arrived": all_arrived,
        "can_complete": all_arrived and session.status == "active"
    })


@app.route('/delivery/<delivery_id>/complete', methods=['POST'])
def complete_delivery(delivery_id):
    """Mark delivery as complete and prepare analytics."""
    global CURRENT_DELIVERY_ID
    
    if delivery_id not in DELIVERY_SESSIONS:
        return jsonify({"error": "Delivery not found"}), 404
    
    session = DELIVERY_SESSIONS[delivery_id]
    session.complete()
    
    if CURRENT_DELIVERY_ID == delivery_id:
        CURRENT_DELIVERY_ID = None
    
    return jsonify({
        "status": "success",
        "delivery_id": delivery_id,
        "completed_at": datetime.now().isoformat(),
        "duration_sec": session.end_time - session.start_time,
        "message": "Delivery completed. Analytics ready."
    })


@app.route('/delivery/<delivery_id>/analytics', methods=['GET'])
def delivery_analytics(delivery_id):
    """Get comprehensive analytics for a completed delivery."""
    if delivery_id not in DELIVERY_SESSIONS:
        return jsonify({"error": "Delivery not found"}), 404
    
    session = DELIVERY_SESSIONS[delivery_id]
    
    if session.status != "completed":
        return jsonify({"error": "Delivery not completed yet"}), 400
    
    # Return cached analytics (generated immediately on completion, not lazy)
    if session.cached_analytics is None:
        session.cached_analytics = session.get_analytics()  # Fallback if not cached
    
    return jsonify(session.cached_analytics)


@app.route('/deliveries/completed', methods=['GET'])
def list_completed_deliveries():
    """List all completed deliveries with summary info, organized by frontend fleet."""
    completed = []
    
    for delivery_id, session in DELIVERY_SESSIONS.items():
        if session.status == "completed":
            analytics = session.get_analytics()
            
            # Calculate per-fleet stats
            per_fleet_data = analytics.get("per_fleet", {})
            
            # If this delivery is for a specific frontend fleet, create one entry per fleet
            if session.frontend_fleet_id:
                # Calculate stats for only this frontend fleet's trucks
                fleet_trucks = session.fleet_ids  # These are the truck IDs in this delivery
                fleet_jerks = sum(len(per_fleet_data.get(tid, {}).get("jerk_events", [])) for tid in fleet_trucks)
                fleet_score = sum(per_fleet_data.get(tid, {}).get("score", 0) for tid in fleet_trucks) / max(1, len(fleet_trucks))
                
                completed.append({
                    "delivery_id": delivery_id,
                    "frontend_fleet_id": session.frontend_fleet_id,
                    "frontend_fleet_name": session.frontend_fleet_name,
                    "trucks_involved": session.fleet_ids,
                    "duration_seconds": int(session.end_time - session.start_time) if session.end_time else 0,
                    "completed_at": session.end_time,
                    "source_hub": session.source_hub,
                    "dest_hub": session.dest_hub,
                    "total_jerks": fleet_jerks + analytics.get("total_infrastructure_jerks", 0),
                    "average_score": round(fleet_score, 1),
                    "status": "completed"
                })
            else:
                # Fallback for old deliveries without frontend fleet info
                completed.append({
                    "delivery_id": delivery_id,
                    "fleets_involved": session.fleet_ids,
                    "duration_seconds": int(session.end_time - session.start_time) if session.end_time else 0,
                    "completed_at": session.end_time,
                    "source_hub": session.source_hub,
                    "dest_hub": session.dest_hub,
                    "total_jerks": analytics.get("total_infrastructure_jerks", 0) + 
                                  sum(len(fleet.get("jerk_events", [])) for fleet in per_fleet_data.values()),
                    "average_score": round(
                        sum(f.get("score", 0) for f in per_fleet_data.values()) / 
                        max(1, len(per_fleet_data)), 1
                    )
                })
    
    return jsonify({
        "completed_deliveries": sorted(completed, key=lambda x: x.get("completed_at", 0), reverse=True),
        "total_completed": len(completed)
    })


@app.route('/delivery/<delivery_id>/routes', methods=['GET'])
def delivery_routes(delivery_id):
    """Get route details for a delivery (from snapshot, not current state)."""
    if delivery_id not in DELIVERY_SESSIONS:
        return jsonify({"error": "Delivery not found"}), 404
    
    session = DELIVERY_SESSIONS[delivery_id]
    routes = {}
    
    for fleet_id in session.fleet_ids:
        snapshot = session.route_snapshot.get(fleet_id, {})
        routes[fleet_id] = {
            "standard": snapshot.get("standard", []),
            "safe": snapshot.get("safe", []),
            "using_safe": snapshot.get("using_safe_at_creation", False),
            "source": ROUTE_HUBS.get(session.source_hub),
            "destination": ROUTE_HUBS.get(session.dest_hub)
        }
    
    return jsonify({
        "delivery_id": delivery_id,
        "source_hub": session.source_hub,
        "dest_hub": session.dest_hub,
        "routes": routes,
        "known_anomalies": ANOMALIES
    })


# ========================== CUSTOM JER DATA INJECTION ENDPOINTS ==========================

@app.route('/jerk-data/upload', methods=['POST'])
def upload_jerk_data():
    """
    Upload custom rash jerk data for a fleet.
    
    Request body:
    {
        "fleet_id": "T-205",
        "jerk_data": [
            {"accelex_x": 1.2, "accelex_y": 0.5, "accelex_z": 3.5, "gyro_z": 15.0, "rashness_score": 8.5, "event": "Rash Behavior"},
            ...500 rows of 5-second duration...
        ]
    }
    """
    try:
        data = request.get_json()
        fleet_id = data.get("fleet_id")
        jerk_data = data.get("jerk_data", [])
        
        if not fleet_id or not jerk_data:
            return jsonify({"error": "Missing fleet_id or jerk_data"}), 400
        
        if fleet_id not in FLEET_PROFILES:
            return jsonify({"error": f"Fleet {fleet_id} not found"}), 404
        
        # Store the custom jerk data
        RASH_JERK_DATA[fleet_id] = jerk_data
        CUSTOM_JERK_INDEX[fleet_id] = 0  # Reset index
        
        # Reset the generator's custom jerk index for this fleet
        if fleet_id in fleets:
            fleets[fleet_id].telemetry_gen.custom_jerk_index = 0
        
        return jsonify({
            "status": "success",
            "fleet_id": fleet_id,
            "rows_imported": len(jerk_data),
            "message": f"Imported {len(jerk_data)} rows of custom jerk data for {fleet_id}"
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/jerk-data/status', methods=['GET'])
def jerk_data_status():
    """Get status of custom jerk data for all fleets."""
    status = {}
    for fleet_id, rows in RASH_JERK_DATA.items():
        status[fleet_id] = {
            "rows_available": len(rows),
            "rows_used": CUSTOM_JERK_INDEX.get(fleet_id, 0)
        }
    
    all_fleets = {}
    for fleet_id in FLEET_PROFILES.keys():
        all_fleets[fleet_id] = status.get(fleet_id, {"rows_available": 0, "rows_used": 0})
    
    return jsonify(all_fleets)


if __name__ == '__main__':
    app.run(debug=True, port=5000, threaded=True)