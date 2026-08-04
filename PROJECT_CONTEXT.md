# Adaptly — Project Context

> **Purpose of this file:** onboarding context for any AI assistant or new developer joining this project. It records not just *what* was built, but *why* — including decisions made, alternatives rejected, and known gaps. Read this before making architectural changes.

---

## 1. Project Overview

**Adaptly — Adaptive Learning Coach for Academic and Corporate Education** (Final Year Project, Air University Islamabad).

A web application that monitors learner engagement in real time via webcam and adapts study content when the learner is struggling. Privacy-preserving: **no video is ever recorded, stored, or transmitted** — only numeric facial feature values leave the browser.

**Supervisor:** Dr. Sumera Hayat Khan
**Team:** 3 members (this repo is primarily driven by M Hassan Jamshaid)

### Two operating modes (NOT three parallel roles)
1. **Learner Mode** — individual learners
2. **Corporate Mode** — contains two sub-roles: **Employee** and **HR Admin**

This structure must be respected in all auth, routing, and schema work. The scope document describes "three profile types," but the implemented and agreed structure is two modes, with Corporate having two sub-roles.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React (Vite) |
| Backend | Python / FastAPI |
| Database | MongoDB Atlas (pymongo) |
| Auth | Firebase Authentication (Email/Password + Google) |
| ML Training | Google Colab (free T4 GPU), TensorFlow/Keras |
| CV | MediaPipe FaceLandmarker (Tasks API) |
| Head pose (rule gates) | OpenCV `solvePnP` (`opencv-python-headless`) |
| Repo | Monorepo: `frontend/` + `backend/` |

### Environment gotchas (learned the hard way)
- **`certifi` is required** for MongoDB Atlas on Windows — without `tlsCAFile=certifi.where()`, writes silently fail to appear in Atlas.
- **Windows clock drift causes Firebase 401s.** Error reads `Token used too early`. Fix: Settings → Time & Language → Sync now.
- **Never run `npm audit fix --force`** — it upgraded Vite to a version incompatible with the installed Node and broke the project early on.
- Backend venv must be activated per terminal session: `venv\Scripts\Activate.ps1` from `backend/`.
- `uvicorn app.main:app --reload` must be run from `backend/`, not from inside `app/`.
- Local scikit-learn version differs from Colab's — produces an `InconsistentVersionWarning` when loading the scaler. Harmless so far, but if predictions ever look wrong, pin matching versions.
- **Vite silently moves to port 5174, 5175… when 5173 is taken** (e.g. an orphaned dev server). This previously broke every API call with an opaque "Network Error" because CORS pinned a single origin. Fixed — see §4.
- **TensorFlow must not be imported at module load.** See §4 "Why backend startup was 20 seconds".

---

## 3. What Is Built (Current State)

### Module 1 — User Profile & Access Management ✅ Core complete
- Firebase auth (Email/Password + Google), registration with mode/role selection
- MongoDB user profiles: `uid`, `email`, `mode`, `corporate_role`, `accessibility_settings`, `created_at`
- Backend token verification via Firebase Admin SDK (`app/core/dependencies.py`)
- `ProtectedRoute` / `PublicRoute` guards with role/mode gating
- `AuthContext` with global auth + profile state, **retry-with-backoff** on profile fetch
- `DashboardLayout` shared navbar
- Accessibility settings: font size, contrast, dyslexia-friendly font (Lexend), applied live app-wide
- **Shared API client** (`frontend/src/api/client.js`) — single base URL from `VITE_API_URL`, auto-attaches the Firebase ID token

**Critical pattern:** `AuthContext.refreshProfile()` **must** be called explicitly after any action that changes the backend profile (e.g. after `POST /users/register`, `PUT /users/me`). Without this, `ProtectedRoute` reads a stale/null profile and wrongly redirects. This caused a real intermittent bug that took debugging to find. Both route guards check `loading` **and** `profile`, not just `currentUser`.

**Not built:** role-specific profile fields (session history, assigned manuals, Engagement Quality Scores, quiz results, HR dashboards). These are deliberately deferred — the data-producing modules don't exist yet, so building empty schema fields now would be premature.

### Module 2 — Content Processing 🔶 Mostly complete
Built and working:
- PDF upload (pypdf) → text extraction → chunking
- Plain text paste
- Website URL (requests + BeautifulSoup, strips nav/scripts/footer)
- YouTube URL (transcript via `youtube-transcript-api`) — **free**, uses existing captions only, does not transcribe audio
- Research paper PDF upload (PyMuPDF/fitz) — column-aware extraction, abstract detection, reference-section exclusion
- Content list endpoint + Learner dashboard listing

Built but dormant:
- Uploaded video file transcription (OpenAI Whisper API) — fully coded, returns `503` until `OPENAI_API_KEY` is set in `backend/.env`. Left inactive deliberately to avoid API costs during development.

