"""
Rule-based Deep Thinking detector.

Purpose: suppress false disengagement alarms during genuine reflection. A
learner who is thinking hard about a difficult passage looks, to the model,
much like a learner who has checked out — head down, not much movement. The
scope document's proposed discriminator is that reflection is *still* in a
specific way: sustained head-down posture, low blink variance, and stable gaze
fixation, whereas drifting attention wanders.

THRESHOLDS HERE ARE UNVALIDATED PLACEHOLDERS
--------------------------------------------
Unlike the fatigue rule, which is grounded in a measured DAiSEE distribution
(eye_openness mean 0.369, std 0.068), there is no reference distribution for
"stillness". The three constants below were chosen by reasoning about the
feature scales, NOT from data, and they are expected to need tuning against
live readings before this rule can be trusted. The route surfaces the measured
values on every window so they can be tuned by observation.

Treat a firing of this rule as a hypothesis until the constants are tuned.

Sign convention for pitch
-------------------------
`pitch` comes from a deliberately crude geometric approximation, not
solvePnP (PROJECT_CONTEXT section 4), so its sign is taken from measured
evidence rather than derived: section 4 records live users looking down at a
laptop screen at -19.75 against a DAiSEE Focused reference of -13.38. Looking
further down therefore makes pitch MORE NEGATIVE, so "head down relative to
this user's own calibrated baseline" is a negative delta.

Requires calibration for the same reason the fatigue rule does: the pitch
comparison is only meaningful once the user's own baseline has been mapped
onto the DAiSEE reference scale.
"""

import json
import os
import statistics
import time

ML_DIR = os.path.dirname(__file__)

GAZE_X_INDEX = 0
GAZE_Y_INDEX = 1
BLINK_RATE_INDEX = 2  # same EAR value as eye_openness — see section 4
PITCH_INDEX = 3

BAD_STATES = ("Drifting", "Struggling")

HISTORY_WINDOWS = 15  # ~15s of sustained stillness before reflection is credited

# --- placeholder constants, tune against the live readout ---------------------
GAZE_VARIANCE_MAX = 5e-6   # combined gaze_x + gaze_y variance
EAR_VARIANCE_MAX = 1e-4    # variance of per-window median EAR
PITCH_DOWN_DELTA = -3.0    # calibrated pitch must sit this far below reference
# ------------------------------------------------------------------------------

SESSION_TTL_SECONDS = 1800

# (uid, session_id) -> {"gx": [...], "gy": [...], "ear": [...], "pitch": [...], "last_seen": float}
_sessions = {}

_reference_pitch = None


def get_reference_pitch() -> float:
    global _reference_pitch
    if _reference_pitch is None:
        with open(os.path.join(ML_DIR, "focused_reference_means.json"), "r") as f:
            _reference_pitch = json.load(f)["pitch"]
    return _reference_pitch


def _evict_stale(now: float) -> None:
    stale = [key for key, s in _sessions.items() if now - s["last_seen"] > SESSION_TTL_SECONDS]
    for key in stale:
        del _sessions[key]


def _unavailable() -> dict:
    return {
        "deep_thinking": False,
        "dt_available": False,
        "dt_gaze_var": None,
        "dt_ear_var": None,
        "dt_pitch_delta": None,
    }


def update(uid: str, session_id: str, feature_sequence: list,
           display_state: str, calibrated: bool) -> dict:
    """
    feature_sequence: the 10 calibration-corrected frames for this window.
    display_state:    the SMOOTHED state, so the override reflects a confirmed
                      disengagement rather than a single noisy prediction.

    The stillness metrics are reported on every window (so they can be tuned),
    but `deep_thinking` only becomes True when the model is actually reporting
    disengagement — there is nothing to suppress otherwise.
    """
    if not calibrated:
        return _unavailable()

    now = time.time()
    _evict_stale(now)

    key = (uid, session_id)
    session = _sessions.setdefault(
        key, {"gx": [], "gy": [], "ear": [], "pitch": [], "last_seen": now}
    )
    session["last_seen"] = now

    # median across the 10 frames, for the same blink/zero-frame robustness
    # reasons documented in fatigue.py
    session["gx"].append(statistics.median([f[GAZE_X_INDEX] for f in feature_sequence]))
    session["gy"].append(statistics.median([f[GAZE_Y_INDEX] for f in feature_sequence]))
    session["ear"].append(statistics.median([f[BLINK_RATE_INDEX] for f in feature_sequence]))
    session["pitch"].append(statistics.median([f[PITCH_INDEX] for f in feature_sequence]))

    for series in ("gx", "gy", "ear", "pitch"):
        if len(session[series]) > HISTORY_WINDOWS:
            session[series].pop(0)

    if len(session["gx"]) < HISTORY_WINDOWS:
        return _unavailable()

    gaze_var = statistics.pvariance(session["gx"]) + statistics.pvariance(session["gy"])
    ear_var = statistics.pvariance(session["ear"])
    pitch_delta = statistics.fmean(session["pitch"]) - get_reference_pitch()

    still = (
        gaze_var <= GAZE_VARIANCE_MAX
        and ear_var <= EAR_VARIANCE_MAX
        and pitch_delta <= PITCH_DOWN_DELTA
    )

    return {
        "deep_thinking": still and display_state in BAD_STATES,
        "dt_available": True,
        "dt_gaze_var": gaze_var,
        "dt_ear_var": ear_var,
        "dt_pitch_delta": round(pitch_delta, 2),
    }


def reset(uid: str, session_id: str) -> None:
    """Drop a session's stillness history (session end, or after recalibration)."""
    _sessions.pop((uid, session_id), None)
