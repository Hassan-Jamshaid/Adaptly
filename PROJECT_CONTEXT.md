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
| Repo | Monorepo: `frontend/` + `backend/` |

### Environment gotchas (learned the hard way)
- **`certifi` is required** for MongoDB Atlas on Windows — without `tlsCAFile=certifi.where()`, writes silently fail to appear in Atlas.
- **Windows clock drift causes Firebase 401s.** Error reads `Token used too early`. Fix: Settings → Time & Language → Sync now.
- **Never run `npm audit fix --force`** — it upgraded Vite to a version incompatible with the installed Node and broke the project early on.
- Backend venv must be activated per terminal session: `venv\Scripts\Activate.ps1` from `backend/`.
- `uvicorn app.main:app --reload` must be run from `backend/`, not from inside `app/`.
- Local scikit-learn version differs from Colab's — produces an `InconsistentVersionWarning` when loading the scaler. Harmless so far, but if predictions ever look wrong, pin matching versions.

---

## 3. What Is Built (Current State)

### Module 1 — User Profile & Access Management ✅ Core complete
- Firebase auth (Email/Password + Google), registration with mode/role selection
- MongoDB user profiles: `uid`, `email`, `mode`, `corporate_role`, `accessibility_settings`, `created_at`
- Backend token verification via Firebase Admin SDK (`app/core/dependencies.py`)
- `ProtectedRoute` / `PublicRoute` guards with role/mode gating
- `AuthContext` with global auth + profile state
- `DashboardLayout` shared navbar
- Accessibility settings: font size, contrast, dyslexia-friendly font (Lexend), applied live app-wide

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

### Module 3 — Real-Time Engagement Detection 🔶 Core loop working end-to-end
Built and working:
- Full DAiSEE dataset preprocessing pipeline (Colab) — landmark extraction across 8,570 clips with disconnect-safe checkpointing
- Trained LSTM engagement classifier (9 features → 3 states)
- `POST /engagement/analyze` — accepts raw 478-point landmarks, extracts features server-side, predicts
- `POST /engagement/calibrate` — per-user baseline calibration, offset stored in MongoDB `calibration` collection
- Frontend `StudySession.jsx` — live webcam, MediaPipe landmark extraction, 1 frame/sec, rolling 10-frame buffer, sends to backend
- Pre-session lighting check (canvas brightness sampling, warns below threshold)
- Face-presence gating — requires ≥7 of 10 frames with a detected face before trusting a prediction

Not built:
- Temporal smoothing layer (2–3 consecutive window agreement)
- Fatigued detector (rule-based)
- Recovered detector (rule-based)
- Deep Thinking detector (rule-based — prevents false disengagement alarms during genuine reflection)
- OneStop re-reading / comprehension regression classifier (separate ML sub-project, not started)
- WebSocket upgrade (spec calls for it; HTTP POST currently used)

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
- **Fatigued** — DAiSEE has no fatigue dimension at all. Planned as rule-based logic (sustained low eye-openness).
- **Recovered** — inherently relative ("came back from a bad state"), cannot come from a single static clip label. Planned as application logic comparing current state to recent history.

Current label mapping rule:
```python
if confusion >= 2 or frustration >= 2:  → Struggling
elif engagement <= 1 and boredom >= 2:  → Drifting
elif engagement >= 2:                    → Focused
else:                                    → Drifting
```

### Why a 10-second window instead of the specified 30-second window
DAiSEE clips are 10 seconds long. Training on a true 30-second window would require concatenating 3 separate clips, which aren't necessarily continuous recordings — creating artificial behavioral "seams" the model would learn as if they were real patterns.

**Decision:** keep the 10-second model (cleanly matches training data), and achieve the *intent* of the 30-second window (stability, not overreacting to single noisy moments) via an **application-layer smoothing layer** — require 2–3 consecutive agreeing windows before displaying a state change. **This smoothing layer is not yet built.**