Not built:
- Technical term / glossary detection at ingestion
- Language warning for Urdu / low-confidence transcription
- Content viewer (viewing full processed content) — **deliberately deferred**; will be built inside Study Session where content is read during monitoring, rather than as a throwaway standalone page

**Known unverified:** research-paper reference exclusion has only been partially confirmed. We verified that content *after* references (publisher notes) was captured, but did NOT confirm reference entries themselves (`[1] Smith et al...`) are excluded. Needs a direct chunk inspection.

### Module 3 — Real-Time Engagement Detection 🔶 Rule layer complete, tuning ongoing
Built and working:
- Full DAiSEE dataset preprocessing pipeline (Colab) — landmark extraction across 8,570 clips with disconnect-safe checkpointing
- Trained LSTM engagement classifier (9 features → 3 states)
- `POST /engagement/analyze` — accepts raw 478-point landmarks, extracts features server-side, predicts
- `POST /engagement/calibrate` — per-user baseline calibration; stores the feature offset **plus** a solvePnP pose baseline and a normalised brow baseline
- Frontend `StudySession.jsx` — live webcam, MediaPipe landmark extraction, 1 frame/sec, rolling 10-frame buffer, sends to backend
- Pre-session lighting check (canvas brightness sampling, warns below threshold)
- Face-presence gating — requires ≥7 of 10 frames with a detected face before trusting a prediction
- **Temporal smoothing layer** (`smoothing.py`) — confirmation-streak state machine, asymmetric thresholds
- **Fatigued detector** (`fatigue.py`) — sustained low eye-openness, gated on the user looking at the screen
- **Recovered detector** (`recovery.py`) — return to Focused after a sustained bad run
- **Deep Thinking detector** (`deep_thinking.py`) — stillness + head-down gate suppressing false disengagement
- **Brow-furrow measurement** (`furrow.py`) — advisory only, does not change state
- **`solvePnP` head pose** (`head_pose.py`) — used by the rule gates only, NOT by the model
- Pre-session instructions modal; camera does not start until dismissed
- Out-of-frame handling — enlarged camera view with a "move back into the frame" prompt, Face ID-style confirmation animation on return, and a recalibration prompt after a long absence

Not built:
- OneStop re-reading / comprehension regression classifier (separate ML sub-project, not started)
- WebSocket upgrade (spec calls for it; HTTP POST currently used)
- `solvePnP` for the **model's** features (needs a retrain — see §4)

### Modules 4–12 ⬜ Not started
Adaptive Intervention, AI Assistant, CV/AI Fusion Layer, Audio Generation, Session Analytics, HR Admin, Compliance Attestation, Document Intelligence, Employee Evaluation.

---

## 4. Key Decisions and Rationale

### Why 9 features instead of the 7 in the scope document
The scope document specifies 7 values: gaze X/Y, blink rate (EAR), head pitch/yaw/roll, eye openness.

