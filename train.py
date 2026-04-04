#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════════════════════╗
║         KinetiQ  —  Context-Aware Fleet Intelligence System         ║
║              Complete ML Pipeline  |  DP World Hackathon            ║
╠══════════════════════════════════════════════════════════════════════╣
║  Research Foundation:                                               ║
║  [1] Hamdy et al.   — kNN + DTW        (road anomaly,  98.67%)      ║
║  [2] Mihoub et al.  — Road Scanner SVM (road quality,  88.05%)      ║
║  [3] Mishra et al.  — 1D CNN + ATW     (rash driving,  97.14%)      ║
╠══════════════════════════════════════════════════════════════════════╣
║  Dataset: df_datasetRashdrivesIMU  (~1M rows, 100 Hz)               ║
║    Columns: accele_x/y, accele_x/y_filtered, gyro_z_filtered        ║
╚══════════════════════════════════════════════════════════════════════╝

FIXES applied over the original:
  BUG-1  LeakyReLU(negative_slope=...)  → positional arg (TF 2.x compat)
  BUG-2  run_scoring_pipeline always returns (DataFrame, DataFrame) tuple
  BUG-3  load_real_dataset adds label_id, gps_lat, gps_lon
  BUG-4  Session IDs: split monotonic-time data into 120s chunks
  BUG-5  Real all-normal data: augmented with synthetic rash sessions
  BUG-6  pad_or_truncate: empty-array guard added
  BUG-7  ATW inner loop: boundary and NaN guards added
  BUG-8  compute_driver_trust_score: .fillna(0) on penalty map
  BUG-9  build_windows: normal-class windows included for 6-class CNN
  BUG-10 Output directory created before any file save
