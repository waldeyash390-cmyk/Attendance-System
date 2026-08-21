import { useEffect, useRef, useState, useCallback } from 'react';
import * as faceapi from 'face-api.js';

let modelsLoadedPromise = null;

function loadModels() {
  if (!modelsLoadedPromise) {
    modelsLoadedPromise = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
      faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
      faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
    ]);
  }
  return modelsLoadedPromise;
}

export default function FaceCapture({ onCapture, buttonLabel = 'Capture face' }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [modelsReady, setModelsReady] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [status, setStatus] = useState('Loading face models...');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadModels()
      .then(() => {
        if (!cancelled) {
          setModelsReady(true);
          setStatus('Starting camera...');
        }
      })
      .catch((err) => {
        if (!cancelled) setStatus('Failed to load face models: ' + err.message);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!modelsReady) return;
    let cancelled = false;

    navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setCameraReady(true);
        setStatus('Camera ready. Position your face in view.');
      })
      .catch((err) => {
        setStatus('Camera access failed: ' + err.message);
      });

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [modelsReady]);

  const handleCapture = useCallback(async () => {
    if (!videoRef.current || busy) return;
    setBusy(true);
    setStatus('Detecting face...');
    try {
      const detection = await faceapi
        .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!detection) {
        setStatus('No face detected. Try again with better lighting.');
        setBusy(false);
        return;
      }

      const descriptor = Array.from(detection.descriptor);
      setStatus('Face captured.');
      await onCapture(descriptor);
    } catch (err) {
      setStatus('Capture failed: ' + err.message);
    } finally {
      setBusy(false);
    }
  }, [busy, onCapture]);

  return (
    <div className="face-capture">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        width={320}
        height={240}
        style={{ background: '#111', borderRadius: 8 }}
      />
      <p className="muted">{status}</p>
      <button
        type="button"
        onClick={handleCapture}
        disabled={!cameraReady || busy}
      >
        {busy ? 'Working...' : buttonLabel}
      </button>
    </div>
  );
}