**Problem discovered:** with only these 7, the model achieved **~1% recall on the "Struggling" class** — it essentially never detected struggling learners, which is the single most product-critical signal (it's what triggers intervention).

**Root cause:** all 7 specified features are eye- and head-based. Published research indicates confusion/frustration correlate with **eyebrow and mouth movement**, not gaze or head pose. A confused person can be looking directly at the screen with normal head position — indistinguishable from "Focused" under the original feature set.

**Fix:** added 2 eyebrow-derived features → `brow_raise` (eyebrow-to-eye distance) and `inter_brow` (inner eyebrow separation, a furrow proxy). Struggling recall improved from ~1% to 10–18%.

**Also tested and rejected:** an 11-feature version adding mouth features (`mouth_open`, `lip_compression`). It looked better on the Test set but was *inconsistent* across Test vs Validation (Struggling recall 10% vs 6%), while 9-feature was more consistent (10% vs 18%). **9-feature was adopted for consistency, not headline numbers.**

Feature order (must match everywhere — training, backend, and any future frontend extraction):
```
[gaze_x, gaze_y, blink_rate, pitch, yaw, roll, eye_openness, brow_raise, inter_brow]
```

Note: `eye_openness` and `blink_rate` are currently **the same EAR value** — a deliberate simplification, since we only have per-frame landmarks, not true blink-rate-over-time.

### Why 3 states instead of the 5 in the scope document
Scope specifies: Focused, Drifting, Struggling, Fatigued, Recovered.

- **Focused / Drifting / Struggling** — derived from DAiSEE's 4 native dimensions (Engagement, Boredom, Confusion, Frustration) via a mapping rule. These are model-predicted.
- **Fatigued** — DAiSEE has no fatigue dimension at all. Now implemented as rule-based logic (see below).
- **Recovered** — inherently relative ("came back from a bad state"), cannot come from a single static clip label. Now implemented as application logic comparing current state to recent history.

Current label mapping rule:
```python
if confusion >= 2 or frustration >= 2:  → Struggling
elif engagement <= 1 and boredom >= 2:  → Drifting
elif engagement >= 2:                    → Focused
else:                                    → Drifting
```

### Why a 10-second window instead of the specified 30-second window
DAiSEE clips are 10 seconds long. Training on a true 30-second window would require concatenating 3 separate clips, which aren't necessarily continuous recordings — creating artificial behavioral "seams" the model would learn as if they were real patterns.

**Decision:** keep the 10-second model (cleanly matches training data), and achieve the *intent* of the 30-second window (stability, not overreacting to single noisy moments) via an **application-layer smoothing layer**. **This is now built** — see below.

### The temporal smoothing layer (`smoothing.py`)
A confirmation-streak state machine: a candidate state must appear in N consecutive raw predictions before it becomes the displayed state.

**Thresholds are asymmetric by target state:**
| Target | Windows required | Why |
|---|---|---|
| Focused | 2 | fast recovery — a learner who is back should see it quickly |
| Drifting | 3 | |
| Struggling | 3 | weakest class (10–18% recall); false alarms are the costly error |

**Built on the backend, not the frontend**, so Modules 4 and 6 consume the smoothed state server-side rather than each re-implementing the logic. State is keyed by `(uid, session_id)`, held in memory, with a 30-minute TTL. The frontend generates a fresh `session_id` per mount and after every recalibration.

**Backward compatible:** a request without `session_id` returns exactly the old `{state, confidence}` shape.

**Honest caveat for the report:** consecutive windows overlap by 9 of their 10 frames, so "3 consecutive agreeing windows" is only **3 new frames** of independent evidence, not 30 seconds. This is genuine noise rejection but weaker than the phrase suggests.

**Correction to a previous claim in this file:** an earlier version of §9 stated that smoothing would "fix an observed responsiveness lag where recovering from Drifting → Focused takes ~10 seconds." **That was wrong.** The lag comes from the rolling 10-frame buffer — after a real behaviour change the buffer still holds 9 stale frames, taking ~10s to refresh. Smoothing can only *add* to that. The asymmetric policy limits the added cost on recovery to ~1s instead of ~2s, which is the best that layer can do. The lag is structural: the obvious fix (sampling faster) would compress each window to ~5s of real time and feed the model a temporal pattern unlike its 10-second training clips — the same class of train/deploy mismatch that made calibration necessary. **Accepted as a known characteristic, not a defect.**

### The Fatigued detector (`fatigue.py`)
Fires when the median eye-openness sits below `0.369 − 1.0 × 0.068 = 0.301` for ≥80% of the last 45 one-second windows. Grounded in DAiSEE's measured Focused distribution (mean 0.369, std 0.068).

Three deliberate properties:
- **Requires calibration.** Uncalibrated live EAR averages ~0.311 against a 0.301 threshold, so an uncalibrated user would trip it within seconds and the reading would be meaningless.
- **Median per window, not mean.** A blink drives EAR toward zero for a frame or two, and the route substitutes zero-vectors for leading frames before the first face detection. The ≥7-of-10 face gate means a median over 10 values cannot be dragged below the threshold by either effect (verified up to 3 zeroed frames).
- **Cannot fire in the first ~45s.** Fatigue is defined as a sustained condition, so a full history is required.

**Looking-down gate.** Looking down drops the eyelids over the eyes, lowering EAR exactly as tiredness does — so typing at a keyboard read as fatigue after ~45s even while actively working. Windows where the user is looking down are now **skipped entirely** rather than counted. This took three attempts; see the sign-convention note below.

### The Recovered detector (`recovery.py`)
Fires when the **smoothed** state has been Drifting or Struggling for ≥10 consecutive windows and then reaches Focused. Displays for 10 windows and expires; slipping back cancels it immediately.

Three deliberate choices:
1. **Consumes the smoothed state, not the raw prediction.** Raw predictions flip on single noisy frames, which would manufacture recoveries out of nothing. This makes the smoothing layer load-bearing for Recovered, not merely cosmetic.
2. **The bad run counts consecutive windows in *any* bad state.** Someone who drifts for 6 windows then struggles for 6 has genuinely been struggling for 12; splitting that into two short runs would miss an obvious recovery.
3. **Reflection windows don't count as a dip.** Deep Thinking is applied *before* recovery in the route, and recovery is fed the effective state — so a long reflection followed by Focused does not fire a false "Recovered". The learner never disengaged.

### The Deep Thinking detector (`deep_thinking.py`)
Per the scope document: a rule-based gate using sustained head-down posture, low blink variance, and stable gaze fixation. Fires only when the smoothed state is already Drifting or Struggling — when the model says Focused there is nothing to suppress.

**Its thresholds are the least trustworthy thing in Module 3.** Unlike fatigue, there is no published reference distribution for "stillness", so the constants were reasoned from feature scales rather than measured. Two rounds of guessing were both wrong. The endpoint now reports **each condition's pass/fail separately** (`dt_gaze_ok`, `dt_ear_ok`, `dt_pitch_ok`, `dt_state_ok`) so the blocking condition is visible rather than guessed at.

One threshold has since been corrected from live data: `EAR_VARIANCE_MAX` was `1e-4` against a measured 8.43e-4 while genuinely still — roughly 8× too strict to ever pass. Now `2e-3`. The gaze threshold (`5e-6` vs measured 1.40e-6) held up.

### The brow-furrow measurement (`furrow.py`) — reports only, does not change state
Furrowing is the clearest visible confusion signal but reads as Focused most of the time, consistent with 10–18% Struggling recall.

**Deliberately does NOT override the state.** Fatigued, Recovered and Deep Thinking are states the model *cannot* produce, so a rule is the only way to get them. **Struggling IS a model class.** A rule forcing Struggling would partly bypass the ML model on its most product-critical output, so it stays advisory until its threshold is set from real observations.

**Two bugs found and fixed here, both instructive:**
1. Requiring only `inter_brow` flagged a furrow while `brow_raise` read 1.11 — brows *further* from the eyes, the opposite of furrowing. Both ratios must now sit below baseline. (Caveat: squinting hard pushes `brow_raise` back up, so if genuine furrows stop registering, relax the `brow_raise` side.)
2. The features are **raw distances**, so they scale with apparent face size. Sitting ~8% further from the camera shrank `inter_brow` ~8% and crossed the threshold with **zero furrowing** — the cause of constant false positives. With the head merely tilted, `brow_raise` read **0.3806** (a 62% apparent collapse) purely from perspective. Now normalised by **inter-ocular distance**, making it invariant to viewing distance, and off-pose windows are rejected outright rather than reported.

### Why `solvePnP` is used for the rule gates but NOT for the model
The scope document specifies `solvePnP()` for head pitch/yaw/roll. The model uses a simplified geometric approximation `(nose_y − chin_y) × 100` instead.

**`solvePnP` cannot simply replace it.** `best_model_9f.keras` and `scaler_9f.pkl` were *trained* on the simplified values, and `focused_reference_means.json` (pitch −13.376) was computed from them. `solvePnP` returns real degrees on a completely different scale — the model would receive out-of-distribution inputs and predictions would degrade badly. That swap requires recomputing features across the dataset, regenerating the reference means, and retraining.

**It is used for the rule gates**, which are our own logic and carry no training-distribution baggage. Measured against synthetic ground truth:
- tilt accuracy: **exact** (0.00° error recovering a known 20° tilt)
- distance invariance: **exact** (identical pitch at 700 and 1600 units away)
- jaw-drop contamination: **~7°**

**Known limitation:** jaw drop still moves the estimate, because the chin is one of the six correspondence points and sits on the mandible. Chin-free point sets were tested and rejected — dropping the chin alone makes the geometry degenerate (`solvePnP` fails outright), and replacing it with inner eye corners requires 3D model coordinates that were not available; inventing them produced 9–140° errors. Normalised against each metric's own head-down response, `solvePnP` is still ~2× cleaner (**35%** contamination vs **68%** for the simplified estimate).

**Fallback behaviour:** the gates use `solvePnP` only when a pose baseline exists in the user's calibration record, otherwise they fall back to the simplified estimate. Users calibrated before this change keep working until they recalibrate.

### Head-pose sign conventions — measured, not reasoned (this went wrong twice)
This cost more debugging time than anything else in Module 3.

| Metric | Looking down | How established |
|---|---|---|
| Simplified `(nose_y − chin_y) × 100` | **pitch INCREASES** (measured +8.84 live) | live diagnostic readout |
| `solvePnP` pitch | **pitch DECREASES** (negative) | projecting the 3D model at known angles |

The original implementation assumed the simplified pitch went *negative* looking down, reasoning from this file's own note that live laptop users read −19.75 against a DAiSEE reference of −13.38. **That figure describes a difference in camera mounting between two datasets, not what happens when one person tilts their head.** Reusing it as a head-tilt convention was wrong, and the head-down gate was dead code that could never fire. Geometrically it is obvious in hindsight: tilting the head down foreshortens the lower face, shrinking the projected nose-to-chin distance.

**The two conventions are opposite**, so any future code touching head pose must be explicit about which metric it is using.

A related trap: **the unit tests encoded the same wrong assumption**, so they passed against the broken gate and 8 of them failed once the code was corrected. A test written from the same faulty reasoning as the code confirms the bug rather than catching it.

### Why per-user calibration exists (not in the original scope document)
**Discovered during live testing:** real laptop webcams are mounted above the screen, so a user looking normally at their screen registers as an extreme downward head angle by DAiSEE's standards.

Measured evidence:
- Live head pitch averaged **−19.75** vs DAiSEE's Focused mean of **−13.38** (std 2.57) → **~2.48 standard deviations off**
- Live EAR averaged **~0.311** vs DAiSEE's Focused mean **0.369** (std 0.068) → **~0.85 std off**

Result: normally-attentive users were consistently classified as Drifting/Struggling. This is classic train/deploy distribution shift, not a model quality problem.

**Fix:** at session start, capture the user's own baseline over ~10 frames, compute `offset = user_baseline − DAiSEE_focused_reference`, and subtract that offset from all subsequent live readings.

Calibration now stores **three** things, because the rule gates work in units the feature offset does not cover:
| Field | Units | Used by |
|---|---|---|
| `offset` | 9 features | model input correction |
| `pose_baseline` | solvePnP degrees | fatigue, deep thinking, furrow off-pose |
| `brow_baseline` | normalised brow ratios | furrow |

Reference values live in `backend/app/ml/focused_reference_means.json`.

**Known limitation:** calibration is captured once at session start. If a user significantly repositions their laptop mid-session, the baseline goes stale. A continuously-updating baseline was considered but deferred — it risks slowly absorbing genuine sustained disengagement into the baseline, making the system less sensitive over time. Mitigated by a **recalibration prompt** shown when the user returns after being out of frame for 5+ seconds. **Deliberately a prompt, not an automatic recalibration**, for the same reason.

**Multi-person testing caveat:** the offset is stored per `uid`. Several people testing under one login share one baseline — each must press Recalibrate, and two people's sessions cannot be compared retroactively since only the latest offset is stored.

### Why LSTM-on-engineered-features instead of CNN-on-raw-video
The scope document's architecture diagram implies a CNN backbone + LSTM. That design assumes raw pixel input, where a CNN's job is extracting facial structure from images.

**MediaPipe already does that job** — it outputs 478 precise landmark points directly. Re-learning "what a face looks like" from scratch with a CNN would need far more data and compute for no clear benefit. Feeding engineered features into an LSTM is a legitimate, research-supported alternative, and dramatically lighter to train and serve.

For reference, published end-to-end deep learning results on DAiSEE often land in the 46–58% range (InceptionNet 46.4%, C3D 56.1%, LRCN 57.9%) — several *below* our own first baseline, confirming the approach is sound.

### Why DAiSEE and not another dataset
Evaluated alternatives:
- **EmotiW / EngageWild** — better label quality and balance, but only 195 videos total (vs DAiSEE's 9,068). Trades a solvable imbalance problem for an unsolvable data-scarcity problem. **Rejected.**
- **CMOSE (2024)** — investigated in detail, including reading the CVPR workshop paper. It provides pre-extracted OpenFace Facial Action Units (genuinely useful) **but only has engagement-axis labels** (highly disengaged → highly engaged). It has **no Confusion or Frustration labels**, which is exactly what our hardest class (Struggling) is built from. **Rejected** — solves a problem we don't have, abandons the labels we need.

**Known caveat about DAiSEE:** its labels are crowdsourced and label quality has been questioned across multiple published studies. Some of the difficulty in distinguishing engagement states is a dataset-level issue affecting the entire research community, not specific to this implementation.

### Why CORS uses an origin regex, and why backend startup was 20 seconds
Two auth-blocking bugs found and fixed together.

**CORS.** The allowlist pinned `http://localhost:5173` exactly. Vite silently moves to 5174 when 5173 is occupied (an orphaned dev server does this), and the browser treats `localhost` and `127.0.0.1` as different origins. Either situation made every API call fail with an opaque axios "Network Error" that looked like a Firebase problem. Now `allow_origin_regex=r"^http://(localhost|127\.0\.0\.1):\d+$"` — **must be tightened to the real origin before deployment.**

**Startup.** `engagement_model.py` imported TensorFlow at module level, and it is reachable from `main.py`, so uvicorn did not accept connections for ~15–20 seconds after launch. A browser opened during that window got connection-refused, `AuthContext` set `profile = null`, and `ProtectedRoute` sat on "Loading profile…" forever because nothing retried. TensorFlow is now imported inside `load_engagement_model()`. **Measured: startup went from ~20s to 0.6s.**

Belt and braces, `AuthContext` now retries the profile fetch with backoff (0.5/1/2/3/4s) and distinguishes error kinds:
| Kind | Meaning | Behaviour |
|---|---|---|
| `no_profile` (404) | signed in, never registered | redirect to `/register` |
| `unauthorized` (401/403) | bad/expired token | redirect to `/login` |
| `unreachable` | backend down, CORS, timeout | retry, then a "Try again" screen |

Previously a bare `catch { setProfile(null) }` collapsed all four cases into one, which is precisely why a CORS problem presented as an unexplained hang.

**A related real bug this fixed:** Google sign-in auto-creates the Firebase account, but no Mongo profile exists, so `/users/me` returned 404 and `Login.jsx` displayed the raw error — stranding first-time Google users with no path to registration. Login no longer fetches the profile itself; routing flows through `PublicRoute`.

### Dataset inconsistency in the scope document (flag to supervisor)
- **Page 10** states the re-reading classifier uses the **OneStop Eye Movements** dataset.
- **Page 15 (Dataset Summary table)** states it uses **GazeCapture**.

These are different datasets. **OneStop is correct** — it directly measures regression rate (backward saccades) and includes repeated-reading regimes, exactly matching the spec's description of detecting "sudden leftward jump patterns." GazeCapture is a general screen-gaze-position dataset with **no reading task and no regression annotations** — it cannot do what page 10 describes. This appears to be an authoring error in the source document.

### Further scope-document issues found on re-read (flag to supervisor)
- **RAVDESS should be removed from the dataset table (p.15).** It is listed for *"voice analysis"*, but p.8 states the system *"does not support… voice emotion analysis"*, and p.4 sells this as an advantage over Gong (2025), which *"uses voice analysis which raises privacy concerns."* Module 5's voice input is Web Speech **transcription**, which needs no emotion dataset. RAVDESS has no role in this project as scoped.
- **"210 timesteps × 7 features" (p.9) is an arithmetic slip.** The same paragraph says seven values are extracted *every second*; 30 seconds at 1 Hz gives **30 timesteps × 7 features = 210 values**. The intended design is 30 timesteps at 1 Hz. **Our 1 Hz sampling therefore matches spec intent** — only the window length differs (10s vs 30s), which is justified above.
- **PyTorch vs TensorFlow.** The tools table (p.16) specifies PyTorch; the model was trained in TensorFlow/Keras. Cosmetic, but the document should be corrected.

### Can Module 6 fusion rescue detection accuracy? (analysis, not yet built)
The scope cites *"decision-level fusion… achieves 91% accuracy vs 72–78% for any single modality"* (p.6). **That figure comes from Gong (2025), which fused voice + video.** This project explicitly excludes voice analysis, so the number does not describe our architecture and should not be presented as a prediction of our results.

**Fusion multiplies confidence; it does not create information.** At 10–18% Struggling recall the CV model misses 82–90% of struggling episodes outright — on those, both modalities are silent and there is nothing to fuse. Worse, the chat signal only exists when the learner types, and the problem statement (p.5) itself notes that struggling learners are the least likely to ask for help. Chat coverage is therefore thinnest exactly where recall is weakest.

**What fusion genuinely buys is precision, not recall** — withholding an intervention when CV says Struggling but chat shows no confusion.

**Where recall could actually improve**, in order of value-for-effort:
1. **Dwell time** — already implied by Module 4's "multi-signal dwell-time and gaze fusion". Continuous, free, needs no ML, requires no user action. Ranks above chat fusion.
2. **Re-reading classifier (OneStop)** — genuinely independent and continuous, but p.14 caps it at paragraph level (webcam gaze is 2–3 cm vs 3–5 mm line spacing).
3. **Scroll / interaction behaviour** — free and continuous, not currently in the spec.

**A reframe worth acting on:** Module 4 delivers interventions *"without any sound, flash, or alert"*, inline with a small label. A false positive is therefore cheap, which inverts the usual tradeoff — the Struggling threshold could be deliberately lowered to buy recall, letting Module 6 filter. A missed struggling learner costs more than a redundant simplification.

---

## 5. Model Performance (Honest Numbers)

Current adopted model: **9-feature LSTM, 3 states.** Unchanged this session — no retraining was done.

| Metric | Test | Validation |
|---|---|---|
| Macro F1 | 0.351 | 0.387 |
| Focused recall | 77% | 74% |
| Drifting recall | 30% | 27% |
| Struggling recall | 10% | 18% |

**Important context for interpreting these numbers:**
- A trivial "always guess Focused" baseline scores **84.7% raw accuracy** on the test set. **Raw accuracy is therefore a misleading metric here** — the model must be judged on per-class recall / macro F1, not overall accuracy. **Never report accuracy as a headline figure in the FYP report.**
- Train/Test/Validation splits contain **zero subject overlap** (verified) — results reflect generalization to genuinely unseen people.
- The original DAiSEE paper's own benchmark was 51.07%.

**Known weakness:** Struggling detection remains weak (10–18% recall). This is a documented hard problem in published DAiSEE research, not a bug. It is partially mitigated architecturally: per the scope document, Module 6 (CV & AI Integration Layer) fuses engagement signal with chat signals before any intervention decision — but see the fusion analysis in §4 for why that helps precision more than recall.

**Not yet done for model rigor:** only one training run per configuration. Repeated runs / k-fold cross-validation would be needed to confirm the 9-feature advantage is statistically real rather than run-to-run noise.

---

## 6. Project Structure

```
Adaptly/
├── frontend/
│   ├── .env               (VITE_FIREBASE_*, VITE_API_URL — gitignored)
│   ├── .env.example       (committed template)
│   └── src/
│       ├── api/client.js  (shared axios instance + token interceptor)
│       ├── components/
│       ├── context/AuthContext.jsx
│       ├── firebase/config.js
│       ├── layouts/DashboardLayout.jsx
│       ├── pages/
│       │   ├── Login.jsx, Register.jsx
│       │   ├── LearnerDashboard.jsx, EmployeeDashboard.jsx, HRDashboard.jsx
│       │   ├── UploadContent.jsx
│       │   ├── AccessibilitySettings.jsx
│       │   └── StudySession.jsx
│       ├── routes/ProtectedRoute.jsx, PublicRoute.jsx
│       └── App.jsx, main.jsx
└── backend/
    ├── app/
    │   ├── core/       db.py, firebase.py, dependencies.py
    │   ├── ml/         engagement_model.py, feature_extraction.py, calibration.py,
    │   │               smoothing.py, fatigue.py, recovery.py, deep_thinking.py,
    │   │               furrow.py, head_pose.py,
    │   │               best_model_9f.keras, scaler_9f.pkl, focused_reference_means.json
    │   ├── models/     user_model.py, content_model.py
    │   ├── routes/     user_routes.py, content_routes.py, engagement_routes.py
    │   ├── services/   text_processing.py, research_paper_processing.py
    │   └── main.py
    ├── .env           (MONGO_URI, DB_NAME, OPENAI_API_KEY)
    └── requirements.txt
```

**Never commit:** `.env`, `venv/`, `node_modules/`, `firebase-service-account.json`.

**No test suite exists in the repo.** All verification this session was done with throwaway scripts in a scratchpad directory, which are now gone. See §9.

---

## 7. API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/health` | Health check |
| POST | `/users/register` | Create profile (query params: `mode`, `role`) |
| GET | `/users/me` | Get own profile |
| PUT | `/users/me` | Update profile (only `accessibility_settings` allowed) |
| POST | `/content/upload-pdf` | PDF upload |
| POST | `/content/upload-research-paper` | Research paper PDF (column-aware) |
| POST | `/content/paste-text` | Plain text |
| POST | `/content/from-url` | Website URL |
| POST | `/content/from-youtube` | YouTube transcript |
| POST | `/content/upload-video` | Video transcription (dormant, needs API key) |
| GET | `/content/list` | List user's content |
| POST | `/engagement/calibrate` | Capture per-user baselines (offset + pose + brow) |
| POST | `/engagement/analyze` | Predict engagement (expects exactly 10 frames) |

**Engagement request format** — frontend sends **raw landmarks**, backend does all feature extraction. This is deliberate: it keeps feature-extraction logic in exactly one place, avoiding silent drift between a JS and a Python implementation.

```json
{ "frames": [ { "landmarks": [[x,y,z], ...478 points] }, ...10 frames ],
  "session_id": "uuid-per-session (optional)" }
```
`landmarks` may be `null` for frames where no face was detected.

**Response — without `session_id`** (unchanged legacy shape, verified):
```json
{ "state": "Focused", "confidence": 0.4186 }
```

**Response — with `session_id`** (all rule layers active):
```json
{ "state": "Focused", "raw_state": "Focused", "confidence": 0.4186,
  "stable": true, "streak": 1, "required": 2,
  "fatigued": false, "fatigue_ratio": 0.29, "fatigue_available": true,
  "fatigue_head_down": false, "fatigue_pitch_delta": 8.84,
  "fatigue_gaze_delta": -0.0036, "fatigue_pose_pitch": -1.2,
  "recovered": false, "recovery_remaining": 0,
  "deep_thinking": false, "dt_available": true,
  "dt_gaze_var": 1.4e-6, "dt_ear_var": 8.43e-4, "dt_pitch_delta": 7.39,
  "dt_gaze_ok": true, "dt_ear_ok": true, "dt_pitch_ok": false, "dt_state_ok": false,
  "furrowed": false, "furrow_available": true,
  "furrow_ratio": 1.0, "furrow_brow_ratio": 1.0, "furrow_off_pose": false }
```

**UI precedence:** Fatigued > Deep Thinking > Recovered > model state. The underlying model state is always retained and shown alongside. `furrowed` never changes the displayed state.

---

## 8. Working Conventions

- **Build one small piece at a time; verify before scaling.** This pattern caught several real bugs early (e.g. testing landmark extraction on 1 video before running 8,570).
- **Checkpoint long-running work.** Colab disconnects unpredictably; every long pipeline saves incrementally and skips already-done work on rerun.
- **Verify against the scope document, don't trust recall.** Multiple real gaps (the Deep Thinking detector, the WebSocket requirement, the GazeCapture/OneStop inconsistency, the RAVDESS contradiction) were only found by re-reading the source document directly.
- **Never judge an imbalanced classifier by raw accuracy.** Always produce a confusion matrix and per-class recall.
- **Don't guess at external facts** (dataset URLs, library APIs, file structures) — verify them. This session added a case: inventing 3D anthropometric coordinates for `solvePnP` produced 9–140° errors and was correctly abandoned.
- **Measure sign conventions and thresholds; do not reason about them.** Two rounds of guessing Deep Thinking's thresholds were both wrong, and a head-pose sign was inverted for three iterations. What finally worked was surfacing live per-condition diagnostics in the UI and projecting a known 3D rotation to check what came back.
- **A test written from the same assumption as the code confirms the bug.** Eight tests passed against a dead code path and only failed once the code was fixed.
- **Don't add a second unvalidated condition to fix a first unvalidated one.** A gaze-direction gate was added to patch a broken pitch gate; the real problem was the pitch sign, and the gaze gate was later removed.

---

## 9. Immediate Next Tasks

**Module 3 — tuning and confirmation (highest priority):**
1. **Tune Deep Thinking's remaining thresholds from live readings.** `EAR_VARIANCE_MAX` is now measured; the gaze threshold and `PITCH_DOWN_DEGREES` are still estimates. Use the per-condition red/green diagnostics.
2. **Confirm Recovered fires on a real face.** Unit-verified (15/15) but **never once observed live.**
3. **Confirm Deep Thinking fires on a real face.** Never observed firing.
4. **Decide whether furrow should override Struggling.** Currently advisory only, by design — needs relaxed-vs-furrowed numbers before enabling.
5. **WebSocket upgrade** — recommended *before* Modules 4–12, because those consume the engagement stream and the per-session in-memory state maps naturally onto a connection. Roughly a day's work vs weeks for OneStop, so it is not a real trade-off.
6. **`solvePnP` for the model's features + retrain.** Requires recomputing features across the dataset, regenerating `focused_reference_means.json`, and a full retrain. Do it in the next training run so both land together.
7. **OneStop re-reading classifier** — separate ML sub-project, comparable in scope to the DAiSEE work. **If data access needs an application, start that now** — lead time is dead time.

**Engineering debt discovered this session:**
8. **No test suite exists.** Five verification suites (smoothing, fatigue+furrow, recovery, deep thinking, head pose) were written and all passed, but they lived in a scratchpad and are gone. Nothing protects the response shape or the thresholds from regression. Re-creating them under `backend/tests/` is a few hours and high value.
9. **All rule state is in-memory**, keyed by `(uid, session_id)` with a 30-minute TTL. It dies on server restart and **breaks under multiple uvicorn workers.** Fine for single-worker dev; must be revisited before any real deployment.
10. **CORS is wide open to any localhost port.** Tighten to the real origin before deployment.
11. **The content viewer must not place text in the lower screen area** — looking down lowers EAR and reads as closed eyes. This is a physical limit of EAR-based sensing, mitigated by layout rather than by tuning.
12. **Add dwell time as a struggle signal** when the content viewer is built — highest value-for-effort recall improvement available (see §4).

**Module 2 (smaller gaps):**
13. Technical term / glossary detection at ingestion (term identification is free; definition generation needs an LLM key).
14. Language warning for Urdu / low-confidence transcription.
15. Verify research-paper reference exclusion actually works.

**Scope document corrections to raise with the supervisor:**
16. Remove RAVDESS from the dataset table; correct GazeCapture → OneStop; fix the "210 timesteps" arithmetic; correct PyTorch → TensorFlow; stop citing the 91% fusion figure as a prediction for this architecture.

**Then:** Modules 4–12.

---

## 10. Session Log — What Was Confirmed Live

Recorded because unit tests and live behaviour diverged repeatedly this session.

**Confirmed working on a real face:**
- Focused while looking at the screen; Drifting while looking away
- Fatigued on genuinely drooping/closed eyes
- Looking at the keyboard now reports `looking down, window skipped` and stops accumulating fatigue — **this was broken through three iterations and is the main fix of the session**
- Temporal smoothing (no flip on a single stray prediction)
- The StrictMode double-capture fix (frames arrive at 1/sec, not ~2/sec)
- Instructions modal, Calibrate disable-while-running, login via email/password and Google

**Unit-verified but NEVER observed live:**
- Recovered
- Deep Thinking

**Known to still misbehave:**
- Struggling via brow furrow fires only occasionally — expected at 10–18% recall, not a bug
- Struggling via open mouth fires reliably but **for the wrong reason**: jaw drop corrupts the simplified pitch estimate. Usable for a demo; must not be described as confusion detection.

**Not committed:** at the time of writing, all of this session's work is **uncommitted on `main`**. A branch `module3-rules(cl)` exists at the same commit but was never checked out — note the literal parentheses in the branch name, almost certainly a typo worth renaming.