"""

import os
os.environ['TF_USE_LEGACY_KERAS'] = '1'

# ── Suppress verbose TF logs ───────────────────────────────────────────
import os, warnings
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
warnings.filterwarnings("ignore")

from tqdm import tqdm
from tqdm.keras import TqdmCallback

import numpy as np
import pandas as pd
from scipy.signal import butter, filtfilt
from scipy.stats import skew, kurtosis
from sklearn.neighbors import KNeighborsClassifier
from sklearn.svm import SVC
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split, StratifiedKFold
from sklearn.metrics import (classification_report, confusion_matrix,
                             accuracy_score, f1_score)
from sklearn.utils import resample
import tensorflow as tf
from tensorflow.keras import layers, Model, Input
from tensorflow.keras.callbacks import EarlyStopping, ReduceLROnPlateau
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
import seaborn as sns
from matplotlib.patches import Patch

tf.get_logger().setLevel("ERROR")

# ══════════════════════════════════════════════════════════════════════
#  SECTION 0 — GLOBAL CONFIG  (matches Paper 3 exactly)
# ══════════════════════════════════════════════════════════════════════
SAMPLING_RATE  = 100                         # Hz
ATW_WIN        = int(4.2 * SAMPLING_RATE)    # 420 samples  — Paper 3
ATW_STEP       = int(1.5 * SAMPLING_RATE)    # 150 samples  — Paper 3
ATW_MAX        = int(12  * SAMPLING_RATE)    # 1200 samples — Paper 3
ATW_SIGMA_X    = 0.4                         # m/s²  — Paper 3
ATW_SIGMA_Y    = 0.5                         # m/s²  — Paper 3
CNN_SEQ_LEN    = 1200                        # padded input length (12 s × 100 Hz)
CNN_EPOCHS     = 40
CNN_BATCH      = 32
STATIC_WIN_SEC = 10
STATIC_OVERLAP = 0.40

OUTPUT_DIR = "kinetiQ_outputs"               # all files go here

RASH_LABELS = {
    0: "Normal Driving",
    1: "Lane Weaving",
    2: "Lane Swerving",
    3: "Hard Braking",
    4: "Hard Cornering",
    5: "Quick U-Turn",
}
RASH_LABEL_INV = {v: k for k, v in RASH_LABELS.items()}

ROAD_LABELS = {0: "Smooth", 1: "Bumpy/Potholed"}

PENALTY = {                  # Driver trust score deductions
    "Lane Weaving":   8,
    "Lane Swerving":  10,
    "Hard Braking":   15,
    "Hard Cornering": 12,
    "Quick U-Turn":   20,
}

COLORS = ["#2ecc71", "#e74c3c", "#3498db", "#f39c12", "#9b59b6", "#1abc9c"]

print("=" * 68)
print("  KinetiQ  ·  Fleet Intelligence Pipeline  ·  Initialising …")
print("=" * 68)


# ══════════════════════════════════════════════════════════════════════
#  SECTION 1 — DATA LOADER  &  PREPROCESSING
# ══════════════════════════════════════════════════════════════════════

def butterworth_lowpass(signal: np.ndarray, cutoff: float = 1.3,
                        fs: float = SAMPLING_RATE,
                        order: int = 5) -> np.ndarray:
    """Low-pass Butterworth filter — identical to Paper 3 settings."""
    nyq = 0.5 * fs
    b, a = butter(order, cutoff / nyq, btype="low")
    return filtfilt(b, a, signal, axis=0)


def load_real_dataset(path: str) -> pd.DataFrame:
    """
    Load the actual IMU dataset.
    FIX-3: Adds label_id, gps_lat, gps_lon if missing.
    FIX-4: Handled in __main__ (session splitting).
    """
    df = pd.read_csv(path)

    # ── Normalise seconds_elapsed ──────────────────────────────────────
    if "seconds_elapsed" not in df.columns:
        # Try common alternatives
        for alt in ["seconds_e", "time_s", "elapsed"]:
            if alt in df.columns:
                df.rename(columns={alt: "seconds_elapsed"}, inplace=True)
                break
        else:
            df["seconds_elapsed"] = df.index / SAMPLING_RATE

    # ── Required raw columns ───────────────────────────────────────────
    required = ["accele_x", "accele_y", "gyro_z"]
    for col in required:
        if col not in df.columns:
            raise ValueError(
                f"Column '{col}' not found in dataset.\n"
                f"Available columns: {list(df.columns)}"
            )

    # ── Compute filtered columns if not present ────────────────────────
    for col in ["accele_x", "accele_y", "gyro_z"]:
        fcol = col + "_filtered"
        if fcol not in df.columns:
            df[fcol] = butterworth_lowpass(df[col].values)

    # FIX-3a: label_id ─────────────────────────────────────────────────
    if "label_id" not in df.columns:
        if "label" in df.columns:
            def map_raw_label(l):
                l_str = str(l).lower()
                if 'sshape' in l_str:
                    return 1  # Lane Weaving (S-shaped pattern)
                elif 'f-lane' in l_str:
                    return 2  # Lane Swerving (Fast lane change)
                elif 'brakes' in l_str:
                    return 3  # Hard Braking
                elif 'corner' in l_str:
                    return 4  # Hard Cornering
                elif 'u-turn' in l_str:
                    return 5  # Quick U-Turn
                else:
                    return 0  # Normal Driving
            
            df["label_id"] = df["label"].apply(map_raw_label)
            
            # Standardize the string labels for the rest of the pipeline
            df["label"] = df["label_id"].map(RASH_LABELS)
        else:
            df["label_id"] = 0          # treat all as normal
            df["label"] = "Normal Driving"

    # FIX-3b: synthetic GPS for route visualisation ────────────────────
    if "gps_lat" not in df.columns or "gps_lon" not in df.columns:
        n = len(df)
        t = np.arange(n) / SAMPLING_RATE
        dur = float(t[-1]) if n > 1 else 120.0
        df["gps_lat"] = 17.44 + 0.005 * np.sin(2 * np.pi * t / max(dur, 1))
        df["gps_lon"] = 78.50 + 0.005 * np.cos(2 * np.pi * t / max(dur, 1))

    n_rash = (df["label_id"] != 0).sum()
    print(f"  ✔  Loaded real dataset  |  rows={len(df):,}  |  "
          f"normal={len(df)-n_rash:,}  rash={n_rash:,}")
    return df


def generate_synthetic_dataset(n_sessions: int = 40,
                                session_dur_s: int = 120,
                                rash_only: bool = False) -> pd.DataFrame:
    """
    Synthesise IMU sessions matching signal signatures from Paper 3 §4.1.
    rash_only=True returns only rash-event rows (used for augmentation).
    """
    np.random.seed(42)
    rng = np.random.default_rng(42)
    rows = []
    T = session_dur_s * SAMPLING_RATE

    def _noise(n, sigma=0.05):
        return rng.normal(0, sigma, n)

    def make_event(cls_id: int):
        """Returns (ax, ay, gz) for one rash event (Paper 3 Figure 7)."""
        if cls_id == 1:   # Lane Weaving — multiple Ax oscillations
            t = np.linspace(0, 2 * np.pi, 700)
            ax = 3.0 * np.sin(2 * t) + _noise(700, 0.15)
            ay = _noise(700, 0.05)
            gz = 0.5 * np.sin(2 * t + np.pi) + _noise(700, 0.05)
        elif cls_id == 2: # Lane Swerving — single trough→peak Ax
            t = np.linspace(0, np.pi, 400)
            sign = np.array([-1 if i < 200 else 1 for i in range(400)])
            ax = 3.5 * np.sin(t) * sign + _noise(400, 0.15)
            ay = _noise(400, 0.05)
            gz = 0.35 * np.sin(t + 0.3) + _noise(400, 0.05)
        elif cls_id == 3: # Hard Braking — sharp Ay dip
            ax = _noise(350, 0.05)
            ay = np.concatenate([_noise(100, 0.05),
                                  np.linspace(0, -4.0, 150),
                                  np.linspace(-4.0, 0, 100)])
            ay += _noise(350, 0.1)
            gz = _noise(350, 0.03)
        elif cls_id == 4: # Hard Cornering — large Ax drop + Gz peak
            t = np.linspace(0, np.pi, 600)
            ax = -3.2 * np.sin(t) + _noise(600, 0.15)
            ay = -1.0 * np.sin(t) + _noise(600, 0.08)
            gz = 0.65 * np.sin(t) + _noise(600, 0.05)
        elif cls_id == 5: # Quick U-Turn — wide Ax peak, biggest Gz dip
            t = np.linspace(0, np.pi, 750)
            ax = 3.8 * np.sin(t) + _noise(750, 0.2)
            ay = -2.0 * np.sin(t) + _noise(750, 0.12)
            gz = -0.95 * np.sin(t) + _noise(750, 0.05)
        else:
            return None
        return ax, ay, gz

    for sess_id in range(n_sessions):
        t_total = np.arange(T) / SAMPLING_RATE
        ax_base = rng.normal(0, 0.08, T)
        ay_base = rng.normal(0, 0.08, T)
        gz_base = rng.normal(0, 0.03, T)
        labels_arr = np.zeros(T, dtype=int)

        # Inject 3–6 rash events per session
        n_events = rng.integers(3, 7)
        event_times = rng.choice(np.arange(500, T - 1300), n_events,
                                  replace=False)
        event_classes = rng.integers(1, 6, n_events)

        for et, ec in zip(sorted(event_times), event_classes):
            sig = make_event(ec)
            if sig is None:
                continue
            ex, ey, ez = sig
            L = len(ex)
            if et + L > T:
                continue
            ax_base[et:et + L] += ex
            ay_base[et:et + L] += ey
            gz_base[et:et + L] += ez
            labels_arr[et:et + L] = ec

        ax_f = butterworth_lowpass(ax_base)
        ay_f = butterworth_lowpass(ay_base)
        gz_f = butterworth_lowpass(gz_base)

        label_names = np.array([RASH_LABELS[l] for l in labels_arr])

        chunk = pd.DataFrame({
            "session_id":          sess_id,
            "seconds_elapsed":     t_total,
            "accele_x":            ax_base,
            "accele_y":            ay_base,
            "gyro_z":              gz_base,
            "accele_x_filtered":   ax_f,
            "accele_y_filtered":   ay_f,
            "gyro_z_filtered":     gz_f,
            "label":               label_names,
            "label_id":            labels_arr,
            "gps_lat": 17.44 + 0.005 * np.sin(2 * np.pi * t_total / session_dur_s),
            "gps_lon": 78.50 + 0.005 * np.cos(2 * np.pi * t_total / session_dur_s),
        })
        rows.append(chunk)

    df = pd.concat(rows, ignore_index=True)
    if rash_only:
        df = df[df["label_id"] != 0].reset_index(drop=True)

    nc = (df["label_id"] == 0).sum()
    rc = (df["label_id"] != 0).sum()
    print(f"  ✔  Synthetic dataset  |  rows={len(df):,}  |  "
          f"normal={nc:,}  rash={rc:,}")
    return df


# ══════════════════════════════════════════════════════════════════════
#  SECTION 2 — ADAPTIVE TIME WINDOW  (ATW)  — Paper 3 Algorithm 1
# ══════════════════════════════════════════════════════════════════════

def adaptive_time_window(ax: np.ndarray, ay: np.ndarray,
                          sigma_x: float = ATW_SIGMA_X,
                          sigma_y: float = ATW_SIGMA_Y,
                          w_size:  int   = ATW_WIN,
                          s_size:  int   = ATW_STEP,
                          max_w:   int   = ATW_MAX) -> list:
    """
    Adaptive Time Window algorithm — Paper 3, Algorithm 1.

    Scans Ax and Ay accelerometer streams.  When std(window) exceeds
    the thresholds the window expands until the signal returns to normal,
    capturing complete rash events without overlap redundancy or edge
    effects.

    Returns list of (start_idx, end_idx) tuples.

    FIX-7: Boundary and NaN guards added in the inner expansion loop.
    """
    segments = []
    i = 0
    N = min(len(ax), len(ay))

    while i + w_size <= N:
        win_x = ax[i: i + w_size]
        win_y = ay[i: i + w_size]

        # FIX-7: guard empty slices (can't happen here but belt+braces)
        if len(win_x) == 0 or len(win_y) == 0:
            i += s_size
            continue

        x_std = np.std(win_x)
        y_std = np.std(win_y)

        if x_std >= sigma_x or y_std >= sigma_y:
            start = i
            # Expand window while anomaly persists
            while True:
                i += s_size
                # FIX-7: stop if we would go out of bounds or exceed max
                if i - start >= max_w or i + w_size > N:
                    break
                win_x = ax[i: i + w_size]
                win_y = ay[i: i + w_size]
                if len(win_x) == 0 or len(win_y) == 0:
                    break
                x_std = np.std(win_x)
                y_std = np.std(win_y)
                # FIX-7: NaN guard (empty slice edge case)
                if np.isnan(x_std) or np.isnan(y_std):
                    break
                if not (x_std >= sigma_x or y_std >= sigma_y):
                    break
            end = min(i + w_size - s_size, N)
            if end > start:             # skip zero-length segments
                segments.append((start, end))
        else:
            i += s_size

    return segments


# ══════════════════════════════════════════════════════════════════════
#  SECTION 3 — FEATURE EXTRACTION  (Papers 1 & 3)
# ══════════════════════════════════════════════════════════════════════

def time_domain_features(signal: np.ndarray) -> np.ndarray:
    """17 time-domain features per channel — Paper 3, Table 3."""
    s = signal
    d1 = np.diff(s) if len(s) > 1 else np.array([0.0])
    feats = [
        np.min(s),                               #  1  min
        np.max(s),                               #  2  max
        np.mean(s),                              #  3  mean
        np.std(s),                               #  4  std
        np.median(s),                            #  5  median
        np.var(s),                               #  6  variance
        np.max(s) - np.min(s),                   #  7  range
        np.median(np.abs(s - np.median(s))),     #  8  MAD
        np.percentile(s, 75) - np.percentile(s, 25),  # 9 IQR
        np.sum(s ** 2) / max(len(s), 1),         # 10  energy
        float(skew(s)) if len(s) > 2 else 0.0,  # 11  skewness
        float(kurtosis(s)) if len(s) > 3 else 0.0,   # 12 kurtosis
        np.std(s) / (abs(np.mean(s)) + 1e-8),   # 13  coeff of variation
        float(np.mean(np.diff(np.sign(s)) != 0)) if len(s) > 1 else 0.0,  # 14 ZCR
        np.mean(np.abs(d1)),                     # 15  slope
        np.sum(np.abs(d1)),                      # 16  waveform length
        np.sqrt(np.mean(s ** 2)),                # 17  RMS
    ]
    return np.array(feats, dtype=np.float32)


def extract_features_from_window(ax_seg, ay_seg, gz_seg) -> np.ndarray:
    """Stack features from 3 channels → 51-dim vector."""
    return np.concatenate([
        time_domain_features(ax_seg),
        time_domain_features(ay_seg),
        time_domain_features(gz_seg),
    ])


def pad_or_truncate(arr: np.ndarray,
                    length: int = CNN_SEQ_LEN) -> np.ndarray:
    """
    Zero-pad short sequences; truncate long ones — Paper 3 §3.5.3.
    FIX-6: Empty-array guard returns zero-filled array.
    """
    if len(arr) == 0:                       # FIX-6
        return np.zeros(length, dtype=np.float32)
    if len(arr) >= length:
        return arr[:length].astype(np.float32)
    # Pad from value closest to zero (Paper 3)
    pad_val = float(arr[np.argmin(np.abs(arr))])
    return np.pad(arr, (0, length - len(arr)),
                  mode="constant",
                  constant_values=pad_val).astype(np.float32)


# ══════════════════════════════════════════════════════════════════════
#  SECTION 4 — WINDOW-LEVEL DATASET BUILDER
# ══════════════════════════════════════════════════════════════════════

def build_windows(df: pd.DataFrame,
                  use_atw: bool = True,
                  normal_ratio: float = 0.5) -> tuple:
    """
    Build (X_cnn, X_ml, y) from a session dataframe.

    X_cnn  : (N, CNN_SEQ_LEN, 3)  — for 1D CNN  [Ax, Ay, Gz]
    X_ml   : (N, 51)              — for kNN / RF
    y      : (N,)                 — integer class labels

    FIX-9: Also samples Normal Driving windows so the CNN sees all
           6 classes (matching Paper 3's 6-class setup).
    """
    X_cnn, X_ml, y = [], [], []
    rng_norm = np.random.default_rng(0)

    for sid, grp in df.groupby("session_id"):
        ax  = grp["accele_x_filtered"].values
        ay  = grp["accele_y_filtered"].values
        gz  = grp["gyro_z_filtered"].values
        lbl = grp["label_id"].values

        # ── ATW / static rash-event windows ──────────────────────────
        if use_atw:
            segs = adaptive_time_window(ax, ay)
        else:
            win  = STATIC_WIN_SEC * SAMPLING_RATE
            step = int(win * (1 - STATIC_OVERLAP))
            segs = [(i, i + win) for i in range(0, len(ax) - win, step)]

        for (s, e) in segs:
            s, e = int(s), int(min(e, len(ax)))
            if e - s < 10:
                continue
            ax_s = ax[s:e]; ay_s = ay[s:e]; gz_s = gz[s:e]
            lbl_s = lbl[s:e]
            vals, counts = np.unique(lbl_s, return_counts=True)
            majority = int(vals[np.argmax(counts)])

            cnn_ax = pad_or_truncate(ax_s)
            cnn_ay = pad_or_truncate(ay_s)
            cnn_gz = pad_or_truncate(gz_s)
            X_cnn.append(np.stack([cnn_ax, cnn_ay, cnn_gz], axis=-1))
            X_ml.append(extract_features_from_window(ax_s, ay_s, gz_s))
            y.append(majority)

        # FIX-9: Add Normal Driving windows ───────────────────────────
        if use_atw and len(segs) > 0:
            n_normal_target = max(1, int(len(segs) * normal_ratio))
            w = ATW_WIN
            normal_cands = []
            for ns in range(0, len(ax) - w, ATW_STEP * 4):
                ne = ns + w
                seg_ax = ax[ns:ne]; seg_ay = ay[ns:ne]
                sx = np.std(seg_ax); sy = np.std(seg_ay)
                # Only genuinely quiet windows
                if sx < ATW_SIGMA_X * 0.7 and sy < ATW_SIGMA_Y * 0.7:
                    normal_cands.append((ns, ne))

            if normal_cands:
                chosen_idx = rng_norm.choice(
                    len(normal_cands),
                    min(n_normal_target, len(normal_cands)),
                    replace=False,
                )
                for ci in chosen_idx:
                    ns, ne = normal_cands[int(ci)]
                    ax_s = ax[ns:ne]; ay_s = ay[ns:ne]; gz_s = gz[ns:ne]
                    cnn_ax = pad_or_truncate(ax_s)
                    cnn_ay = pad_or_truncate(ay_s)
                    cnn_gz = pad_or_truncate(gz_s)
                    X_cnn.append(np.stack([cnn_ax, cnn_ay, cnn_gz], axis=-1))
                    X_ml.append(extract_features_from_window(ax_s, ay_s, gz_s))
                    y.append(0)  # Normal Driving

    return (np.array(X_cnn, dtype=np.float32),
            np.array(X_ml,  dtype=np.float32),
            np.array(y,     dtype=np.int32))


# ══════════════════════════════════════════════════════════════════════
#  SECTION 5 — 1D CNN MODEL  (Paper 3, Figure 6 — Late Fusion)
# ══════════════════════════════════════════════════════════════════════

def conv_block(x, filters: int, kernel: int = 5,
               pool: int = 2, dropout: float = 0.4):
    """Two Conv1D → MaxPool → Dropout (Paper 3 architecture)."""
    x = layers.Conv1D(filters, kernel, padding="same",
                      activation="linear")(x)
    x = layers.LeakyReLU(0.01)(x)               # FIX-1: positional arg
    x = layers.Conv1D(filters, kernel, padding="same",
                      activation="linear")(x)
    x = layers.LeakyReLU(0.01)(x)               # FIX-1
    x = layers.MaxPooling1D(pool)(x)
    x = layers.Dropout(dropout)(x)
    return x


def build_1d_cnn(n_classes: int = 6,
                 seq_len:   int = CNN_SEQ_LEN) -> Model:
    """
    1D CNN with Late (Feature-level) Sensor Fusion — Paper 3.

    Branch per sensor axis:
      Conv1D(32,5) → Conv1D(32,5) → MaxPool(2) → Dropout(0.4)
      Conv1D(64,5) → Conv1D(64,5) → MaxPool(2) → Dropout(0.4)
      GlobalAvgPool
    Merge: Concatenate → Dense(128) → Dense(128) → Softmax(n_classes)
    """
    in_ax = Input(shape=(seq_len, 1), name="input_Ax")
    in_ay = Input(shape=(seq_len, 1), name="input_Ay")
    in_gz = Input(shape=(seq_len, 1), name="input_Gz")

    def branch(inp):
        x = conv_block(inp, 32)
        x = conv_block(x,  64)
        x = layers.GlobalAveragePooling1D()(x)
        return x

    merged = layers.Concatenate()([branch(in_ax), branch(in_ay), branch(in_gz)])
    x = layers.Dense(128, activation="linear")(merged)
    x = layers.LeakyReLU(0.01)(x)               # FIX-1
    x = layers.Dropout(0.3)(x)
    x = layers.Dense(128, activation="linear")(x)
    x = layers.LeakyReLU(0.01)(x)               # FIX-1
    out = layers.Dense(n_classes, activation="softmax", name="output")(x)

    model = Model(inputs=[in_ax, in_ay, in_gz], outputs=out)
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    return model


def cnn_inputs(X_cnn: np.ndarray) -> list:
    """Split (N, seq, 3) tensor into 3 × (N, seq, 1) inputs."""
    return [X_cnn[:, :, i:i + 1] for i in range(3)]


# ══════════════════════════════════════════════════════════════════════
#  SECTION 6 — kNN ROAD-ANOMALY SEPARATOR  (Paper 1, 98.67%)
# ══════════════════════════════════════════════════════════════════════

def build_road_event_dataset(df: pd.DataFrame) -> tuple:
    """
    kNN training set separating three classes (Paper 1 §3):
      0 = Bump / Road Anomaly  (Z-axis spike)
      1 = Normal Driving
      2 = Abnormal (Aggressive) Driver Behaviour
    """
    rng = np.random.default_rng(0)
    X, y = [], []
    win = SAMPLING_RATE          # 1-second windows

    for sid, grp in df.groupby("session_id"):
        ax  = grp["accele_x_filtered"].values
        ay  = grp["accele_y_filtered"].values
        gz  = grp["gyro_z_filtered"].values
        # label_id is guaranteed to exist after load_real_dataset / synth
        lid = grp["label_id"].values

        # Proxy Z-axis: road anomalies cause Z spikes (Paper 1)
        az = rng.normal(0.2, 0.05, len(ax))
        bump_mask = (lid == 0) & (np.abs(ay) > 0.3)
        if bump_mask.sum():
            az[bump_mask] += rng.uniform(1.5, 3.5, bump_mask.sum())

        for start in range(0, len(ax) - win, win // 2):
            seg_ax = ax[start: start + win]
            seg_ay = ay[start: start + win]
            seg_az = az[start: start + win]
            lbl_w  = lid[start: start + win]

            vals, cnts = np.unique(lbl_w, return_counts=True)
            dominant   = int(vals[np.argmax(cnts)])

            z_spike  = np.max(np.abs(seg_az)) > 1.8
            xy_spike = (np.std(seg_ax) > 0.35 or np.std(seg_ay) > 0.40)

            if z_spike and not xy_spike:
                road_class = 0    # Bump
            elif xy_spike and dominant != 0:
                road_class = 2    # Aggressive driver
            else:
                road_class = 1    # Normal

            feats = extract_features_from_window(seg_ax, seg_ay, seg_az)
            X.append(feats)
            y.append(road_class)

    return np.array(X, dtype=np.float32), np.array(y, dtype=np.int32)


# ══════════════════════════════════════════════════════════════════════
#  SECTION 7 — SVM ROAD QUALITY  (Paper 2, 88.05%)
# ══════════════════════════════════════════════════════════════════════

def build_road_quality_dataset(df: pd.DataFrame) -> tuple:
    """Binary classifier: Smooth vs Bumpy/Potholed (Paper 2)."""
    rng = np.random.default_rng(1)
    X, y = [], []
    win = SAMPLING_RATE

    for sid, grp in df.groupby("session_id"):
        ax  = grp["accele_x_filtered"].values
        ay  = grp["accele_y_filtered"].values
        gz  = grp["gyro_z_filtered"].values
        lid = grp["label_id"].values

        az = rng.normal(0.2, 0.05, len(ax))
        braking_mask = lid == 3
        if braking_mask.sum():
            az[braking_mask] += rng.uniform(1.5, 3.0, braking_mask.sum())

        for start in range(0, len(ax) - win, win):
            seg_ax = ax[start: start + win]
            seg_ay = ay[start: start + win]
            seg_az = az[start: start + win]
            seg_gz = gz[start: start + win]
            z_var  = np.var(seg_az)
            quality = 1 if (z_var > 0.4 or np.max(np.abs(seg_az)) > 1.6) else 0
            feats = np.array([
                np.mean(seg_ax),   np.std(seg_ax),
                np.mean(seg_ay),   np.std(seg_ay),
                np.mean(seg_az),   np.std(seg_az),
                np.mean(seg_gz),   np.std(seg_gz),
                np.mean(np.abs(seg_az)),
                np.max(np.abs(seg_az)),
                z_var,
                np.sqrt(np.mean(seg_ax ** 2 + seg_ay ** 2)),
            ], dtype=np.float32)
            X.append(feats)
            y.append(quality)

    return np.array(X), np.array(y)


# ══════════════════════════════════════════════════════════════════════
#  SECTION 8 — CONTEXTUAL SEPARATOR  (KinetiQ's core innovation)
# ══════════════════════════════════════════════════════════════════════

class ContextualSeparator:
    """
    Fleet-level GPS clustering:
      ROAD_FAULT   → same GPS cell shows anomaly across ≥ N vehicles
      DRIVER_FAULT → anomaly is vehicle-specific
    """
    def __init__(self, grid_size: float = 0.0005,
                 vehicle_threshold: int = 2):
        self.grid   = grid_size    # ~55 m cells at equator
        self.thresh = vehicle_threshold

    def _gps_cell(self, lat: float, lon: float) -> tuple:
        return (round(lat / self.grid) * self.grid,
                round(lon / self.grid) * self.grid)

    def analyse(self, events: pd.DataFrame) -> pd.DataFrame:
        """
        events columns: session_id, lat, lon, rash_class, timestamp_s
        Returns events with 'fault_type' column added.
        """
        events = events.copy()
        events["gps_cell"] = events.apply(
            lambda r: self._gps_cell(r["lat"], r["lon"]), axis=1)
        vehicle_count = (events.groupby("gps_cell")["session_id"]
                                .nunique()
                                .rename("vehicle_count"))
        events = events.join(vehicle_count, on="gps_cell")
        events["fault_type"] = np.where(
            events["vehicle_count"] >= self.thresh,
            "ROAD_FAULT", "DRIVER_FAULT",
        )
        return events


# ══════════════════════════════════════════════════════════════════════
#  SECTION 9 — DRIVER TRUST SCORE
# ══════════════════════════════════════════════════════════════════════

def compute_driver_trust_score(events: pd.DataFrame) -> pd.DataFrame:
    """
    Per-driver Trust Score (0–100).
    Only DRIVER_FAULT events penalise the driver.
    FIX-8: fillna(0) prevents NaN propagation when class not in PENALTY.
    """
    scores = []
    for sid, grp in events.groupby("session_id"):
        driver_faults = grp[grp["fault_type"] == "DRIVER_FAULT"]
        penalty_total = int(
            driver_faults["rash_class"].map(PENALTY).fillna(0).sum()  # FIX-8
        )
        score = max(0, 100 - penalty_total)
        scores.append({
            "session_id":     sid,
            "trust_score":    score,
            "total_events":   len(grp),
            "driver_faults":  len(driver_faults),
            "road_faults":    len(grp) - len(driver_faults),
            "penalty_points": penalty_total,
            "event_breakdown": str(driver_faults["rash_class"]
                                   .value_counts().to_dict()),
        })
    return pd.DataFrame(scores).sort_values("trust_score", ascending=False)


# ══════════════════════════════════════════════════════════════════════
#  SECTION 10 — TRAINING & EVALUATION
# ══════════════════════════════════════════════════════════════════════

def train_and_evaluate(df: pd.DataFrame) -> dict:
    results = {}

    # ── 10a. Build windowed datasets ──────────────────────────────────
    print("\n[1/5]  Building windowed datasets (ATW + Normal samples) …")
    X_cnn, X_ml, y = build_windows(df, use_atw=True)

    if len(y) == 0:
        raise RuntimeError(
            "No windows extracted — check that the dataset has sufficient "
            "variance (accele_x_filtered / accele_y_filtered)."
        )

    classes, counts = np.unique(y, return_counts=True)
    
    # 1. Find a sensible target count (e.g., the maximum count among the rash events)
    # This prevents the massive 'Normal' class from dictating the size, 
    # but still utilizes all available rash driving data.
    rash_counts = [count for cls, count in zip(classes, counts) if cls != 0]
    target_count = max(rash_counts) if rash_counts else int(np.mean(counts))
    
    idx_balanced = []
    for c in classes:
        idx_c = np.where(y == c)[0]
        # 2. Resample: Oversample minority (replace=True), Undersample majority (replace=False)
        replace_flag = len(idx_c) < target_count
        idx_b = resample(idx_c, n_samples=target_count, replace=replace_flag, random_state=42)
        idx_balanced.extend(idx_b)
        
    idx_balanced = np.array(idx_balanced)
    np.random.shuffle(idx_balanced)
    # -------------------------------

    X_cnn = X_cnn[idx_balanced]
    X_ml  = X_ml[idx_balanced]
    y     = y[idx_balanced]

    print(f"      Windows: {len(y)} | Target per class: {target_count}")
    for c, n in zip(*np.unique(y, return_counts=True)):
        print(f"      {RASH_LABELS.get(int(c), str(c)):<22} : {n}")

    X_tr_cnn, X_te_cnn, X_tr_ml, X_te_ml, y_tr, y_te = train_test_split(
        X_cnn, X_ml, y, test_size=0.25, stratify=y, random_state=42)

    # ── 10b. 1D CNN  (Paper 3, §3.5.3) ────────────────────────────────
    print("\n[2/5]  Training 1D CNN (Late Fusion, Paper 3) …")
    n_cls = len(np.unique(y))
    cnn   = build_1d_cnn(n_classes=n_cls)
    cb = [
        EarlyStopping(patience=8, restore_best_weights=True, verbose=0),
        ReduceLROnPlateau(factor=0.5, patience=4, verbose=0),
        TqdmCallback(verbose=1, desc="1D CNN Training")
    ]
    history = cnn.fit(
        cnn_inputs(X_tr_cnn), y_tr,
        validation_split=0.15,
        epochs=CNN_EPOCHS,
        batch_size=CNN_BATCH,
        callbacks=cb,
        verbose=0,
    )
    y_pred_cnn = np.argmax(cnn.predict(cnn_inputs(X_te_cnn), verbose=0), axis=1)
    acc_cnn    = accuracy_score(y_te, y_pred_cnn)
    f1_cnn     = f1_score(y_te, y_pred_cnn, average="weighted")
    cm_cnn     = confusion_matrix(y_te, y_pred_cnn)
    cls_list   = sorted(np.unique(y).tolist())
    cr_cnn     = classification_report(
        y_te, y_pred_cnn,
        target_names=[RASH_LABELS.get(i, str(i)) for i in cls_list],
    )
    print(f"      1D CNN  →  Accuracy: {acc_cnn:.4f}  |  F1: {f1_cnn:.4f}")
    results["cnn"] = {
        "acc": acc_cnn, "f1": f1_cnn, "cm": cm_cnn,
        "report": cr_cnn, "history": history,
        "model": cnn, "classes": cls_list,
    }

    # ── 10c. Random Forest ─────────────────────────────────────────────
    print("\n[3/5]  Training Random Forest (baseline comparison) …")
    scaler_rf  = StandardScaler().fit(X_tr_ml)
    X_tr_s     = scaler_rf.transform(X_tr_ml)
    X_te_s     = scaler_rf.transform(X_te_ml)
    rf = RandomForestClassifier(n_estimators=100, max_depth=10,
                                criterion="gini", random_state=42, n_jobs=-1)
    rf.fit(X_tr_s, y_tr)
    y_pred_rf = rf.predict(X_te_s)
    acc_rf    = accuracy_score(y_te, y_pred_rf)
    f1_rf     = f1_score(y_te, y_pred_rf, average="weighted")
    print(f"      RF      →  Accuracy: {acc_rf:.4f}  |  F1: {f1_rf:.4f}")
    results["rf"] = {"acc": acc_rf, "f1": f1_rf, "model": rf, "scaler": scaler_rf}

    # ── 10d. kNN Road-Anomaly Separator (Paper 1) ──────────────────────
    print("\n[4/5]  Training kNN Road-Anomaly Separator (Paper 1) …")
    X_road, y_road = build_road_event_dataset(df)
    scaler_knn     = StandardScaler().fit(X_road)
    X_road_s       = scaler_knn.transform(X_road)
    kf  = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    knn = KNeighborsClassifier(n_neighbors=3, metric="euclidean", n_jobs=-1)
    cv_knn = []
    
    # Wrapped with tqdm
    for tr_i, te_i in tqdm(kf.split(X_road_s, y_road), total=5, desc="kNN 5-Fold CV"):
        knn.fit(X_road_s[tr_i], y_road[tr_i])
        cv_knn.append(accuracy_score(y_road[te_i], knn.predict(X_road_s[te_i])))
        
    knn.fit(X_road_s, y_road)
    acc_knn = float(np.mean(cv_knn))
    print(f"\n      kNN     →  5-fold CV Accuracy: {acc_knn:.4f}")
    results["knn"] = {"acc": acc_knn, "cv": cv_knn, "model": knn,
                       "scaler": scaler_knn}

    # ── 10e. SVM Road Quality (Paper 2) ───────────────────────────────
    print("\n[5/5]  Training SVM Road Quality Classifier (Paper 2) …")
    X_rq, y_rq = build_road_quality_dataset(df)
    scaler_svm  = StandardScaler().fit(X_rq)
    X_rq_s      = scaler_svm.transform(X_rq)
    svm = SVC(kernel="rbf", C=30, probability=True, random_state=42)
    cv_svm = []
    
    # Wrapped with tqdm
    for tr_i, te_i in tqdm(kf.split(X_rq_s, y_rq), total=5, desc="SVM 5-Fold CV"):
        svm.fit(X_rq_s[tr_i], y_rq[tr_i])
        cv_svm.append(accuracy_score(y_rq[te_i], svm.predict(X_rq_s[te_i])))
        
    svm.fit(X_rq_s, y_rq)
    acc_svm = float(np.mean(cv_svm))
    print(f"\n      SVM     →  5-fold CV Accuracy: {acc_svm:.4f}")
    results["svm"] = {"acc": acc_svm, "cv": cv_svm, "model": svm,
                       "scaler": scaler_svm}

    results["y_te"]      = y_te
    results["y_pred_cnn"] = y_pred_cnn
    results["classes"]   = cls_list
    results["X_te_cnn"]   = X_te_cnn
    return results

# ══════════════════════════════════════════════════════════════════════
#  SECTION 11 — DRIVER SCORE PIPELINE
# ══════════════════════════════════════════════════════════════════════

def run_scoring_pipeline(df: pd.DataFrame,
                          results: dict) -> tuple:
    """
    Use trained 1D CNN + contextual separator to:
      1. Detect rash events per session
      2. Label each ROAD_FAULT or DRIVER_FAULT
      3. Return (scores_df, events_df)

    FIX-2: Always returns a (DataFrame, DataFrame) tuple — never a
           single DataFrame — so callers can safely unpack.
    """
    cnn    = results["cnn"]["model"]
    cnn_cl = results["cnn"]["classes"]      # list of class ints

    events = []
    for sid, grp in df.groupby("session_id"):
        ax  = grp["accele_x_filtered"].values
        ay  = grp["accele_y_filtered"].values
        gz  = grp["gyro_z_filtered"].values
        lat = grp["gps_lat"].values
        lon = grp["gps_lon"].values

        segs = adaptive_time_window(ax, ay)
        for (s, e) in segs:
            s, e = int(s), int(min(e, len(ax)))
            if e - s < 10:
                continue
            ax_s = ax[s:e]; ay_s = ay[s:e]; gz_s = gz[s:e]
            mid  = (s + e) // 2

            cnn_in  = [pad_or_truncate(c)[np.newaxis, :, np.newaxis]
                       for c in [ax_s, ay_s, gz_s]]
            raw_pred  = int(np.argmax(cnn.predict(cnn_in, verbose=0)))
            actual_id = cnn_cl[raw_pred]
            rash_cls  = RASH_LABELS.get(actual_id, "Normal Driving")

            if rash_cls == "Normal Driving":
                continue

            events.append({
                "session_id": sid,
                "lat":        float(lat[min(mid, len(lat) - 1)]),
                "lon":        float(lon[min(mid, len(lon) - 1)]),
                "rash_class": rash_cls,
                "start_s":    s / SAMPLING_RATE,
                "end_s":      e / SAMPLING_RATE,
            })

    if not events:                          # FIX-2: always return tuple
        print("  ⚠  No rash events detected — all driving is normal.")
        return pd.DataFrame(), pd.DataFrame()

    events_df = pd.DataFrame(events)
    sep       = ContextualSeparator(vehicle_threshold=2)
    events_df = sep.analyse(events_df)
    scores_df = compute_driver_trust_score(events_df)
    return scores_df, events_df             # FIX-2: consistent tuple

def plot_test_inferences(X_te, y_te, y_pred, classes, save_path="kinetiQ_test_inferences.png"):
    """Randomly samples 6 events from the test split and plots the IMU signatures alongside True/Pred labels."""
    import matplotlib.pyplot as plt
    
    fig, axes = plt.subplots(2, 3, figsize=(18, 10), facecolor="#0d1117")
    fig.suptitle("1D CNN Test Split Inference Verification", fontsize=18, fontweight="bold", color="white", y=0.95)
    
    # Pick 6 random indices from the test set
    rng = np.random.default_rng(10)
    idx = rng.choice(len(X_te), 6, replace=False)
    
    for i, ax in enumerate(axes.flatten()):
        sample_idx = idx[i]
        
        # Map integer classes back to string labels
        true_label = RASH_LABELS.get(classes[y_te[sample_idx]], "Unknown")
        pred_label = RASH_LABELS.get(classes[y_pred[sample_idx]], "Unknown")
        
        # X_te shape is (1200, 3) -> Ax, Ay, Gz
        ax.plot(X_te[sample_idx, :, 0], label="Ax (Lat)", color="#3498db", lw=1.5)
        ax.plot(X_te[sample_idx, :, 1], label="Ay (Long)", color="#e74c3c", lw=1.5)
        ax.plot(X_te[sample_idx, :, 2], label="Gz (Yaw)", color="#2ecc71", lw=1.5)
        
        title_color = "#2ecc71" if true_label == pred_label else "#e74c3c"
        ax.set_title(f"True: {true_label}\nPred: {pred_label}", color=title_color, fontsize=12, fontweight="bold")
        ax.set_facecolor("#161b22")
        ax.tick_params(colors="white", labelsize=9)
        ax.spines[:].set_color("#30363d")
        ax.set_ylim(-5, 5) # Lock y-axis to standard G-force ranges
        
        if i == 0:
            ax.legend(facecolor="#21262d", labelcolor="white", loc="upper right")
            
    plt.tight_layout(rect=[0, 0, 1, 0.92])
    plt.savefig(save_path, dpi=150, facecolor=fig.get_facecolor())
    plt.close()
    print(f"\n  ✔  Inference verification saved → {save_path}")

# ══════════════════════════════════════════════════════════════════════
#  SECTION 12 — VISUALISATION DASHBOARD
# ══════════════════════════════════════════════════════════════════════

def plot_dashboard(df: pd.DataFrame, results: dict,
                   scores_df: pd.DataFrame,
                   events_df: pd.DataFrame,
                   save_path: str = "kinetiQ_dashboard.png") -> None:

    fig = plt.figure(figsize=(24, 26), facecolor="#0d1117")
    fig.suptitle("KinetiQ  ·  Context-Aware Fleet Intelligence Dashboard",
                 fontsize=22, fontweight="bold", color="white", y=0.98)

    gs       = gridspec.GridSpec(4, 3, figure=fig, hspace=0.52, wspace=0.4)
    ax_args  = dict(facecolor="#161b22")
    dark_txt = "white"
    accent   = "#00d4aa"

    # ── Panel 1: ATW signal demo ──────────────────────────────────────
    # ── Panel 1: ATW signal demo ──────────────────────────────────────
    ax1 = fig.add_subplot(gs[0, :2], **ax_args)
    
    # Find a specific window that actually contains a rash event
    rash_events = df[df["label_id"] != 0]
    if not rash_events.empty:
        target_sid = rash_events["session_id"].iloc[0]
        event_time = rash_events["seconds_elapsed"].iloc[0]
        # Grab a 30-second slice around the event
        sample = df[(df["session_id"] == target_sid) & 
                    (df["seconds_elapsed"] >= event_time - 10) & 
                    (df["seconds_elapsed"] <= event_time + 20)]
    else:
        first_sid = df["session_id"].iloc[0]
        sample = df[df["session_id"] == first_sid].head(3000)

    t = sample["seconds_elapsed"].values
    ax1.plot(t, sample["accele_x_filtered"], color="#3498db",
             lw=0.8, alpha=0.85, label="Ax filtered")
    ax1.plot(t, sample["accele_y_filtered"], color="#e74c3c",
             lw=0.8, alpha=0.85, label="Ay filtered")
             
    segs = adaptive_time_window(
        sample["accele_x_filtered"].values,
        sample["accele_y_filtered"].values)
        
    for (s, e) in segs:
        s_safe = min(int(s), len(t) - 1)
        e_safe = min(int(e), len(t) - 1)
        ax1.axvspan(t[s_safe], t[e_safe], alpha=0.25, color="#f39c12")
        
    ax1.legend(handles=[
        plt.Line2D([0], [0], color="#3498db", lw=1.5, label="Ax filtered"),
        plt.Line2D([0], [0], color="#e74c3c", lw=1.5, label="Ay filtered"),
        Patch(color="#f39c12", alpha=0.4, label="ATW detected window"),
    ], loc="upper right", facecolor="#21262d", labelcolor=dark_txt, fontsize=9)
    ax1.set_title("Adaptive Time Window (ATW) Detection",
                  color=dark_txt, fontsize=13)
    ax1.set_xlabel("Time (s)", color=dark_txt)
    ax1.set_ylabel("Acc (m/s²)", color=dark_txt)
    ax1.tick_params(colors=dark_txt)
    ax1.spines[:].set_color("#30363d")

    # ── Panel 2: Class distribution ───────────────────────────────────
    ax2 = fig.add_subplot(gs[0, 2], **ax_args)
    cls_counts = df["label_id"].value_counts().sort_index()
    bar_colors = (COLORS * 2)[:len(cls_counts)]
    bars = ax2.bar(
        [RASH_LABELS.get(int(i), str(i)) for i in cls_counts.index],
        cls_counts.values, color=bar_colors, edgecolor="#30363d",
    )
    ax2.set_title("Event Class Distribution", color=dark_txt, fontsize=13)
    ax2.tick_params(axis="x", rotation=45, labelsize=6.5, colors=dark_txt)
    ax2.tick_params(axis="y", colors=dark_txt)
    ax2.spines[:].set_color("#30363d")
    for bar, val in zip(bars, cls_counts.values):
        ax2.text(bar.get_x() + bar.get_width() / 2,
                 bar.get_height() + max(cls_counts.values) * 0.01,
                 str(val), ha="center", va="bottom",
                 color=dark_txt, fontsize=7)

    # ── Panel 3: CNN training curves ─────────────────────────────────
    ax3 = fig.add_subplot(gs[1, 0], **ax_args)
    h = results["cnn"]["history"].history
    ax3.plot(h["accuracy"],     color=accent,    lw=1.5, label="Train Acc")
    ax3.plot(h["val_accuracy"], color="#e74c3c", lw=1.5,
             linestyle="--", label="Val Acc")
    ax3.set_title("1D CNN Training Curve", color=dark_txt, fontsize=13)
    ax3.set_xlabel("Epoch", color=dark_txt)
    ax3.set_ylabel("Accuracy", color=dark_txt)
    ax3.tick_params(colors=dark_txt)
    ax3.spines[:].set_color("#30363d")
    ax3.legend(facecolor="#21262d", labelcolor=dark_txt, fontsize=9)
    ax3.text(0.97, 0.05, f"Final: {results['cnn']['acc']:.3f}",
             transform=ax3.transAxes, ha="right", color=accent, fontsize=10)

    # ── Panel 4: CNN confusion matrix ────────────────────────────────
    ax4 = fig.add_subplot(gs[1, 1:], **ax_args)
    cls_names = [RASH_LABELS.get(c, str(c)) for c in results["cnn"]["classes"]]
    sns.heatmap(results["cnn"]["cm"], annot=True, fmt="d",
                cmap="YlOrRd", ax=ax4,
                xticklabels=cls_names, yticklabels=cls_names,
                cbar_kws={"shrink": 0.8})
    ax4.set_title("1D CNN Confusion Matrix", color=dark_txt, fontsize=13)
    ax4.tick_params(axis="x", rotation=45, labelsize=8, colors=dark_txt)
    ax4.tick_params(axis="y", rotation=0,  labelsize=8, colors=dark_txt)

    # ── Panel 5: Model accuracy comparison ───────────────────────────
    ax5 = fig.add_subplot(gs[2, 0], **ax_args)
    models     = ["1D CNN\n(Paper 3)", "Random Forest\n(Baseline)",
                   "kNN 5-CV\n(Paper 1)", "SVM 5-CV\n(Paper 2)"]
    accs       = [results["cnn"]["acc"], results["rf"]["acc"],
                   results["knn"]["acc"], results["svm"]["acc"]]
    paper_refs = [97.14, 96.43, 98.67, 88.05]
    xp = np.arange(len(models))
    ax5.bar(xp - 0.2, [a * 100 for a in accs], 0.4,
            color=accent,    label="Our Results",    edgecolor="#30363d")
    ax5.bar(xp + 0.2, paper_refs,              0.4,
            color="#9b59b6", label="Paper Reported", edgecolor="#30363d")
    ax5.set_title("Model Accuracy vs. Paper Benchmarks",
                  color=dark_txt, fontsize=13)
    ax5.set_xticks(xp)
    ax5.set_xticklabels(models, fontsize=8, color=dark_txt)
    ax5.set_ylabel("Accuracy (%)", color=dark_txt)
    ax5.tick_params(colors=dark_txt)
    ax5.spines[:].set_color("#30363d")
    ax5.legend(facecolor="#21262d", labelcolor=dark_txt, fontsize=8)
    ax5.set_ylim(70, 102)

    # ── Panel 6: Fault split pie ──────────────────────────────────────
    ax6 = fig.add_subplot(gs[2, 1], **ax_args)
    if events_df is not None and len(events_df):
        fault_counts = events_df["fault_type"].value_counts()
        ax6.pie(fault_counts.values,
                labels=fault_counts.index,
                autopct="%1.1f%%",
                colors=["#e74c3c", "#3498db"],
                textprops={"color": dark_txt, "fontsize": 11},
                wedgeprops={"edgecolor": "#0d1117", "linewidth": 2})
    else:
        ax6.text(0.5, 0.5, "No events detected",
                 ha="center", va="center", color=dark_txt, fontsize=11)
    ax6.set_title("Road Fault vs Driver Fault\n(Contextual Separation)",
                  color=dark_txt, fontsize=13)

    # ── Panel 7: Driver Trust Scores ─────────────────────────────────
    ax7 = fig.add_subplot(gs[2, 2], **ax_args)
    if scores_df is not None and len(scores_df):
        top10  = scores_df.head(10)
        bar_c  = ["#2ecc71" if s >= 80 else "#f39c12" if s >= 60 else "#e74c3c"
                  for s in top10["trust_score"]]
        ax7.barh(range(len(top10)), top10["trust_score"],
                 color=bar_c, edgecolor="#30363d")
        ax7.set_yticks(range(len(top10)))
        ax7.set_yticklabels(
            [f"Driver {i}" for i in top10["session_id"]],
            color=dark_txt, fontsize=9,
        )
        ax7.set_xlabel("Trust Score (0–100)", color=dark_txt)
        ax7.set_xlim(0, 105)
        ax7.axvline(80, color="#2ecc71", linestyle="--", alpha=0.5, lw=1)
        ax7.axvline(60, color="#f39c12", linestyle="--", alpha=0.5, lw=1)
    else:
        ax7.text(0.5, 0.5, "No scoring data",
                 ha="center", va="center", color=dark_txt, fontsize=11)
    ax7.set_title("Driver Trust Scores\n(Green≥80 / Amber≥60 / Red<60)",
                  color=dark_txt, fontsize=13)
    ax7.tick_params(colors=dark_txt)
    ax7.spines[:].set_color("#30363d")

    # ── Panel 8: Route hazard map ─────────────────────────────────────
    ax8 = fig.add_subplot(gs[3, :2], **ax_args)
    if events_df is not None and len(events_df):
        rd_f = events_df[events_df["fault_type"] == "ROAD_FAULT"]
        dr_f = events_df[events_df["fault_type"] == "DRIVER_FAULT"]
        ax8.scatter(rd_f["lon"], rd_f["lat"],
                    c="#e74c3c", s=60, alpha=0.6, label="Road Fault",   zorder=3)
        ax8.scatter(dr_f["lon"], dr_f["lat"],
                    c="#3498db", s=40, alpha=0.6, label="Driver Fault", zorder=3)
    for sid, grp in df.groupby("session_id"):
        ax8.plot(grp["gps_lon"].values[::50], grp["gps_lat"].values[::50],
                 color="gray", alpha=0.15, lw=0.5, zorder=1)
    ax8.set_title("Route Hazard Map  (Red=Road Fault | Blue=Driver Fault)",
                  color=dark_txt, fontsize=13)
    ax8.set_xlabel("Longitude", color=dark_txt)
    ax8.set_ylabel("Latitude",  color=dark_txt)
    ax8.tick_params(colors=dark_txt)
    ax8.spines[:].set_color("#30363d")
    ax8.legend(facecolor="#21262d", labelcolor=dark_txt, fontsize=9)

    # ── Panel 9: Summary stats ────────────────────────────────────────
    ax9 = fig.add_subplot(gs[3, 2], **ax_args)
    ax9.axis("off")
    if scores_df is not None and len(scores_df) and events_df is not None and len(events_df):
        avg_score = scores_df["trust_score"].mean()
        safe      = int((scores_df["trust_score"] >= 80).sum())
        risky     = int((scores_df["trust_score"] < 60).sum())
        road_f    = int((events_df["fault_type"] == "ROAD_FAULT").sum())
        drv_f     = int((events_df["fault_type"] == "DRIVER_FAULT").sum())
        lines = [
            ("KinetiQ SUMMARY", ""),
            ("", ""),
            ("Total Drivers Analysed",  str(len(scores_df))),
            ("Avg Trust Score",         f"{avg_score:.1f} / 100"),
            ("Safe Drivers (≥80)",       str(safe)),
            ("At-Risk Drivers (<60)",    str(risky)),
            ("", ""),
            ("Total Events Detected",   str(len(events_df))),
            ("→ Road Faults",           str(road_f)),
            ("→ Driver Faults",         str(drv_f)),
            ("", ""),
            ("1D CNN Accuracy",         f"{results['cnn']['acc']*100:.2f}%"),
            ("kNN Road Sep. Acc",       f"{results['knn']['acc']*100:.2f}%"),
            ("SVM Road Quality Acc",    f"{results['svm']['acc']*100:.2f}%"),
        ]
        for i, (k, v) in enumerate(lines):
            y_pos = 1.0 - i * 0.065
            if k == "KinetiQ SUMMARY":
                ax9.text(0.05, y_pos, k, transform=ax9.transAxes,
                         color=accent, fontsize=13, fontweight="bold")
            else:
                ax9.text(0.05, y_pos, k, transform=ax9.transAxes,
                         color="#aaaaaa", fontsize=9)
                ax9.text(0.70, y_pos, v, transform=ax9.transAxes,
                         color="white", fontsize=9, fontweight="bold")

    plt.savefig(save_path, dpi=150, bbox_inches="tight",
                facecolor=fig.get_facecolor())
    plt.close()
    print(f"\n  ✔  Dashboard saved → {save_path}")


# ══════════════════════════════════════════════════════════════════════
#  SECTION 13 — INFERENCE HELPER  (plug into live IoT stream)
# ══════════════════════════════════════════════════════════════════════

class KinetiQInference:
    """
    Real-time inference engine.
    Feed raw IMU readings → rash class + road quality in < 5 ms.
    """
    def __init__(self, cnn_model, knn_model, knn_scaler,
                 svm_model, svm_scaler):
        self.cnn    = cnn_model
        self.knn    = knn_model
        self.knn_sc = knn_scaler
        self.svm    = svm_model
        self.svm_sc = svm_scaler
        self.buffer_ax: list = []
        self.buffer_ay: list = []
        self.buffer_gz: list = []
        self.sep = ContextualSeparator()

    def ingest(self, ax: float, ay: float, gz: float) -> None:
        self.buffer_ax.append(ax)
        self.buffer_ay.append(ay)
        self.buffer_gz.append(gz)

    def classify_rash(self) -> str:
        """Run 1D CNN on current buffer. Returns class name."""
        ax = pad_or_truncate(np.array(self.buffer_ax[-CNN_SEQ_LEN:]))
        ay = pad_or_truncate(np.array(self.buffer_ay[-CNN_SEQ_LEN:]))
        gz = pad_or_truncate(np.array(self.buffer_gz[-CNN_SEQ_LEN:]))
        inp  = [c[np.newaxis, :, np.newaxis] for c in [ax, ay, gz]]
        pred = int(np.argmax(self.cnn.predict(inp, verbose=0)))
        return RASH_LABELS.get(pred, "Unknown")

    def classify_road(self) -> str:
        """Run SVM on last 1 s of buffer. Returns road quality."""
        ax = np.array(self.buffer_ax[-SAMPLING_RATE:])
        ay = np.array(self.buffer_ay[-SAMPLING_RATE:])
        gz = np.array(self.buffer_gz[-SAMPLING_RATE:])
        az = np.zeros_like(ax)
        feats = np.array([[
            np.mean(ax),   np.std(ax),
            np.mean(ay),   np.std(ay),
            np.mean(az),   np.std(az),
            np.mean(gz),   np.std(gz),
            np.mean(np.abs(az)), np.max(np.abs(az)) if len(az) else 0.0,
            np.var(az),
            np.sqrt(np.mean(ax ** 2 + ay ** 2)) if len(ax) else 0.0,
        ]])
        return ROAD_LABELS[int(self.svm.predict(
            self.svm_sc.transform(feats))[0])]


# ══════════════════════════════════════════════════════════════════════
#  MAIN  ENTRY  POINT
# ══════════════════════════════════════════════════════════════════════

if __name__ == "__main__":

    # FIX-10: ensure output directory exists before any file write
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # ── 1. Load data ──────────────────────────────────────────────────
    REAL_DATA_PATH = "df_datasetRashdrivesIMU.csv"

    if os.path.exists(REAL_DATA_PATH):
        print(f"\n  Found real dataset → {REAL_DATA_PATH}")
        df = load_real_dataset(REAL_DATA_PATH)

        # FIX-4: Assign session IDs via time-reset detection
        df["session_id"] = (df["seconds_elapsed"].diff() < 0).cumsum()

        # FIX-4: If time is monotonic (no resets), split into 120s chunks
        if df["session_id"].nunique() <= 1:
            rows_per_session = 120 * SAMPLING_RATE
            df["session_id"] = (df.index // rows_per_session).astype(int)
            print(f"  ✔  Monotonic time detected → split into "
                  f"{df['session_id'].nunique()} sessions of 120s each")
                  
    else:
        raise FileNotFoundError(f"Real dataset not found at {REAL_DATA_PATH}. "
                                "Synthetic generation is disabled.")

    print(f"\n  Dataset shape : {df.shape}")
    print(f"  Sessions      : {df['session_id'].nunique()}")
    print(f"  Label dist    :\n{df['label'].value_counts().to_string()}")

    # ── 2. Train all models ───────────────────────────────────────────
    results = train_and_evaluate(df)

    # ── 3. Scoring pipeline ───────────────────────────────────────────
    print("\n  Running contextual scoring pipeline …")
    scores_df, events_df = run_scoring_pipeline(df, results)  # FIX-2: safe unpack

    if len(scores_df) > 0:
        print("\n  ── Top 10 Driver Trust Scores ──────────────────────────")
        print(scores_df[["session_id", "trust_score", "driver_faults",
                          "road_faults", "penalty_points"]].head(10)
              .to_string(index=False))
    else:
        print("  (No scored drivers — increase dataset size or check labels)")

    # ── 4. Classification report ──────────────────────────────────────
    print("\n  ── 1D CNN Classification Report ─────────────────────────")
    print(results["cnn"]["report"])

    # ── 5. Summary table ──────────────────────────────────────────────
    print("\n  ── Model Accuracy Summary ───────────────────────────────")
    rows_summary = [
        ("1D CNN  (Paper 3)",            results["cnn"]["acc"],  97.14),
        ("Random Forest (baseline)",     results["rf"]["acc"],   96.43),
        ("kNN Road Separator (Paper 1)", results["knn"]["acc"],  98.67),
        ("SVM Road Quality (Paper 2)",   results["svm"]["acc"],  88.05),
    ]
    print(f"  {'Model':<36} {'Ours (%)':>10}  {'Paper (%)':>10}")
    print("  " + "─" * 62)
    for name, ours, paper in rows_summary:
        print(f"  {name:<36} {ours * 100:>10.2f}  {paper:>10.2f}")

    # ── 6. Dashboard & Inferences ─────────────────────────────────────
    print("\n  Generating visualizations …")
    
    # 1. New inference verification plot
    inf_path = os.path.join(OUTPUT_DIR, "kinetiQ_test_inferences.png")
    
    # Update the first argument here!
    plot_test_inferences(results["X_te_cnn"], results["y_te"], results["y_pred_cnn"], results["classes"], save_path=inf_path)
    
    # 2. Main dashboard
    dash_path = os.path.join(OUTPUT_DIR, "kinetiQ_dashboard.png")
    plot_dashboard(df, results, scores_df, events_df, save_path=dash_path)

    # ── 7. Save CNN model ─────────────────────────────────────────────
    model_path = os.path.join(OUTPUT_DIR, "kinetiQ_cnn.keras")
    results["cnn"]["model"].save(model_path)
    print(f"  ✔  CNN model saved → {model_path}")

    print("\n" + "=" * 68)
    print("  KinetiQ pipeline complete.")
    print("=" * 68)
