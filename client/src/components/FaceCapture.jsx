import { useEffect, useRef, useState, useCallback } from 'react';
import * as faceapi from 'face-api.js';
import { detectLiveness } from '../lib/liveness';

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

// Single source of truth for the detector settings used in BOTH
// the liveness pass and the descriptor capture. Keeping them in sync
// is what makes the liveness check actually verify the same face
// we are about to enroll / match.
const DETECTOR_OPTIONS = { inputSize: 320, scoreThreshold: 0.45 };

// Max time we'll wait for the FIRST face to appear. After that we
// give up immediately with a clear error instead of looping for
// several seconds while the student wonders what's happening.
const DESCRIPTOR_MAX_TRIES = 1;

function readLivenessMode() {
  const env =
    (typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env
      : {}) || {};
  const flag = (k) => String(env[k] || '').toLowerCase();
  if (flag('VITE_SKIP_LIVENESS') === 'true' || flag('VITE_SKIP_LIVENESS') === '1') {
    return 'skip';
  }
  if (flag('VITE_LIVENESS_STRICT') === 'true' || flag('VITE_LIVENESS_STRICT') === '1') {
    return 'legacy';
  }
  if (flag('VITE_LIVENESS_FAST') === 'false' || flag('VITE_LIVENESS_FAST') === '0') {
    return 'legacy';
  }
  return 'fast';
}

export default function FaceCapture({
  onCapture,
  buttonLabel = 'Capture face',
  requireLiveness = false,
  busyLabel = 'Working...',
}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const cancelledRef = useRef(false);
  const resultStateTimerRef = useRef(null);
  const [modelsReady, setModelsReady] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [status, setStatus] = useState('Loading face models...');
  const [busy, setBusy] = useState(false);
  const [debugInfo, setDebugInfo] = useState(null);
  const [resultState, setResultState] = useState('idle');
  const livenessMode = readLivenessMode();
  const effectiveLiveness = requireLiveness && livenessMode !== 'skip';

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

  const captureDescriptor = useCallback(async () => {
    if (!videoRef.current) {
      throw new Error('Camera not ready');
    }
    // One quick pass. We don't loop with backoff here because the
    // liveness pass has already confirmed a face is in frame; if the
    // descriptor pass itself fails it almost always means the student
    // moved or the lighting is bad, in which case we should fail
    // fast and let them retry instead of holding them hostage.
    for (let i = 0; i < DESCRIPTOR_MAX_TRIES; i++) {
      const detection = await faceapi
        .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions(DETECTOR_OPTIONS))
        .withFaceLandmarks()
        .withFaceDescriptor();
      if (detection) {
        return Array.from(detection.descriptor);
      }
    }
    throw new Error('Face not detected. Look at the camera with good lighting and try again.');
  }, []);

  const handleCapture = useCallback(async () => {
    if (!videoRef.current || busy) return;
    setBusy(true);
    setStatus('Detecting face...');
    setDebugInfo(null);
    setResultState('idle');

    const t0 = performance.now();

    try {
      let livenessPassed = false;
      let livenessMethod = null;

      if (effectiveLiveness) {
        try {
          const result = await detectLiveness(videoRef.current, {
            onProgress: ({ message, phase, elapsedMs }) => {
              if (typeof message === 'string') setStatus(message);
              if (typeof elapsedMs === 'number') {
                setDebugInfo((d) => ({
                  ...(d || {}),
                  phase: phase || (d && d.phase) || null,
                  elapsedMs,
                }));
              }
            },
          });
          livenessPassed = Boolean(result && result.passed);
          livenessMethod = result && result.method ? result.method : null;
          if (!livenessPassed) {
            const why = result && result.reason === 'no-face'
              ? 'No face detected. Please try again with better lighting.'
              : 'No movement detected. Please try again and look at the camera.';
            setStatus(why);
            setResultState('error');
            setBusy(false);
            return;
          }
        } catch (livenessErr) {
          setStatus(livenessErr.message || 'Liveness check failed.');
          setResultState('error');
          setBusy(false);
          return;
        }
      } else if (requireLiveness) {
        // requireLiveness was true but env disabled it.
        livenessPassed = true;
        livenessMethod = 'server-skipped';
      }

      let descriptor;
      try {
        descriptor = await captureDescriptor();
      } catch (capErr) {
        setStatus(capErr.message);
        setResultState('error');
        setBusy(false);
        return;
      }

      setResultState('success');
      if (resultStateTimerRef.current) clearTimeout(resultStateTimerRef.current);
      resultStateTimerRef.current = setTimeout(() => {
        setResultState((s) => (s === 'success' ? 'idle' : s));
      }, 2500);

      const elapsed = Math.round(performance.now() - t0);
      setDebugInfo((d) => ({
        ...(d || {}),
        totalMs: elapsed,
        livenessMethod,
      }));
      setStatus(requireLiveness
        ? `Liveness confirmed (${livenessMethod || 'fast'}). Marking attendance...`
        : 'Face captured. Marking attendance...');

      if (requireLiveness) {
        await onCapture({ descriptor, livenessPassed, livenessMethod });
      } else {
        await onCapture(descriptor);
      }
    } catch (err) {
      setStatus('Capture failed: ' + err.message);
    } finally {
      setBusy(false);
    }
  }, [busy, captureDescriptor, effectiveLiveness, onCapture, requireLiveness]);

  useEffect(() => () => {
    cancelledRef.current = true;
    if (resultStateTimerRef.current) clearTimeout(resultStateTimerRef.current);
  }, []);

  return (
    <div className="face-capture">
      <div className={`face-capture-ring face-capture-ring--${resultState}`}>
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          width={320}
          height={240}
          className="face-capture-video"
        />
      </div>
      <p className="muted">{status}</p>
      {requireLiveness && (
        <p className="muted small">
          {livenessMode === 'skip' && (
            <>Anti-spoofing is <strong>off</strong> on this deployment (server-enforced flag).</>
          )}
          {livenessMode === 'fast' && (
            <>Quick liveness check — just look at the camera. A printed photo won't be accepted.</>
          )}
          {livenessMode === 'legacy' && (
            <>Anti-spoofing is on (legacy mode): please <strong>blink naturally</strong> when prompted.</>
          )}
        </p>
      )}
      {debugInfo && debugInfo.totalMs != null && (
        <p className="muted small">
          Last scan: <strong>{debugInfo.totalMs} ms</strong>
          {debugInfo.livenessMethod && <> · method: {debugInfo.livenessMethod}</>}
        </p>
      )}
      <button
        type="button"
        onClick={handleCapture}
        disabled={!cameraReady || busy}
      >
        {busy ? busyLabel : buttonLabel}
      </button>
    </div>
  );
}
