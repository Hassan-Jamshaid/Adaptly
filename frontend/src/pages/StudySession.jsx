import { useRef, useEffect, useState } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import axios from "axios";
import { auth } from "../firebase/config";
import DashboardLayout from "../layouts/DashboardLayout";

export default function StudySession() {
  const videoRef = useRef(null);
  const landmarkerRef = useRef(null);
  const frameBufferRef = useRef([]);
  const [cameraStatus, setCameraStatus] = useState("Requesting camera access...");
  const [faceDetected, setFaceDetected] = useState(false);
  const [prediction, setPrediction] = useState(null);
  const [framesCollected, setFramesCollected] = useState(0);
  const [lightingWarning, setLightingWarning] = useState(null);


  useEffect(() => {
    async function setup() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setCameraStatus("Camera active");
        }

        setTimeout(checkLighting, 1000); // give camera a moment to stabilize

        const filesetResolver = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
        );
        landmarkerRef.current = await FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numFaces: 1,
        });

        window.triggerCalibration = calibrate;

        detectLoop();
        setInterval(captureFrame, 1000);
      } catch (err) {
        setCameraStatus("Setup error: " + err.message);
      }
    }

    function detectLoop() {
      if (videoRef.current && landmarkerRef.current && videoRef.current.readyState >= 2) {
        const results = landmarkerRef.current.detectForVideo(videoRef.current, performance.now());
        setFaceDetected(results.faceLandmarks && results.faceLandmarks.length > 0);
      }
      requestAnimationFrame(detectLoop);
    }

    function checkLighting() {
      if (!videoRef.current) return;
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
      if (!videoRef.current || !landmarkerRef.current) return;
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
        };
        const res = await axios.post("http://127.0.0.1:8000/engagement/analyze", payload, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setPrediction(res.data);
      } catch (err) {
        console.error("Prediction error:", err);
      }
    }

    async function calibrate() {
      const framesForCalibration = [];
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 300));
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
      alert("Calibration complete!");
    }

    setup();
  }, []);

  return (
    <DashboardLayout title="Study Session">
      <p>{cameraStatus}</p>
      <p>Face detected: {faceDetected ? "Yes" : "No"}</p>
      {lightingWarning && <p style={{ color: "orange" }}>{lightingWarning}</p>}
      <p>Frames collected: {framesCollected} / 10</p>
      <button onClick={() => window.triggerCalibration()}>Calibrate Now</button>
      {prediction && (
        <p>
          <strong>Engagement state: {prediction.state}</strong> (confidence:{" "}
          {(prediction.confidence * 100).toFixed(1)}%)
        </p>
      )}
      <video ref={videoRef} autoPlay playsInline muted style={{ width: "400px", borderRadius: "8px" }} />
    </DashboardLayout>
  );
}