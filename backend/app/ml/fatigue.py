"""
Rule-based Fatigued detector.

DAiSEE has no fatigue dimension, so Fatigued cannot be a model class (see
PROJECT_CONTEXT section 4). It is derived here instead: sustained low eye
openness relative to the user's own calibrated baseline.

How the threshold is grounded
-----------------------------
`eye_openness` is the mean eye-aspect-ratio of both eyes. DAiSEE's Focused
population sits at mean 0.369, std 0.068. Calibration rebases each user onto
that scale (offset = user_baseline - reference), so after calibration a value
near 0.369 means "as open-eyed as an alert DAiSEE subject" and drifting below
it means this particular person's eyes are drooping relative to their own
alert baseline.

This only holds for calibrated users. Uncalibrated live EAR averages ~0.311
(section 4), which sits barely above the threshold — so an uncalibrated user
would trip the rule almost immediately. `update()` therefore refuses to run
without calibration rather than reporting a meaningless answer.

Blink robustness
----------------
Each window's value is the MEDIAN of its 10 frames, not the mean. A blink
drives EAR toward zero for a frame or two, and the route also substitutes
zero-vectors for any leading frames captured before the first face detection.
The frontend guarantees at least 7 of 10 frames contain a real face, so a
median over 10 values cannot be dragged below the threshold by either effect.
"""

import json
import os
import time

ML_DIR = os.path.dirname(__file__)

EYE_OPENNESS_INDEX = 6  # [gaze_x, gaze_y, blink_rate, pitch, yaw, roll, eye_openness, ...]

# DAiSEE Focused std for eye_openness. The reference-means JSON stores means
# only, so this is recorded here from the same measurement (PROJECT_CONTEXT
# section 4). If a stds file is ever added, load it from there instead.
REFERENCE_STD = 0.068
K_STD = 1.0

HISTORY_WINDOWS = 45   # ~45 seconds at one window per second
MIN_LOW_RATIO = 0.8    # fraction of the history that must be below threshold

SESSION_TTL_SECONDS = 1800

# (uid, session_id) -> {"values": [...], "last_seen": float}
_sessions = {}

_threshold = None


def get_threshold() -> float:
    """Eye-openness level below which a window counts as 'drooping'."""
    global _threshold
    if _threshold is None:
        with open(os.path.join(ML_DIR, "focused_reference_means.json"), "r") as f:
            reference_mean = json.load(f)["eye_openness"]
        _threshold = reference_mean - K_STD * REFERENCE_STD
    return _threshold


def _median(values: list) -> float:
    ordered = sorted(values)
    n = len(ordered)
    mid = n // 2
    if n % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2.0


def _evict_stale(now: float) -> None:
    stale = [key for key, s in _sessions.items() if now - s["last_seen"] > SESSION_TTL_SECONDS]
    for key in stale:
        del _sessions[key]


def update(uid: str, session_id: str, feature_sequence: list, calibrated: bool) -> dict:
    """
    feature_sequence: the 10 calibration-corrected frames for this window.

    Returns the fatigue verdict for the session so far. `fatigued` stays False
    until a full HISTORY_WINDOWS of evidence exists — fatigue is defined as a
    sustained condition, so it deliberately cannot fire in the first ~45s.
    """
    if not calibrated:
        return {
            "fatigued": False,
            "fatigue_ratio": None,
            "fatigue_available": False,
        }

    now = time.time()
    _evict_stale(now)

    key = (uid, session_id)
    session = _sessions.setdefault(key, {"values": [], "last_seen": now})
    session["last_seen"] = now

    window_value = _median([frame[EYE_OPENNESS_INDEX] for frame in feature_sequence])
    session["values"].append(window_value)
    if len(session["values"]) > HISTORY_WINDOWS:
        session["values"].pop(0)

    values = session["values"]
    threshold = get_threshold()
    low = sum(1 for v in values if v < threshold)
    ratio = low / len(values)

    return {
        "fatigued": len(values) >= HISTORY_WINDOWS and ratio >= MIN_LOW_RATIO,
        "fatigue_ratio": round(ratio, 3),
        "fatigue_available": True,
    }


def reset(uid: str, session_id: str) -> None:
    """Drop a session's fatigue history (session end, or after recalibration)."""
    _sessions.pop((uid, session_id), None)
