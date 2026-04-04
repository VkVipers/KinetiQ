#!/usr/bin/env python3
"""
Helper script to inject custom rash jerk data into the delivery system.
Extracts rash driving segments from your CSV and uploads them.

Usage:
    python3 inject_jerk_data.py
"""

import pandas as pd
import requests
import json
import sys

# Configuration
CSV_FILE = "df_datasetRashdrivesIMU.csv"
BACKEND_URL = "http://127.0.0.1:5000"
RASH_FLEETS = ["F-205", "F-101"]  # Rash drivers
ROWS_PER_FLEET = 500  # 5 seconds at 100 Hz


def calculate_rashness_score(accele_x, accele_y, gyro_z, label):
    """
    Calculate rashness score (0-10) from acceleration magnitudes and label.
    Higher acceleration + aggressive maneuvers = higher rashness.
    """
    # Calculate lateral acceleration magnitude
    lateral_accel = (abs(accele_x) + abs(accele_y)) / 2.0
    
    # Calculate angular velocity magnitude
    angular_vel = abs(gyro_z)
    
    # Base score from acceleration
    accel_score = min(10.0, lateral_accel * 15.0)  # Scale to 0-10
    
    # Boost for aggressive maneuvers
    label_lower = str(label).lower() if label else "normal"
    aggressive_labels = ['brakes', 'corner', 'u-turn', 'sshape']
    is_aggressive = any(agg in label_lower for agg in aggressive_labels)
    
    if is_aggressive:
        accel_score = min(10.0, accel_score + 2.0)  # +2 boost for aggressive maneuvers
    
    return min(10.0, max(0.0, accel_score))


def get_event_from_label(label):
    """Convert label to human-readable event."""
    label_lower = str(label).lower() if label else "normal"
    
    if 'brake' in label_lower:
        return "Hard Braking"
    elif 'corner' in label_lower:
        return "Aggressive Corner"
    elif 'u-turn' in label_lower:
        return "Sharp U-Turn"
    elif 'sshape' in label_lower:
        return "S-Shaped Maneuver"
    elif 'f-lane' in label_lower:
        return "Lane Change"
    else:
        return str(label) if label else "Normal Driving"


def extract_rash_data(csv_path: str, fleet_id: str, num_rows: int = 500):
    """
    Extract rash driving data from CSV.
    Looks for aggressive maneuvers: brakes, corners, u-turns, S-shapes.
    Prioritizes highest rashness scores for most dramatic demo.
    """
    print(f"\n📖 Loading CSV: {csv_path}")
    try:
        df = pd.read_csv(csv_path)
    except FileNotFoundError:
        print(f"❌ CSV not found: {csv_path}")
        return None
    
    print(f"   Total rows: {len(df)}")
    print(f"   Columns: {', '.join(df.columns.tolist())}")
    
    # Calculate rashness score and event for each row
    print(f"\n📊 Calculating rashness scores...")
    df['calculated_rashness'] = df.apply(
        lambda row: calculate_rashness_score(
            row.get('accele_x', 0),
            row.get('accele_y', 0),
            row.get('gyro_z', 0),
            row.get('label', 'normal')
        ),
        axis=1
    )
    
    # Filter for rash segments (high calculated rashness OR aggressive labels)
    print(f"🔍 Finding rash driving segments...")
    aggressive_labels = ['brakes', 'corner', 'u-turn', 'sshape']
    label_mask = df['label'].str.lower().str.contains('|'.join(aggressive_labels), na=False)
    rashness_mask = df['calculated_rashness'] > 3.0  # Medium-high rashness
    rash_mask = label_mask | rashness_mask
    
    rash_data = df[rash_mask].reset_index(drop=True)
    
    print(f"   Rash rows found: {len(rash_data)}")
    print(f"   Rashness score range: {rash_data['calculated_rashness'].min():.2f} - {rash_data['calculated_rashness'].max():.2f}")
    
    if len(rash_data) < num_rows:
        print(f"   ⚠️  Only {len(rash_data)} rash rows available (need {num_rows})")
        print(f"   Using all available {len(rash_data)} rows")
        num_rows = len(rash_data)
    
    # Sort by rashness score (descending) and take top rows for most dramatic effect
    print(f"   Selecting top {num_rows} rows by rashness score...")
    selected_data = rash_data.nlargest(num_rows, 'calculated_rashness').reset_index(drop=True)
    
    # Convert to backend format
    jerk_data = []
    for idx, row in selected_data.iterrows():
        rashness = calculate_rashness_score(
            row['accele_x'],
            row['accele_y'],
            row['gyro_z'],
            row['label']
        )
        
        jerk_data.append({
            "accelex_x": float(row['accele_x']),
            "accelex_y": float(row['accele_y']),
            "accelex_z": abs(float(row['accele_x'])) + abs(float(row['accele_y'])),  # Magnitude
            "gyro_z": float(row['gyro_z']),
            "rashness_score": min(10.0, max(0.0, rashness)),
            "event": get_event_from_label(row['label'])
        })
    
    if not jerk_data:
        print(f"❌ No rash data extracted!")
        return None
    
    print(f"   ✓ Extracted {len(jerk_data)} data rows")
    print(f"   Rashness range: {min(d['rashness_score'] for d in jerk_data):.1f} - {max(d['rashness_score'] for d in jerk_data):.1f}")
    events = {}
    for d in jerk_data:
        event = d['event']
        events[event] = events.get(event, 0) + 1
    print(f"   Event distribution: {events}")
    
    return jerk_data


