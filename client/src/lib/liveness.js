import * as faceapi from 'face-api.js';

// --- Shared detector settings ---
// These must match what FaceCapture.runCapture uses to compute the
// enrollment descriptor, so the liveness check runs the same model
// pass over the same video the final descriptor will come from.
const DETECTOR_OPTIONS = { inputSize: 320, scoreThreshold: 0.45 };

// --- Fast mode (default for daily attendance) ---
// Real classrooms need sub-second face-scan. We do not try to wait for
// a textbook blink; we just need any evidence of life beyond a static
// photo. Two short windows back-to-back are enough to distinguish a
// still printed photo from a real face in front of a camera:
//
//   1. collect a handful of EAR samples while the user is "looking" at
//      the camera (~10-15 frames ≈ 0.4-0.6s). If the EAR varies by
//      more than FAST_EAR_DELTA from the very first sample, the
//      subject is alive (a printed photo cannot blink or twitch).
//   2. if window 1 was perfectly still (e.g. someone staring very
//      hard at the camera), do one quick re-check: take a second
//      sample a short moment later and compare to the first.
//
// A still printed photo held in front of the camera will produce a
// sequence of virtually identical EAR values and fail.
const FAST_WINDOW_FRAMES = 12;          // ~0.5s at 80ms per frame
const FAST_EAR_DELTA = 0.015;           // tiny but real (a blink is ~0.1+)
const FAST_RECHECK_DELAY_MS = 200;      // one short re-sample
const FAST_RECHECK_DELTA = 0.01;        // any small drift counts
const FAST_OVERALL_BUDGET_MS = 1200;    // hard cap; we never block longer
const FRAME_INTERVAL_MS = 80;

// --- Old "strict / relaxed" tunables kept for the legacy path only ---
const EAR_CLOSED_ABS_CAP = 0.22;
const EAR_DROP_RATIO = 0.78;
const EAR_OPEN_RATIO = 0.85;
const YAW_DELTA_THRESHOLD = 0.08;
const MAX_DURATION_MS = 12000;
const NO_BLINK_YAW_FALLBACK_MS = 5000;
const BASELINE_FRAMES = 8;
const MISS_GRACE_FRAMES = 3;
const BLINK_MEMORY_MS = 1300;
const CALIBRATION_STUCK_MS = 3000;