### Why simplified head pose instead of OpenCV solvePnP()
The scope document specifies `solvePnP()`. We use a simplified geometric approximation (nose position relative to chin and eye corners). This is cruder. It works but is a known, documented deviation — replacing it with true `solvePnP()` remains an option for closer spec alignment.

### Why per-user calibration exists (not in the original scope document)
**Discovered during live testing:** real laptop webcams are mounted above the screen, so a user looking normally at their screen registers as an extreme downward head angle by DAiSEE's standards.

Measured evidence:
- Live head pitch averaged **−19.75** vs DAiSEE's Focused mean of **−13.38** (std 2.57) → **~2.48 standard deviations off**
- Live EAR averaged **~0.311** vs DAiSEE's Focused mean **0.369** (std 0.068) → **~0.85 std off**

Result: normally-attentive users were consistently classified as Drifting/Struggling. This is classic train/deploy distribution shift, not a model quality problem.

**Fix:** at session start, capture the user's own baseline over ~10 frames, compute `offset = user_baseline − DAiSEE_focused_reference`, and subtract that offset from all subsequent live readings. This self-corrects per user, per camera angle, per setup — no assumptions about laptop position needed.

Reference values live in `backend/app/ml/focused_reference_means.json`.

**Known limitation:** calibration is captured once at session start. If a user significantly repositions their laptop mid-session, the baseline goes stale. A continuously-updating baseline was considered but deferred — it risks slowly absorbing genuine sustained disengagement into the baseline, making the system less sensitive over time.

### Why LSTM-on-engineered-features instead of CNN-on-raw-video
The scope document's architecture diagram implies a CNN backbone + LSTM. That design assumes raw pixel input, where a CNN's job is extracting facial structure from images.

**MediaPipe already does that job** — it outputs 478 precise landmark points directly. Re-learning "what a face looks like" from scratch with a CNN would need far more data and compute for no clear benefit. Feeding engineered features into an LSTM is a legitimate, research-supported alternative, and dramatically lighter to train and serve.

For reference, published end-to-end deep learning results on DAiSEE often land in the 46–58% range (InceptionNet 46.4%, C3D 56.1%, LRCN 57.9%) — several *below* our own first baseline, confirming the approach is sound.