def upload_jerk_data(fleet_id: str, jerk_data: list, backend_url: str = BACKEND_URL):
    """Upload jerk data to backend."""
    print(f"\n📤 Uploading to {backend_url}/jerk-data/upload")
    
    try:
        response = requests.post(
            f"{backend_url}/jerk-data/upload",
            json={"fleet_id": fleet_id, "jerk_data": jerk_data},
            timeout=10
        )
        
        if response.status_code == 200:
            result = response.json()
            print(f"   ✓ Success!")
            print(f"   Fleet: {result['fleet_id']}")
            print(f"   Rows imported: {result['rows_imported']}")
            return True
        else:
            print(f"   ❌ Error: {response.status_code}")
            print(f"   {response.text}")
            return False
    except requests.ConnectionError:
        print(f"   ❌ Connection failed. Is backend running at {backend_url}?")
        return False
    except Exception as e:
        print(f"   ❌ Error: {e}")
        return False


def check_status(backend_url: str = BACKEND_URL):
    """Check current jerk data status."""
    print(f"\n📊 Checking jerk data status...")
    
    try:
        response = requests.get(f"{backend_url}/jerk-data/status", timeout=5)
        if response.status_code == 200:
            status = response.json()
            print(f"\n   Fleet ID         | Data Rows | Rows Used")
            print(f"   {'-'*45}")
            for fleet_id in sorted(status.keys()):
                available = status[fleet_id]["rows_available"]
                used = status[fleet_id]["rows_used"]
                marker = "✓" if available > 0 else " "
                print(f"   {marker} {fleet_id:16} | {available:9} | {used:9}")
            return status
        else:
            print(f"   ❌ Error: {response.status_code}")
            return None
    except requests.ConnectionError:
        print(f"   ❌ Connection failed. Is backend running?")
        return None
    except Exception as e:
        print(f"   ❌ Error: {e}")
        return None


def main():
    """Main workflow."""
    print("=" * 60)
    print("🚀 Jerk Data Injection Tool")
    print("=" * 60)
    
    print(f"\n⚙️  Configuration:")
    print(f"   CSV File: {CSV_FILE}")
    print(f"   Backend: {BACKEND_URL}")
    print(f"   Rash Fleets: {', '.join(RASH_FLEETS)}")
    print(f"   Rows per fleet: {ROWS_PER_FLEET}")
    
    # Check backend status first
    print(f"\n🔗 Checking backend connection...")
    try:
        response = requests.get(f"{BACKEND_URL}/health", timeout=5)
        if response.status_code == 200:
            print(f"   ✓ Backend is running")
        else:
            print(f"   ❌ Backend returned error: {response.status_code}")
            sys.exit(1)
    except requests.ConnectionError:
        print(f"   ❌ Cannot connect to backend at {BACKEND_URL}")
        print(f"   Please start backend: cd backend && python3 app.py")
        sys.exit(1)
    except Exception as e:
        print(f"   ❌ Error: {e}")
        sys.exit(1)
    
    # Check current status
    initial_status = check_status()
    
    # Extract and upload for each rash fleet
    success_count = 0
    for fleet_id in RASH_FLEETS:
        print(f"\n{'='*60}")
        print(f"Processing {fleet_id} (Rash Driver)")
        print(f"{'='*60}")
        
        jerk_data = extract_rash_data(CSV_FILE, fleet_id, ROWS_PER_FLEET)
        if jerk_data:
            if upload_jerk_data(fleet_id, jerk_data):
                success_count += 1
    
    # Final status check
    print(f"\n{'='*60}")
    print(f"Final Status")
    print(f"{'='*60}")
    final_status = check_status()
    
    # Summary
    print(f"\n✅ Summary:")
    print(f"   Successfully uploaded: {success_count}/{len(RASH_FLEETS)}")
    
    if success_count == len(RASH_FLEETS):
        print(f"\n🎉 Ready to demo!")
        print(f"   1. Keep backend running")
        print(f"   2. Start frontend: cd frontend && npm run dev")
        print(f"   3. Navigate to truck dashboard")
        print(f"   4. Watch rash drivers show jerks with real CSV data!")
    else:
        print(f"\n⚠️  Some uploads failed. Check errors above.")
    
    print(f"\n" + "=" * 60)


if __name__ == "__main__":
    main()