function readModeConfig() {
  const env =
    (typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env
      : {}) || {};
  const flag = (k) => String(env[k] || '').toLowerCase();
  return {
    skip: flag('VITE_SKIP_LIVENESS') === 'true' || flag('VITE_SKIP_LIVENESS') === '1',
    fast: flag('VITE_LIVENESS_FAST') !== 'false' && flag('VITE_LIVENESS_FAST') !== '0',
    relaxed: flag('VITE_LIVENESS_RELAXED') === 'true' || flag('VITE_LIVENESS_RELAXED') === '1',
    strict: flag('VITE_LIVENESS_STRICT') === 'true' || flag('VITE_LIVENESS_STRICT') === '1',
  };
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function eyeAspectRatio(eye) {
  if (!eye || eye.length < 6) return null;
  const vertical = (dist(eye[1], eye[5]) + dist(eye[2], eye[4])) / 2;
  const horizontal = dist(eye[0], eye[3]);
  if (horizontal <= 0) return null;
  return vertical / horizontal;
}

function averageEar(landmarks) {
  const leftEye = landmarks.getLeftEye();
  const rightEye = landmarks.getRightEye();
  const l = eyeAspectRatio(leftEye);
  const r = eyeAspectRatio(rightEye);
  if (l == null && r == null) return null;
  if (l == null) return r;
  if (r == null) return l;
  return (l + r) / 2;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round3(value) {
  return value == null ? null : Math.round(value * 1000) / 1000;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function detectOneFrame(video) {
  try {
    return await faceapi
      .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions(DETECTOR_OPTIONS))
      .withFaceLandmarks();
  } catch {
    return null;
  }
}

// ---------- Fast path ----------
//
// Skips baseline calibration. On a real, live face, EAR naturally
// jitters frame-to-frame (sub-pixel landmark noise + tiny head
// movement). A static printed photo cannot reproduce that, so a
// single tight window is enough for proof-of-life.
//
// Result is one of:
//   { passed: true,  method: 'fast-motion' | 'fast-recheck' }
//   { passed: false, reason: 'no-face' | 'still', detail: '...' }
export async function detectLivenessFast(video, { onProgress } = {}) {
  const startTime = Date.now();
  const samples = [];

  const tick = (phase, message, extra = {}) => {
    if (typeof onProgress !== 'function') return;
    onProgress({
      phase,
      message,
      ...extra,
      elapsedMs: Date.now() - startTime,
    });
  };

  tick('starting', 'Quick liveness check...');

  // Window 1: short burst, look for any natural EAR variation.
  for (let i = 0; i < FAST_WINDOW_FRAMES; i++) {
    if (Date.now() - startTime > FAST_OVERALL_BUDGET_MS) break;
    const det = await detectOneFrame(video);
    if (!det) {
      tick('no-face', 'No face detected. Look at the camera.');
      await sleep(FRAME_INTERVAL_MS);
      continue;
    }
    const ear = averageEar(det.landmarks);
    if (ear != null) samples.push(ear);
    tick('sampling', `Verifying (${samples.length}/${FAST_WINDOW_FRAMES})...`, {
      ear: round3(ear),
    });

    if (samples.length >= 2) {
      const span = Math.max(...samples) - Math.min(...samples);
      if (span >= FAST_EAR_DELTA) {
        tick('passed', 'Liveness confirmed (instant).');
        return { passed: true, method: 'fast-motion' };
      }
    }
    await sleep(FRAME_INTERVAL_MS);
  }

  if (samples.length < 2) {
    tick('no-face', 'No face detected. Hold the camera steady and try again.');
    return { passed: false, reason: 'no-face' };
  }

  // Window 2: one quick re-check rather than a long wait.
  const baseline = samples[0];
  tick('recheck', 'Hold still, rechecking...');
  await sleep(FAST_RECHECK_DELAY_MS);
  const det2 = await detectOneFrame(video);
  if (!det2) {
    tick('no-face', 'Face lost. Please try again.');
    return { passed: false, reason: 'no-face' };
  }
  const ear2 = averageEar(det2.landmarks);
  if (ear2 != null && Math.abs(ear2 - baseline) >= FAST_RECHECK_DELTA) {
    tick('passed', 'Liveness confirmed (recheck).');
    return { passed: true, method: 'fast-recheck' };
  }

  tick('still', 'No movement detected. Please try again and look at the camera.');
  return { passed: false, reason: 'still' };
}

// ---------- Legacy strict + relaxed path ----------
// Kept available if a deployment explicitly wants the old behavior
// (VITE_LIVENESS_FAST=false plus VITE_LIVENESS_RELAXED or
// VITE_LIVENESS_STRICT). Not used by default for daily attendance.

function readRelaxedConfig() {
  const env =
    (typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env
      : {}) || {};
  return {
    enabled: String(env.VITE_LIVENESS_RELAXED || '').toLowerCase() === 'true'
      || String(env.VITE_LIVENESS_RELAXED || '').toLowerCase() === '1'
      || String(env.VITE_LIVENESS_RELAXED || '').toLowerCase() === 'yes',
    maxDurationMs: Number(env.VITE_LIVENESS_MAX_MS) || 8000,
    yawDelta: Number(env.VITE_LIVENESS_YAW_DELTA) || 0.05,
    motionDelta: Number(env.VITE_LIVENESS_MOTION_DELTA) || 0.02,
  };
}

function noseToEyeCenterRatio(landmarks) {
  const nose = landmarks.getNose()[3];
  const leftEye = landmarks.getLeftEye()[0];
  const rightEye = landmarks.getRightEye()[3];
  if (!nose || !leftEye || !rightEye) return null;
  const eyeMidX = (leftEye.x + rightEye.x) / 2;
  const eyeSpan = Math.abs(rightEye.x - leftEye.x) || 1;
  return (nose.x - eyeMidX) / eyeSpan;
}

export async function detectLivenessLegacy(video, { onProgress, debug = false } = {}) {
  if (!video) {
    throw new Error('Video element is required for liveness check');
  }

  const relaxed = readRelaxedConfig();
  const startTime = Date.now();
  const maxDuration = relaxed.enabled ? relaxed.maxDurationMs : MAX_DURATION_MS;

  let detections = 0;
  let missedFrames = 0;
  let calibrationStartAt = null;
  let calibrationReportedStuck = false;
  const trace = [];

  const state = {
    baseline: null,
    thresholds: null,
    samples: [],
    missStreak: 0,
    lastEar: null,
    lastYawRatio: null,
    sawClosed: false,
    blinkBottomEar: null,
    blinkBottomAt: 0,
  };

  const emit = (phase, message, extra = {}) => {
    if (typeof onProgress !== 'function') return;
    const payload = {
      phase,
      message,
      ...extra,
      relaxed: relaxed.enabled,
      ...(debug
        ? {
            debug: {
              phase,
              ear: round3(state.lastEar),
              baselineEar: state.baseline ? round3(state.baseline.ear) : null,
              closedThresh: state.thresholds ? round3(state.thresholds.closed) : null,
              openThresh: state.thresholds ? round3(state.thresholds.open) : null,
              yawRatio: round3(state.lastYawRatio),
              yawDelta:
                state.baseline && state.lastYawRatio != null
                  ? round3(state.lastYawRatio - state.baseline.yawRatio)
                  : null,
              sawClosed: state.sawClosed,
              blinkAgeMs: state.blinkBottomAt ? Date.now() - state.blinkBottomAt : null,
              elapsedMs: Date.now() - startTime,
              detections,
              missedFrames,
              traceLength: trace.length,
            },
          }
        : {}),
    };
    onProgress(payload);
  };

  emit('starting', relaxed.enabled
    ? 'Preparing liveness check (relaxed mode)...'
    : 'Preparing liveness check...');
  emit('ready', relaxed.enabled
    ? 'Relaxed mode: blink, turn your head, or move slightly.'
    : 'Hold steady and blink naturally.');

  while (Date.now() - startTime < maxDuration) {
    const detection = await detectOneFrame(video);
    if (!detection) {
      missedFrames += 1;
      state.missStreak += 1;
      trace.push({
        t: Date.now() - startTime,
        phase: 'no-face',
        ear: null,
        yawRatio: null,
        msg: 'miss ' + state.missStreak,
      });

      if (state.missStreak >= MISS_GRACE_FRAMES && state.baseline) {
        state.baseline = null;
        state.thresholds = null;
        state.samples = [];
        state.sawClosed = false;
        state.blinkBottomEar = null;
        state.blinkBottomAt = 0;
        calibrationStartAt = null;
        calibrationReportedStuck = false;
        emit('no-face', 'No face detected. Look at the camera.');
      } else if (!state.baseline) {
        if (calibrationStartAt == null) calibrationStartAt = Date.now();
        emit('no-face', 'No face detected. Look at the camera.');
      } else {
        emit('no-face', 'Hold still...', { transientMiss: true });
      }
      await sleep(FRAME_INTERVAL_MS);
      continue;
    }
    state.missStreak = 0;
    detections += 1;

    const landmarks = detection.landmarks;
    const ear = averageEar(landmarks);
    const yawRatio = noseToEyeCenterRatio(landmarks);
    state.lastEar = ear;
    state.lastYawRatio = yawRatio;

    if (!state.baseline) {
      if (calibrationStartAt == null) calibrationStartAt = Date.now();
      if (ear != null && yawRatio != null) state.samples.push({ ear, yawRatio });

      const calibratingFor = Date.now() - calibrationStartAt;
      if (
        calibratingFor > CALIBRATION_STUCK_MS &&
        state.samples.length < BASELINE_FRAMES &&
        !calibrationReportedStuck
      ) {
        calibrationReportedStuck = true;
        emit(
          'calibration-stuck',
          `STILL CALIBRATING after ${(calibratingFor / 1000).toFixed(1)}s — face detection is unstable.`,
        );
      }

      if (state.samples.length >= BASELINE_FRAMES) {
        state.baseline = {
          ear: median(state.samples.map((s) => s.ear)),
          yawRatio: median(state.samples.map((s) => s.yawRatio)),
        };
        state.thresholds = {
          closed: Math.min(state.baseline.ear * EAR_DROP_RATIO, EAR_CLOSED_ABS_CAP),
          open: Math.max(state.baseline.ear * EAR_OPEN_RATIO, state.baseline.ear * EAR_DROP_RATIO + 0.02),
        };
        state.samples = [];
        calibrationStartAt = null;
        calibrationReportedStuck = false;
        emit('ready', 'Thanks. Now blink naturally.', { calibrated: true });
      } else if (!calibrationReportedStuck) {
        emit(
          'baseline',
          `Calibrating (${state.samples.length}/${BASELINE_FRAMES})...`,
        );
      }
      await sleep(FRAME_INTERVAL_MS);
      continue;
    }

    const now = Date.now();
    if (state.sawClosed && now - state.blinkBottomAt > BLINK_MEMORY_MS) {
      state.sawClosed = false;
      state.blinkBottomEar = null;
      state.blinkBottomAt = 0;
    }

    const yawDelta =
      yawRatio != null && state.baseline.yawRatio != null
        ? yawRatio - state.baseline.yawRatio
        : null;

    if (ear != null && ear <= state.thresholds.closed) {
      if (!state.sawClosed || ear < state.blinkBottomEar) state.blinkBottomEar = ear;
      state.sawClosed = true;
      state.blinkBottomAt = now;
      emit('closing', 'Blink detected, now open your eyes.');
      if (relaxed.enabled) {
        emit('passed', 'Liveness confirmed (relaxed blink).');
        return { passed: true, method: 'blink-relaxed' };
      }
    } else if (ear != null && ear >= state.thresholds.open && state.sawClosed) {
      emit('passed', 'Liveness confirmed (blink).');
      return { passed: true, method: 'blink' };
    } else if (ear != null && state.sawClosed) {
      emit('opening', 'Keep opening your eyes...');
    } else if (ear != null) {
      emit('open', 'Eyes open. Blink to confirm.');
    }

    if (
      !relaxed.enabled &&
      yawDelta != null &&
      Math.abs(yawDelta) >= YAW_DELTA_THRESHOLD &&
      now - startTime >= NO_BLINK_YAW_FALLBACK_MS
    ) {
      emit('passed', 'Liveness confirmed (head turn).');
      return { passed: true, method: 'head-turn' };
    }

    if (relaxed.enabled) {
      if (yawDelta != null && Math.abs(yawDelta) >= relaxed.yawDelta) {
        emit('passed', 'Liveness confirmed (relaxed head motion).');
        return { passed: true, method: 'head-turn-relaxed' };
      }
      const earDrift =
        ear != null && state.baseline.ear != null
          ? Math.abs(ear - state.baseline.ear)
          : 0;
      const yawDrift = yawDelta != null ? Math.abs(yawDelta) : 0;
      if (
        now - startTime >= NO_BLINK_YAW_FALLBACK_MS &&
        Math.max(earDrift, yawDrift) >= relaxed.motionDelta
      ) {
        emit('passed', 'Liveness confirmed (relaxed motion).');
        return { passed: true, method: 'motion-relaxed' };
      }
    }

    await sleep(FRAME_INTERVAL_MS);
  }

  emit('timeout', 'Liveness check timed out. Please blink naturally and try again.', { frozen: true });
  throw new Error('Liveness check timed out. Please blink naturally and try again.');
}

// ---------- Public entry ----------
//
// Returns:
//   { passed: true, method }   - liveness confirmed, descriptor capture
//                                 can proceed.
//   { passed: false, reason, error? }  - the caller should NOT submit to
//                                 the server; surface the reason to the
//                                 user. error is set when skip is on but
//                                 the server also rejected.
//
// `mode` controls behavior:
//   'skip'  - never call detectLiveness; pretend it passed.
//   'fast'  - call detectLivenessFast (default).
//   'legacy'- call detectLivenessLegacy (strict or relaxed).
export async function runLiveness(video, { mode = 'fast', onProgress, debug = false } = {}) {
  if (mode === 'skip') {
    if (typeof onProgress === 'function') {
      onProgress({ phase: 'skipped', message: 'Liveness check disabled.', elapsedMs: 0 });
    }
    return { passed: true, method: 'skipped' };
  }
  if (mode === 'fast') {
    return detectLivenessFast(video, { onProgress });
  }
  if (mode === 'legacy') {
    return detectLivenessLegacy(video, { onProgress, debug });
  }
  throw new Error('Unknown liveness mode: ' + mode);
}

export async function detectLiveness(video, opts = {}) {
  const config = readModeConfig();
  const mode = config.skip
    ? 'skip'
    : (config.fast && !config.strict ? 'fast' : 'legacy');
  return runLiveness(video, { ...opts, mode });
}