### Why DAiSEE and not another dataset
Evaluated alternatives:
- **EmotiW / EngageWild** — better label quality and balance, but only 195 videos total (vs DAiSEE's 9,068). Trades a solvable imbalance problem for an unsolvable data-scarcity problem. **Rejected.**
- **CMOSE (2024)** — investigated in detail, including reading the CVPR workshop paper. It provides pre-extracted OpenFace Facial Action Units (genuinely useful) **but only has engagement-axis labels** (highly disengaged → highly engaged). It has **no Confusion or Frustration labels**, which is exactly what our hardest class (Struggling) is built from. **Rejected** — solves a problem we don't have, abandons the labels we need.

**Known caveat about DAiSEE:** its labels are crowdsourced and label quality has been questioned across multiple published studies. Some of the difficulty in distinguishing engagement states is a dataset-level issue affecting the entire research community, not specific to this implementation.

### Dataset inconsistency in the scope document (flag to supervisor)
- **Page 10** states the re-reading classifier uses the **OneStop Eye Movements** dataset.
- **Page 15 (Dataset Summary table)** states it uses **GazeCapture**.

These are different datasets. **OneStop is correct** — it directly measures regression rate (backward saccades) and includes repeated-reading regimes, exactly matching the spec's description of detecting "sudden leftward jump patterns." GazeCapture is a general screen-gaze-position dataset with **no reading task and no regression annotations** — it cannot do what page 10 describes. This appears to be an authoring error in the source document.

---

## 5. Model Performance (Honest Numbers)

Current adopted model: **9-feature LSTM, 3 states.**

| Metric | Test | Validation |
|---|---|---|
| Macro F1 | 0.351 | 0.387 |
| Focused recall | 77% | 74% |
| Drifting recall | 30% | 27% |
| Struggling recall | 10% | 18% |

**Important context for interpreting these numbers:**
- A trivial "always guess Focused" baseline scores **84.7% raw accuracy** on the test set. **Raw accuracy is therefore a misleading metric here** — the model must be judged on per-class recall / macro F1, not overall accuracy.
- Train/Test/Validation splits contain **zero subject overlap** (verified) — results reflect generalization to genuinely unseen people.
- The original DAiSEE paper's own benchmark was 51.07%.

**Known weakness:** Struggling detection remains weak (10–18% recall). This is a documented hard problem in published DAiSEE research, not a bug. It is partially mitigated architecturally: per the scope document, Module 6 (CV & AI Integration Layer) fuses engagement signal with chat signals before any intervention decision — so a single wrong prediction does not directly cause a bad user experience.

**Not yet done for model rigor:** only one training run per configuration. Repeated runs / k-fold cross-validation would be needed to confirm the 9-feature advantage is statistically real rather than run-to-run noise.

---

## 6. Project Structure

```
Adaptly/
├── frontend/
│   └── src/
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
    │   │               best_model_9f.keras, scaler_9f.pkl, focused_reference_means.json
    │   ├── models/     user_model.py, content_model.py
    │   ├── routes/     user_routes.py, content_routes.py, engagement_routes.py
    │   ├── services/   text_processing.py, research_paper_processing.py
    │   └── main.py
    ├── .env           (MONGO_URI, DB_NAME, OPENAI_API_KEY)
    └── requirements.txt
```

**Never commit:** `.env`, `venv/`, `node_modules/`, `firebase-service-account.json`.

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
| POST | `/engagement/calibrate` | Capture per-user baseline |
| POST | `/engagement/analyze` | Predict engagement (expects exactly 10 frames) |

**Engagement request format** — frontend sends **raw landmarks**, backend does all feature extraction. This is deliberate: it keeps feature-extraction logic in exactly one place, avoiding silent drift between a JS and a Python implementation.

```json
{ "frames": [ { "landmarks": [[x,y,z], ...478 points] }, ...10 frames ] }
```
`landmarks` may be `null` for frames where no face was detected.

---

## 8. Working Conventions

- **Build one small piece at a time; verify before scaling.** This pattern caught several real bugs early (e.g. testing landmark extraction on 1 video before running 8,570).
- **Checkpoint long-running work.** Colab disconnects unpredictably; every long pipeline saves incrementally and skips already-done work on rerun.
- **Verify against the scope document, don't trust recall.** Multiple real gaps (the Deep Thinking detector, the WebSocket requirement, the GazeCapture/OneStop inconsistency) were only found by re-reading the source document directly.
- **Never judge an imbalanced classifier by raw accuracy.** Always produce a confusion matrix and per-class recall.
- **Don't guess at external facts** (dataset URLs, library APIs, file structures) — verify them.

---

## 9. Immediate Next Tasks

**Module 3 (highest priority — completes the core loop):**
1. Temporal smoothing layer — require 2–3 consecutive agreeing windows before displaying a state change. Also fixes an observed responsiveness lag where recovering from Drifting → Focused takes ~10 seconds.
2. Fatigued detector — rule-based, sustained low eye-openness relative to the user's calibrated baseline.
3. Recovered detector — rule-based, compares current state to recent state history.
4. Deep Thinking detector — rule-based gate using sustained head-down posture + low blink variance + stable gaze fixation, to suppress false disengagement triggers during genuine reflection.
5. WebSocket upgrade for live streaming (replaces the current HTTP POST approach).
6. OneStop re-reading classifier — separate ML sub-project, comparable in scope to the DAiSEE work.

**Module 2 (smaller gaps):**
7. Technical term / glossary detection at ingestion (term identification is free; definition generation needs an LLM key).
8. Language warning for Urdu / low-confidence transcription.
9. Verify research-paper reference exclusion actually works.

**Then:** Modules 4–12.
