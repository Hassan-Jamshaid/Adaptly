import { useRef, useEffect, useState } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import axios from "axios";
import { auth } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import DashboardLayout from "../layouts/DashboardLayout";

function newSessionId() {
  return crypto.randomUUID?.() ?? `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function StudySession() {
  const { profile } = useAuth();
  const videoRef = useRef(null);
  const landmarkerRef = useRef(null);
  const frameBufferRef = useRef([]);
  const sessionIdRef = useRef(null);
  const calibrateRef = useRef(null);

  const [sessionStarted, setSessionStarted] = useState(false);
  const [cameraStatus, setCameraStatus] = useState("Waiting to start...");
  const [faceDetected, setFaceDetected] = useState(false);
  const [prediction, setPrediction] = useState(null);
  const [framesCollected, setFramesCollected] = useState(0);
  const [lightingWarning, setLightingWarning] = useState(null);
  const [ready, setReady] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [calibrated, setCalibrated] = useState(false);
  const [calibrationError, setCalibrationError] = useState(null);

  // One id per session, used by the backend to key its smoothing state.
  // Must be a ref so it survives re-renders and the StrictMode remount.
  if (sessionIdRef.current === null) {
    sessionIdRef.current = newSessionId();
  }

  const highContrast = profile?.accessibility_settings?.contrast === "high";

  useEffect(() => {
    // Camera does not start until the user dismisses the instructions modal.
    if (!sessionStarted) return;

    // Guards against the StrictMode double-invoke: setup() is async, so the
    // effect can be torn down while it is still in flight. Without these, the
    // first run's interval/rAF/stream keep running alongside the second run's.
    let cancelled = false;
    let stream = null;
    let rafId = null;
    let captureTimer = null;
    let lightingTimer = null;

    async function setup() {
      try {
        setCameraStatus("Requesting camera access...");
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setCameraStatus("Camera active");
        }

        lightingTimer = setTimeout(checkLighting, 1000); // give camera a moment to stabilize

        const filesetResolver = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
        );
        if (cancelled) return;

        const landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numFaces: 1,
        });
        // don't let a cancelled run clobber the live landmarker
        if (cancelled) {
          try { landmarker.close?.(); } catch { /* ignore */ }
          return;
        }
        landmarkerRef.current = landmarker;

        calibrateRef.current = calibrate;
        setReady(true);

        detectLoop();
        captureTimer = setInterval(captureFrame, 1000);
      } catch (err) {
        if (!cancelled) setCameraStatus("Setup error: " + err.message);
      }
    }

    function detectLoop() {
      if (cancelled) return;
      if (videoRef.current && landmarkerRef.current && videoRef.current.readyState >= 2) {
        const results = landmarkerRef.current.detectForVideo(videoRef.current, performance.now());
        setFaceDetected(results.faceLandmarks && results.faceLandmarks.length > 0);
      }
      rafId = requestAnimationFrame(detectLoop);
    }

    function checkLighting() {
      if (cancelled || !videoRef.current) return;
      const canvas = document.createElement("canvas");
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(videoRef.current, 0, 0);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);

      let total = 0;
      for (let i = 0; i < frame.data.length; i += 4) {
        total += (frame.data[i] + frame.data[i + 1] + frame.data[i + 2]) / 3;
      }
      const avgBrightness = total / (frame.data.length / 4);

      if (avgBrightness < 60) {
        setLightingWarning("Lighting seems low — consider a brighter room for accurate detection.");
      } else {
        setLightingWarning(null);
      }
    }

    function captureFrame() {
      if (cancelled || !videoRef.current || !landmarkerRef.current) return;
      const results = landmarkerRef.current.detectForVideo(videoRef.current, performance.now());

      let landmarkArray = null;
      if (results.faceLandmarks && results.faceLandmarks.length > 0) {
        landmarkArray = results.faceLandmarks[0].map((p) => [p.x, p.y, p.z]);
      }

      frameBufferRef.current.push(landmarkArray);
      if (frameBufferRef.current.length > 10) {
        frameBufferRef.current.shift();
      }
      setFramesCollected(frameBufferRef.current.length);

      if (frameBufferRef.current.length === 10) {
        const validFrames = frameBufferRef.current.filter((f) => f !== null).length;
        if (validFrames >= 7) {
          sendToBackend([...frameBufferRef.current]);
        } else {
          setPrediction(null);
        }
      }
    }

    async function sendToBackend(landmarkFrames) {
      try {
        const token = await auth.currentUser.getIdToken();
        const payload = {
          frames: landmarkFrames.map((landmarks) => ({ landmarks })),
          session_id: sessionIdRef.current,
        };
        const res = await axios.post("http://127.0.0.1:8000/engagement/analyze", payload, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!cancelled) setPrediction(res.data);
      } catch (err) {
        console.error("Prediction error:", err);
      }
    }

    async function calibrate() {
      if (!landmarkerRef.current || !videoRef.current) return;
      setCalibrating(true);
      setCalibrationError(null);
      try {
        const framesForCalibration = [];
        for (let i = 0; i < 10; i++) {
          await new Promise((resolve) => setTimeout(resolve, 300));
          if (cancelled || !landmarkerRef.current) return;
          const results = landmarkerRef.current.detectForVideo(videoRef.current, performance.now());
          const landmarks =
            results.faceLandmarks && results.faceLandmarks.length > 0
              ? results.faceLandmarks[0].map((p) => [p.x, p.y, p.z])
              : null;
          framesForCalibration.push({ landmarks });
        }

        const token = await auth.currentUser.getIdToken();
        const res = await axios.post(
          "http://127.0.0.1:8000/engagement/calibrate",
          { frames: framesForCalibration },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        console.log("Calibration result:", res.data);

        if (!cancelled) {
          // Predictions made under the previous offset aren't comparable to the
          // new ones, so start a fresh smoothing session rather than letting
          // stale confirmed state carry over.
          sessionIdRef.current = newSessionId();
          setPrediction(null);
          setCalibrated(true);
        }
      } catch (err) {
        if (!cancelled) {
          setCalibrationError(err?.response?.data?.detail || err.message || "Calibration failed");
        }
      } finally {
        if (!cancelled) setCalibrating(false);
      }
    }

    setup();

    return () => {
      cancelled = true;
      if (captureTimer) clearInterval(captureTimer);
      if (lightingTimer) clearTimeout(lightingTimer);
      if (rafId) cancelAnimationFrame(rafId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
      if (landmarkerRef.current) {
        try { landmarkerRef.current.close?.(); } catch { /* ignore */ }
        landmarkerRef.current = null;
      }
      calibrateRef.current = null;
      frameBufferRef.current = [];
      setReady(false);
    };
  }, [sessionStarted]);

  // Fatigued outranks Recovered: a tired learner who briefly refocuses still
  // needs a break, and "Recovered" there would prompt the wrong intervention.
  const headlineState = !prediction
    ? null
    : prediction.fatigued
    ? "Fatigued"
    : prediction.deep_thinking
    ? "Deep Thinking"
    : prediction.recovered
    ? "Recovered"
    : prediction.state;

  const headlineColor =
    headlineState === "Fatigued"
      ? "#c46a00"
      : headlineState === "Deep Thinking"
      ? "#0b6bcb"
      : headlineState === "Recovered"
      ? "green"
      : "inherit";

  const panelStyle = {
    maxWidth: "520px",
    width: "90%",
    maxHeight: "85vh",
    overflowY: "auto",
    padding: "1.5rem",
    borderRadius: "8px",
    backgroundColor: highContrast ? "#000" : "#fff",
    color: highContrast ? "#fff" : "#000",
    border: `1px solid ${highContrast ? "#fff" : "#ccc"}`,
    boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
  };

  return (
    <DashboardLayout title="Study Session">
      {!sessionStarted && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="session-instructions-title"
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(0,0,0,0.55)",
            zIndex: 1000,
          }}
        >
          <div style={panelStyle}>
            <h3 id="session-instructions-title" style={{ marginTop: 0 }}>
              Before you start
            </h3>
            <p style={{ marginTop: 0 }}>
              Your camera is used to measure engagement. <strong>No video is recorded,
              stored, or sent anywhere</strong> — only numeric facial measurements leave
              your browser.
            </p>
            <ol style={{ paddingLeft: "1.2rem", lineHeight: 1.7 }}>
              <li>Sit about an arm's length away, with your whole face visible and roughly centred.</li>
              <li>Make sure your face is well lit. Avoid sitting with a bright window directly behind you.</li>
              <li>
                Once the camera is active, click <strong>Calibrate Now</strong> and look
                naturally at the screen for about 3 seconds.
              </li>
              <li>
                <strong>Recalibrate if a different person takes over</strong>, or if you move
                your laptop or change seat — the baseline is per person and per camera angle.
              </li>
            </ol>
            <button onClick={() => setSessionStarted(true)} style={{ marginTop: "0.5rem" }}>
              Start Session
            </button>
          </div>
        </div>
      )}

      <p>{cameraStatus}</p>
      <p>Face detected: {faceDetected ? "Yes" : "No"}</p>
      {lightingWarning && <p style={{ color: "orange" }}>{lightingWarning}</p>}
      <p>Frames collected: {framesCollected} / 10</p>

      <button onClick={() => calibrateRef.current?.()} disabled={!ready || calibrating}>
        {calibrating ? "Calibrating..." : calibrated ? "Recalibrate" : "Calibrate Now"}
      </button>
      {calibrating && (
        <span style={{ marginLeft: "0.75rem" }}>Look naturally at the screen...</span>
      )}
      {calibrated && !calibrating && (
        <span style={{ marginLeft: "0.75rem", color: "green" }}>Calibrated</span>
      )}
      {calibrationError && (
        <p style={{ color: "red" }}>Calibration failed: {calibrationError}</p>
      )}

      {prediction && (
        <>
          <p>
            <strong style={{ color: headlineColor }}>
              Engagement state: {headlineState}
            </strong>{" "}
            (confidence: {(prediction.confidence * 100).toFixed(1)}%)
            {headlineState !== prediction.state && (
              <span style={{ color: "#666" }}> — underlying: {prediction.state}</span>
            )}
          </p>
          {prediction.raw_state && (
            <p style={{ fontSize: "0.85em", color: "#666" }}>
              raw: {prediction.raw_state}
              {" — "}
              {prediction.stable
                ? "confirmed"
                : `confirming ${prediction.raw_state} (${prediction.streak}/${prediction.required})`}
              {prediction.fatigue_available === true &&
                ` · eyes low in ${Math.round(prediction.fatigue_ratio * 100)}% of last 45s`}
              {prediction.fatigue_available === false && " · fatigue: calibrate to enable"}
            </p>
          )}
          {/* Live stillness metrics — the Deep Thinking thresholds are unvalidated
              placeholders, so these are surfaced to be tuned by observation. */}
          {prediction.dt_available && (
            <p style={{ fontSize: "0.8em", color: "#888", fontFamily: "monospace" }}>
              stillness: gaze var {prediction.dt_gaze_var.toExponential(2)} · EAR var{" "}
              {prediction.dt_ear_var.toExponential(2)} · pitch Δ {prediction.dt_pitch_delta}
            </p>
          )}
        </>
      )}

      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          width: "400px",
          borderRadius: "8px",
          display: sessionStarted ? "block" : "none",
        }}
      />
    </DashboardLayout>
  );
}
