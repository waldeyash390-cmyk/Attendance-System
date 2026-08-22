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

export default function FaceCapture({
  onCapture,
  buttonLabel = 'Capture face',
  requireLiveness = false,
  busyLabel = 'Working...',
}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const cancelledRef = useRef(false);
  const [modelsReady, setModelsReady] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [status, setStatus] = useState('Loading face models...');
  const [busy, setBusy] = useState(false);
  // TEMPORARY: liveness debug overlay until Step 8 is confirmed working.
  const [debugEnabled, setDebugEnabled] = useState(true);
  const [livenessDebug, setLivenessDebug] = useState(null);
  const [livenessPhase, setLivenessPhase] = useState(null);
  const [livenessFrozen, setLivenessFrozen] = useState(false);

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
  }, [modelsReady, requireLiveness]);

  const runCapture = useCallback(async () => {
    if (!videoRef.current || busy) return null;
    const detection = await faceapi
      .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detection) {
      throw new Error('No face detected. Try again with better lighting.');
    }
    return Array.from(detection.descriptor);
  }, [busy]);

  const handleCapture = useCallback(async () => {
    if (!videoRef.current || busy) return;
    setBusy(true);
    setStatus('Detecting face...');
    setLivenessDebug(null);
    setLivenessPhase(null);
    setLivenessFrozen(false);
    try {
      let livenessPassed = false;
      let livenessMethod = null;

      if (requireLiveness) {
        try {
          const result = await detectLiveness(videoRef.current, {
            debug: debugEnabled,
            onProgress: ({ message, debug, phase }) => {
              if (typeof message === 'string') setStatus(message);
              setLivenessPhase(phase || null);
              if (debug) setLivenessDebug(debug);
              // Once liveness emits a final `passed` or `timeout`, lock the
              // overlay in place so the user can read it calmly after the
              // attempt ends instead of watching it vanish mid-screenshot.
              if (phase === 'passed' || phase === 'timeout') {
                setLivenessFrozen(true);
              }
            },
          });
          livenessPassed = Boolean(result && result.passed);
          livenessMethod = result && result.method ? result.method : null;
        } catch (livenessErr) {
          setStatus(livenessErr.message || 'Liveness check failed.');
          setLivenessFrozen(true);
          setBusy(false);
          return;
        }
      }

      let descriptor;
      try {
        descriptor = await runCapture();
      } catch (capErr) {
        setStatus(capErr.message);
        setBusy(false);
        return;
      }

      setStatus(requireLiveness
        ? 'Liveness confirmed. Capturing face...'
        : 'Face captured.');

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
  }, [busy, debugEnabled, onCapture, requireLiveness, runCapture]);

  useEffect(() => () => { cancelledRef.current = true; }, []);

  const formatDebug = (d) => [
    `phase      : ${d.phase}${livenessFrozen ? '   [FROZEN]' : ''}`,
    `ear        : ${d.ear != null ? d.ear.toFixed(3) : '-'}   (baseline ${d.baselineEar != null ? d.baselineEar.toFixed(3) : '-'})`,
    `thresholds : closed<=${d.closedThresh != null ? d.closedThresh.toFixed(3) : '-'}  open>=${d.openThresh != null ? d.openThresh.toFixed(3) : '-'}`,
    `yaw        : ${d.yawRatio != null ? d.yawRatio.toFixed(3) : '-'}   delta ${d.yawDelta != null ? (d.yawDelta >= 0 ? '+' : '') + d.yawDelta.toFixed(3) : '-'} (thr 0.08)`,
    `blink mem  : ${d.sawClosed ? 'ACTIVE' : 'none'}${d.blinkAgeMs != null && d.sawClosed ? ` (${Math.round(d.blinkAgeMs)}ms ago)` : ''}`,
    `time       : ${(d.elapsedMs / 1000).toFixed(1)}s / 12.0s`,
    `frames     : det ${d.detections}, miss ${d.missedFrames} (trace=${d.traceLength})`,
  ].join('\n');

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
      {requireLiveness && (
        <p className="muted small liveness-hint">
          Anti-spoofing is on: please <strong>blink naturally</strong> (or slowly turn your head) when prompted.
        </p>
      )}
      {requireLiveness && (
        <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={debugEnabled}
            onChange={(e) => setDebugEnabled(e.target.checked)}
          />
          Show liveness debug overlay (temporary)
        </label>
      )}
      {requireLiveness && debugEnabled && livenessDebug && (
        <div>
          {livenessPhase === 'calibration-stuck' && (
            <div
              role="alert"
              style={{
                background: '#3a0d0d',
                color: '#FFD27A',
                border: '2px solid #FF8A00',
                padding: '8px 10px',
                borderRadius: 8,
                marginBottom: 6,
                fontSize: 13,
                fontWeight: 600,
                textAlign: 'left',
              }}
            >
              CALIBRATION STUCK — face detection has not stabilized in {">"}3s.
              The blink check has not even started. Likely causes: phone camera
              detection jitter, poor lighting, or face not centered. Try better
              lighting, hold phone steady, face the camera directly.
            </div>
          )}
          {livenessFrozen && (
            <div
              role="status"
              style={{
                background: '#222',
                color: '#FFD27A',
                padding: '6px 10px',
                borderRadius: 8,
                marginBottom: 6,
                fontSize: 12,
                fontWeight: 600,
                textAlign: 'left',
              }}
            >
              FROZEN SNAPSHOT — liveness attempt ended. Last known values shown
              below. Tap “Try again” to clear.
            </div>
          )}
          <pre
            style={{
              textAlign: 'left',
              fontSize: 12,
              lineHeight: 1.5,
              background: livenessFrozen ? '#1a1a1a' : '#111',
              color: livenessFrozen ? '#FFD27A' : '#7CFC98',
              padding: '8px 10px',
              borderRadius: 8,
              overflowX: 'auto',
              border: livenessFrozen ? '1px dashed #FFD27A' : 'none',
            }}
          >
{formatDebug(livenessDebug)}
          </pre>
          {livenessFrozen && (
            <p className="muted small" style={{ marginTop: 4 }}>
              Tip: open browser devtools console to see the full per-frame trace
              table for this attempt.
            </p>
          )}
        </div>
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
