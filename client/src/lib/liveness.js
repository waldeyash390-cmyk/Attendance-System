import * as faceapi from 'face-api.js';

// --- Tunables (strict mode defaults) ---
const EAR_CLOSED_ABS_CAP = 0.22;
const EAR_DROP_RATIO = 0.78;
const EAR_OPEN_RATIO = 0.85;
const YAW_DELTA_THRESHOLD = 0.08;
const FRAME_INTERVAL_MS = 80;
const MAX_DURATION_MS = 12000;
const NO_BLINK_YAW_FALLBACK_MS = 5000;
const BASELINE_FRAMES = 8;
const MISS_GRACE_FRAMES = 3;
const BLINK_MEMORY_MS = 1300;

// --- Stuck-calibration detection ---
// If we still haven't produced a baseline after this many ms of wall-clock
// time (regardless of frame count), surface it loudly to the UI.
const CALIBRATION_STUCK_MS = 3000;

// --- Relaxed mode (hackathon fallback) ---
// Activated when VITE_LIVENESS_RELAXED === "true" (or "1"). Lets the user
// pass by either:
//   * any non-zero detected yaw delta >= relaxedYawDelta, OR
//   * any single "closed" EAR sample below the closed threshold (no need
//     to observe a re-open), OR
//   * any single face-motion sample (EAR or yaw varying by relaxedMotionDelta
//     from the baseline), which catches a hand wave / lean-in too.
function readRelaxedConfig() {
  const env =
    (typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env
      : {}) || {};
  const flag = String(env.VITE_LIVENESS_RELAXED || '').toLowerCase();
  const enabled = flag === 'true' || flag === '1' || flag === 'yes';
  return {
    enabled,
    maxDurationMs: Number(env.VITE_LIVENESS_MAX_MS) || 8000,
    yawDelta: Number(env.VITE_LIVENESS_YAW_DELTA) || 0.05,
    motionDelta: Number(env.VITE_LIVENESS_MOTION_DELTA) || 0.02,
  };
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function eyeAspectRatio(eye) {
  if (!eye || eye.length < 6) return null;
  const p1 = eye[0];
  const p2 = eye[1];
  const p3 = eye[2];
  const p4 = eye[3];
  const p5 = eye[4];
  const p6 = eye[5];
  const vertical = (dist(p2, p6) + dist(p3, p5)) / 2;
  const horizontal = dist(p1, p4);
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

function noseToEyeCenterRatio(landmarks) {
  const nose = landmarks.getNose()[3];
  const leftEye = landmarks.getLeftEye()[0];
  const rightEye = landmarks.getRightEye()[3];
  if (!nose || !leftEye || !rightEye) return null;
  const eyeMidX = (leftEye.x + rightEye.x) / 2;
  const eyeSpan = Math.abs(rightEye.x - leftEye.x) || 1;
  return (nose.x - eyeMidX) / eyeSpan;
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

export async function detectLiveness(video, { onProgress, debug = false } = {}) {
  if (!video) {
    throw new Error('Video element is required for liveness check');
  }

  const relaxed = readRelaxedConfig();
  const startTime = Date.now();
  const maxDuration = relaxed.enabled ? relaxed.maxDurationMs : MAX_DURATION_MS;

  let detections = 0;
  let missedFrames = 0;
  let calibrationStartAt = null; // wall-clock when we began collecting baseline
  let calibrationReportedStuck = false;
  const trace = []; // full per-frame log, surfaced to console + freeze snapshot

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

  // Log the whole table once the run ends (pass or fail) so devtools shows it
  // even if the user never screenshots the overlay.
  const flushTrace = (reason) => {
    if (typeof console === 'undefined') return;
    try {
      const tag = relaxed.enabled ? '[liveness:RELAXED]' : '[liveness:STRICT]';
      console.group(`${tag} run ${reason} (${trace.length} frames, ${Date.now() - startTime}ms)`);
      console.log('config', {
        maxDuration,
        baselineFrames: BASELINE_FRAMES,
        closedThresh: state.thresholds ? round3(state.thresholds.closed) : null,
        openThresh: state.thresholds ? round3(state.thresholds.open) : null,
        yawDeltaThresh: relaxed.enabled ? relaxed.yawDelta : YAW_DELTA_THRESHOLD,
        motionDeltaThresh: relaxed.enabled ? relaxed.motionDelta : null,
      });
      console.table(trace);
      console.groupEnd();
    } catch {
      /* ignore */
    }
  };

  emit('starting', relaxed.enabled
    ? 'Preparing liveness check (relaxed mode)...'
    : 'Preparing liveness check...');
  emit('ready', relaxed.enabled
    ? 'Relaxed mode: blink, turn your head, or move slightly.'
    : 'Hold steady and blink naturally.');

  while (Date.now() - startTime < maxDuration) {
    let detection = null;
    try {
      detection = await faceapi
        .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.45 }))
        .withFaceLandmarks();
    } catch (err) {
      emit('error', 'Detection error: ' + err.message);
      trace.push({
        t: Date.now() - startTime,
        phase: 'error',
        ear: null,
        yawRatio: null,
        baselineEar: state.baseline ? round3(state.baseline.ear) : null,
        msg: err.message,
      });
      await sleep(FRAME_INTERVAL_MS);
      continue;
    }

    if (!detection) {
      missedFrames += 1;
      state.missStreak += 1;
      trace.push({
        t: Date.now() - startTime,
        phase: 'no-face',
        ear: null,
        yawRatio: null,
        baselineEar: state.baseline ? round3(state.baseline.ear) : null,
        msg: 'miss ' + state.missStreak,
      });

      if (state.missStreak >= MISS_GRACE_FRAMES && state.baseline) {
        // Wipe the baseline on persistent dropout so we re-calibrate.
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
        if (calibrationStartAt == null) {
          calibrationStartAt = Date.now();
        }
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

    // ---- Calibration ----
    if (!state.baseline) {
      if (calibrationStartAt == null) calibrationStartAt = Date.now();

      if (ear != null && yawRatio != null) {
        state.samples.push({ ear, yawRatio });
      }

      trace.push({
        t: Date.now() - startTime,
        phase: 'baseline',
        ear: round3(ear),
        yawRatio: round3(yawRatio),
        baselineEar: null,
        msg: `samples ${state.samples.length}/${BASELINE_FRAMES}`,
      });

      // --- Stuck-calibration signal ---
      // Distinct from "in progress": emitted with a separate phase and a
      // big warning emoji so it can't be confused with normal calibration.
      const calibratingFor = Date.now() - calibrationStartAt;
      if (
        calibratingFor > CALIBRATION_STUCK_MS &&
        state.samples.length < BASELINE_FRAMES &&
        !calibrationReportedStuck
      ) {
        calibrationReportedStuck = true;
        emit(
          'calibration-stuck',
          `STILL CALIBRATING after ${(calibratingFor / 1000).toFixed(1)}s — face detection is unstable. Hold still, face the camera directly, and improve lighting.`,
          { calibrationStuck: true, calibrationMs: calibratingFor, samples: state.samples.length },
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
          `Calibrating (${state.samples.length}/${BASELINE_FRAMES}), hold still and keep eyes open...`,
        );
      }
      await sleep(FRAME_INTERVAL_MS);
      continue;
    }

    const now = Date.now();

    // Expire stale blink memory so an old blink can't combine with a later
    // open frame to fake a pass.
    if (state.sawClosed && now - state.blinkBottomAt > BLINK_MEMORY_MS) {
      state.sawClosed = false;
      state.blinkBottomEar = null;
      state.blinkBottomAt = 0;
    }

    const yawDelta =
      yawRatio != null && state.baseline.yawRatio != null
        ? yawRatio - state.baseline.yawRatio
        : null;

    trace.push({
      t: Date.now() - startTime,
      phase: state.sawClosed ? 'blink-memory' : 'open',
      ear: round3(ear),
      yawRatio: round3(yawRatio),
      baselineEar: round3(state.baseline.ear),
      yawDelta: yawDelta != null ? round3(yawDelta) : null,
      msg: state.sawClosed ? 'saw closed' : '',
    });

    // ---- Strict blink detection ----
    if (ear != null && ear <= state.thresholds.closed) {
      if (!state.sawClosed || ear < state.blinkBottomEar) {
        state.blinkBottomEar = ear;
      }
      state.sawClosed = true;
      state.blinkBottomAt = now;
      emit('closing', 'Blink detected, now open your eyes.');

      // Relaxed-mode shortcut: any closed-eye sample counts, no re-open needed.
      if (relaxed.enabled) {
        flushTrace('pass:relaxed-blink');
        emit('passed', 'Liveness confirmed (relaxed blink).');
        return { passed: true, method: 'blink-relaxed' };
      }
    } else if (ear != null && ear >= state.thresholds.open && state.sawClosed) {
      flushTrace('pass:blink');
      emit('passed', 'Liveness confirmed (blink).');
      return { passed: true, method: 'blink' };
    } else if (ear != null && state.sawClosed) {
      emit('opening', 'Keep opening your eyes...');
    } else if (ear != null) {
      emit('open', 'Eyes open. Blink to confirm.');
    }

    // ---- Head-turn (strict: full threshold + grace window) ----
    if (
      !relaxed.enabled &&
      yawDelta != null &&
      Math.abs(yawDelta) >= YAW_DELTA_THRESHOLD &&
      now - startTime >= NO_BLINK_YAW_FALLBACK_MS
    ) {
      flushTrace('pass:head-turn');
      emit('passed', 'Liveness confirmed (head turn).');
      return { passed: true, method: 'head-turn' };
    }

    // ---- Relaxed-mode shortcuts ----
    if (relaxed.enabled) {
      // (a) any noticeable head turn
      if (yawDelta != null && Math.abs(yawDelta) >= relaxed.yawDelta) {
        flushTrace('pass:relaxed-yaw');
        emit('passed', 'Liveness confirmed (relaxed head motion).');
        return { passed: true, method: 'head-turn-relaxed' };
      }
      // (b) any motion at all — ear drift OR yaw drift from baseline
      const earDrift =
        ear != null && state.baseline.ear != null
          ? Math.abs(ear - state.baseline.ear)
          : 0;
      const yawDrift = yawDelta != null ? Math.abs(yawDelta) : 0;
      if (
        now - startTime >= NO_BLINK_YAW_FALLBACK_MS &&
        Math.max(earDrift, yawDrift) >= relaxed.motionDelta
      ) {
        flushTrace('pass:relaxed-motion');
        emit('passed', 'Liveness confirmed (relaxed motion).');
        return { passed: true, method: 'motion-relaxed' };
      }
    }

    await sleep(FRAME_INTERVAL_MS);
  }

  flushTrace('fail:timeout');
  // Emit one last "frozen" update so the UI keeps the final overlay on screen
  // even though we're about to throw.
  emit(
    'timeout',
    'Liveness check timed out. Please blink naturally and try again.',
    { frozen: true },
  );
  throw new Error('Liveness check timed out. Please blink naturally and try again.');
}
