const express = require('express');
const { query } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { haversineDistanceMeters } = require('../utils/geo');

const router = express.Router();

const DESCRIPTOR_LENGTH = 128;

const DEFAULT_MATCH_THRESHOLD = Number(process.env.FACE_MATCH_THRESHOLD) || 0.6;
if (!Number.isFinite(DEFAULT_MATCH_THRESHOLD) || DEFAULT_MATCH_THRESHOLD <= 0) {
  console.warn('[attendance] FACE_MATCH_THRESHOLD must be a positive number; using default 0.6');
}

// LIVENESS_OPTIONAL: when "true"/"1", the server accepts face-mark
// requests even if the client did not pass a liveness proof. This is
// the only safe way to disable the on-camera check; both the client
// (VITE_SKIP_LIVENESS) and the server (LIVENESS_OPTIONAL) must agree.
// Default is false to preserve the existing anti-spoofing posture.
const LIVENESS_OPTIONAL = ['true', '1', 'yes'].includes(
  String(process.env.LIVENESS_OPTIONAL || '').toLowerCase(),
);

function bad(res, msg, status = 400) {
  return res.status(status).json({ error: msg });
}

function normalizeDescriptor(input) {
  if (!Array.isArray(input)) return null;
  if (input.length !== DESCRIPTOR_LENGTH) return null;
  const out = new Array(DESCRIPTOR_LENGTH);
  for (let i = 0; i < DESCRIPTOR_LENGTH; i++) {
    const v = input[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    out[i] = v;
  }
  return out;
}

function euclideanDistanceSq(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return s;
}

function publicAttendance(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    studentId: row.student_id,
    status: row.status,
    markedAt: row.marked_at,
    confidence: row.confidence === null ? null : Number(row.confidence),
    method: row.method,
    note: row.note,
    livenessPassed: row.liveness_passed === null ? null : Boolean(row.liveness_passed),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadSession(id) {
  const result = await query(
    `SELECT id, subject_id, teacher_id, title, start_at, end_at,
            location, is_open, opens_at, closes_at,
            campus_lat, campus_lng, radius_meters,
            created_at, updated_at
       FROM sessions
      WHERE id = $1
      LIMIT 1`,
    [id],
  );
  return result.rows[0] || null;
}

function sessionGeofence(session) {
  if (session.campus_lat === null || session.campus_lat === undefined) return null;
  if (session.campus_lng === null || session.campus_lng === undefined) return null;
  const radius = Number(session.radius_meters);
  if (!Number.isFinite(radius) || radius <= 0) return null;
  return {
    campusLat: Number(session.campus_lat),
    campusLng: Number(session.campus_lng),
    radiusMeters: radius,
  };
}

function parseStudentCoords(body) {
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  let accuracy = null;
  if (body.accuracy !== undefined && body.accuracy !== null && body.accuracy !== '') {
    const a = Number(body.accuracy);
    if (Number.isFinite(a) && a >= 0) accuracy = a;
  }
  return { lat, lng, accuracy };
}

async function logAttempt({ sessionId, studentId, status, lat, lng, distanceMeters, accuracyMeters }) {
  await query(
    `INSERT INTO attendance_attempts
       (session_id, student_id, status, lat, lng, distance_meters, accuracy_meters)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [sessionId, studentId, status, lat, lng, distanceMeters, accuracyMeters],
  );
}

function publicAttempt(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    studentId: row.student_id,
    studentName: row.full_name || null,
    rollNumber: row.roll_number || null,
    status: row.status,
    lat: row.lat === null ? null : Number(row.lat),
    lng: row.lng === null ? null : Number(row.lng),
    distance: row.distance_meters === null ? null : Number(row.distance_meters),
    accuracy: row.accuracy_meters === null ? null : Number(row.accuracy_meters),
    timestamp: row.created_at,
  };
}

function isSessionOpen(session, now = new Date()) {
  if (!session.is_open) return false;
  if (session.opens_at && now < new Date(session.opens_at)) return false;
  if (session.closes_at && now > new Date(session.closes_at)) return false;
  return true;
}

router.put('/session/:sessionId/student/:studentId', requireAuth, requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const { sessionId, studentId } = req.params;
    const { status, note, method } = req.body || {};

    const VALID_STATUS = new Set(['present', 'late', 'absent', 'excused']);
    const finalStatus = status || 'present';
    if (!VALID_STATUS.has(finalStatus)) {
      return bad(res, `status must be one of: ${Array.from(VALID_STATUS).join(', ')}`);
    }

    const finalMethod = method || 'manual';
    if (!['face', 'manual', 'proxy'].includes(finalMethod)) {
      return bad(res, "method must be one of: face, manual, proxy");
    }

    const session = await loadSession(sessionId);
    if (!session) return bad(res, 'Session not found', 404);

    if (req.user.role !== 'admin' && session.teacher_id !== req.user.id) {
      return bad(res, 'Only the assigned teacher or an admin can update attendance for this session', 403);
    }

    const studentRow = await query(
      `SELECT id, role, is_active FROM users WHERE id = $1 LIMIT 1`,
      [studentId],
    );
    const stu = studentRow.rows[0];
    if (!stu) return bad(res, 'Student not found', 404);
    if (!stu.is_active) return bad(res, 'Student is not active', 403);
    if (stu.role !== 'student') return bad(res, 'User is not a student', 403);

    const upsert = await query(
      `INSERT INTO attendance (session_id, student_id, status, confidence, method, note)
       VALUES ($1, $2, $3, NULL, $4, $5)
       ON CONFLICT (session_id, student_id) DO UPDATE
         SET status = EXCLUDED.status,
             method = EXCLUDED.method,
             note = EXCLUDED.note,
             marked_at = NOW()
       RETURNING id, session_id, student_id, status, marked_at, confidence, method, note, created_at, updated_at`,
      [sessionId, studentId, finalStatus, finalMethod, note || null],
    );
    const attendanceRow = upsert.rows[0];

    res.json({ attendance: publicAttendance(attendanceRow) });
  } catch (err) {
    next(err);
  }
});

router.post('/mark-manual', requireAuth, requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const { sessionId, studentId, status, note } = req.body || {};
    if (!sessionId) return bad(res, 'sessionId is required');
    if (!studentId) return bad(res, 'studentId is required');

    const session = await loadSession(sessionId);
    if (!session) return bad(res, 'Session not found', 404);
    if (!isSessionOpen(session)) {
      return bad(res, 'Session is not open for attendance', 409);
    }

    if (req.user.role !== 'admin' && session.teacher_id !== req.user.id) {
      return bad(res, 'Only the assigned teacher or an admin can mark attendance for this session', 403);
    }

    const studentRow = await query(
      `SELECT id, role, is_active FROM users WHERE id = $1 LIMIT 1`,
      [studentId],
    );
    const stu = studentRow.rows[0];
    if (!stu) return bad(res, 'Student not found', 404);
    if (!stu.is_active) return bad(res, 'Student is not active', 403);
    if (stu.role !== 'student') return bad(res, 'User is not a student', 403);

    const finalStatus = status || 'present';
    const VALID_STATUS = new Set(['present', 'late', 'absent', 'excused']);
    if (!VALID_STATUS.has(finalStatus)) {
      return bad(res, `status must be one of: ${Array.from(VALID_STATUS).join(', ')}`);
    }

    const upsert = await query(
      `INSERT INTO attendance (session_id, student_id, status, confidence, method, note)
       VALUES ($1, $2, $3, NULL, 'manual', $4)
       ON CONFLICT (session_id, student_id) DO UPDATE
         SET status = EXCLUDED.status,
             method = 'manual',
             note = COALESCE(EXCLUDED.note, attendance.note),
             marked_at = NOW()
       RETURNING id, session_id, student_id, status, marked_at, confidence, method, note, created_at, updated_at`,
      [sessionId, studentId, finalStatus, note || null],
    );
    const attendanceRow = upsert.rows[0];

    res.status(200).json({ attendance: publicAttendance(attendanceRow) });
  } catch (err) {
    next(err);
  }
});

router.post('/mark', requireAuth, async (req, res, next) => {
  try {
    const { sessionId, descriptor, threshold, status, note, method, livenessPassed } = req.body || {};

    if (!sessionId) return bad(res, 'sessionId is required');
    const normalized = normalizeDescriptor(descriptor);
    if (!normalized) {
      return bad(res, `descriptor must be an array of ${DESCRIPTOR_LENGTH} finite numbers`);
    }

    // Liveness gate: a face scan must come with proof-of-life from the
    // client to reject a still photo held up to the camera. If the
    // deployment has explicitly opted out of the on-camera check via
    // LIVENESS_OPTIONAL=true (which must match the client's
    // VITE_SKIP_LIVENESS=true), we accept the scan without it and
    // record liveness_passed=false so the audit trail stays honest.
    if (livenessPassed !== true && !LIVENESS_OPTIONAL) {
      return res.status(403).json({
        error: 'Liveness check required. Please blink naturally and try again.',
        code: 'LIVENESS_REQUIRED',
      });
    }

    let effectiveThreshold = DEFAULT_MATCH_THRESHOLD;
    if (threshold !== undefined && threshold !== null) {
      const n = Number(threshold);
      if (!Number.isFinite(n) || n <= 0) {
        return bad(res, 'threshold must be a positive number');
      }
      effectiveThreshold = n;
    }

    const session = await loadSession(sessionId);
    if (!session) return bad(res, 'Session not found', 404);
    if (!isSessionOpen(session)) {
      return bad(res, 'Session is not open for attendance', 409);
    }

    // Geofence gate: if this session was started with a location + radius,
    // the student must be inside the radius for the marking to count.
    // Rejected attempts are logged but never create an attendance record,
    // so they stay neutral in analytics (same as excused).
    const geo = sessionGeofence(session);
    let studentCoords = null;
    let distanceMeters = null;
    if (geo) {
      studentCoords = parseStudentCoords(req.body || {});
      if (!studentCoords) {
        return bad(res, 'Location is required to mark attendance for this session. Please enable location access and try again.');
      }
      distanceMeters = haversineDistanceMeters(
        studentCoords.lat, studentCoords.lng, geo.campusLat, geo.campusLng,
      );
      if (distanceMeters === null) {
        return bad(res, 'Invalid location coordinates');
      }
      distanceMeters = Math.round(distanceMeters);
      if (distanceMeters > geo.radiusMeters) {
        await logAttempt({
          sessionId,
          studentId: req.user.id,
          status: 'rejected_location',
          lat: studentCoords.lat,
          lng: studentCoords.lng,
          distanceMeters,
          accuracyMeters: studentCoords.accuracy,
        });
        return res.status(403).json({
          error: `You are outside the session area (${distanceMeters} meters away) — attendance not counted.`,
          code: 'OUTSIDE_GEOFENCE',
          distanceMeters,
          radiusMeters: geo.radiusMeters,
          status: 'rejected_location',
        });
      }
    }

    const enrolled = await query(
      `SELECT id, user_id, descriptor
         FROM face_descriptors
        WHERE is_active = TRUE`,
    );

    if (enrolled.rows.length === 0) {
      return bad(res, 'No enrolled faces in the system', 404);
    }

    let best = null;
    let bestDist = Infinity;
    for (const row of enrolled.rows) {
      const stored = normalizeDescriptor(row.descriptor);
      if (!stored) continue;
      const dist = euclideanDistanceSq(normalized, stored);
      if (dist < bestDist) {
        bestDist = dist;
        best = row;
      }
    }

    if (!best || !Number.isFinite(bestDist) || bestDist > effectiveThreshold * effectiveThreshold) {
      return res.status(404).json({
        error: 'No matching enrolled face within threshold',
        threshold: effectiveThreshold,
        bestDistance: Number.isFinite(bestDist) ? Number(Math.sqrt(bestDist).toFixed(6)) : null,
      });
    }

    const matchedUser = await query(
      `SELECT id, email, full_name, role, roll_number, department, is_active
         FROM users
        WHERE id = $1
        LIMIT 1`,
      [best.user_id],
    );
    const userRow = matchedUser.rows[0];
    if (!userRow || !userRow.is_active) {
      return bad(res, 'Matched user is not active', 403);
    }
    if (userRow.role !== 'student') {
      return bad(res, 'Matched user is not a student; only students can mark attendance', 403);
    }

    const finalStatus = status || 'present';
    const VALID_STATUS = new Set(['present', 'late']);
    if (!VALID_STATUS.has(finalStatus)) {
      return bad(res, `status must be one of: ${Array.from(VALID_STATUS).join(', ')}`);
    }
    const finalMethod = method || 'face';
    if (!['face', 'manual', 'proxy'].includes(finalMethod)) {
      return bad(res, "method must be one of: face, manual, proxy");
    }

    const distance = Math.sqrt(bestDist);
    const confidence = Math.max(0, Math.min(1, 1 - distance / effectiveThreshold));

    const livenessStored = livenessPassed === true;
    let attendanceRow;
    try {
      const ins = await query(
        `INSERT INTO attendance (session_id, student_id, status, confidence, method, note, liveness_passed)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, session_id, student_id, status, marked_at, confidence, method, note, liveness_passed, created_at, updated_at`,
        [sessionId, userRow.id, finalStatus, confidence, finalMethod, note || null, livenessStored],
      );
      attendanceRow = ins.rows[0];
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({
          error: 'Attendance already marked for this student in this session',
          sessionId,
          studentId: userRow.id,
        });
      }
      throw err;
    }

    if (geo && studentCoords) {
      await logAttempt({
        sessionId,
        studentId: userRow.id,
        status: 'accepted',
        lat: studentCoords.lat,
        lng: studentCoords.lng,
        distanceMeters,
        accuracyMeters: studentCoords.accuracy,
      });
    }

    res.status(201).json({
      attendance: publicAttendance(attendanceRow),
      match: {
        userId: userRow.id,
        fullName: userRow.full_name,
        email: userRow.email,
        rollNumber: userRow.roll_number,
        distance: Number(distance.toFixed(6)),
        threshold: effectiveThreshold,
        confidence: Number(confidence.toFixed(4)),
      },
      session: { id: session.id, title: session.title, isOpen: session.is_open },
      location: geo
        ? { distanceMeters, radiusMeters: geo.radiusMeters }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/session/:sessionId', requireAuth, async (req, res, next) => {
  try {
    const session = await loadSession(req.params.sessionId);
    if (!session) return bad(res, 'Session not found', 404);

    if (req.user.role !== 'admin' && session.teacher_id !== req.user.id) {
      return bad(res, 'Only the assigned teacher or an admin can view session attendance', 403);
    }

    const result = await query(
      `SELECT a.id, a.session_id, a.student_id, a.status, a.marked_at,
              a.confidence, a.method, a.note, a.liveness_passed,
              a.created_at, a.updated_at,
              u.full_name, u.email, u.roll_number
         FROM attendance a
         JOIN users u ON u.id = a.student_id
        WHERE a.session_id = $1
        ORDER BY a.marked_at ASC`,
      [req.params.sessionId],
    );

    const records = result.rows.map((row) => ({
      ...publicAttendance(row),
      student: {
        id: row.student_id,
        fullName: row.full_name,
        email: row.email,
        rollNumber: row.roll_number,
      },
    }));

    const summary = {
      total: records.length,
      present: records.filter((r) => r.status === 'present').length,
      late: records.filter((r) => r.status === 'late').length,
      absent: records.filter((r) => r.status === 'absent').length,
      excused: records.filter((r) => r.status === 'excused').length,
    };

    res.json({ sessionId: req.params.sessionId, summary, records });
  } catch (err) {
    next(err);
  }
});

// Live attempt log for one session (teacher/admin who owns the session).
// Shows every geofence-checked marking attempt: accepted and rejected.
router.get('/session/:sessionId/attempts', requireAuth, requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const session = await loadSession(req.params.sessionId);
    if (!session) return bad(res, 'Session not found', 404);

    if (req.user.role !== 'admin' && session.teacher_id !== req.user.id) {
      return bad(res, 'Only the assigned teacher or an admin can view session attempts', 403);
    }

    const result = await query(
      `SELECT at.id, at.session_id, at.student_id, at.status,
              at.lat, at.lng, at.distance_meters, at.accuracy_meters, at.created_at,
              u.full_name, u.roll_number
         FROM attendance_attempts at
         JOIN users u ON u.id = at.student_id
        WHERE at.session_id = $1
        ORDER BY at.created_at DESC
        LIMIT 200`,
      [req.params.sessionId],
    );

    const rejected = result.rows.filter((r) => r.status === 'rejected_location').length;

    res.json({
      sessionId: req.params.sessionId,
      summary: {
        total: result.rows.length,
        accepted: result.rows.length - rejected,
        rejected: rejected,
      },
      attempts: result.rows.map(publicAttempt),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/student/:studentId', requireAuth, async (req, res, next) => {
  try {
    const targetStudentId = req.params.studentId;
    if (targetStudentId !== req.user.id && req.user.role !== 'admin') {
      return bad(res, "Only admins can view another student's attendance", 403);
    }

    const student = await query(
      `SELECT id, full_name, email, role, roll_number, department
         FROM users
        WHERE id = $1
        LIMIT 1`,
      [targetStudentId],
    );
    const stu = student.rows[0];
    if (!stu) return bad(res, 'Student not found', 404);

    const attended = await query(
      `SELECT a.id, a.session_id, a.status, a.marked_at,
              a.confidence, a.method, a.note, a.liveness_passed,
              s.title AS session_title, s.subject_id, s.start_at, s.end_at,
              sub.code AS subject_code, sub.name AS subject_name
         FROM attendance a
         JOIN sessions s ON s.id = a.session_id
         LEFT JOIN subjects sub ON sub.id = s.subject_id
        WHERE a.student_id = $1
        ORDER BY a.marked_at DESC
        LIMIT 500`,
      [targetStudentId],
    );

    // Denominator = all ended sessions in subjects the student is
    // associated with (i.e. has at least one attendance record in, of any
    // status). Sessions with no record at all count as missed, same as an
    // explicit absent. This is computed per-subject and then summed for the
    // overall figure so the breakdown and overall stay in lockstep.
    const breakdownRows = await query(
      `WITH student_subjects AS (
         SELECT DISTINCT s.subject_id
           FROM attendance a
           JOIN sessions s ON s.id = a.session_id
          WHERE a.student_id = $1
            AND s.subject_id IS NOT NULL
       ),
       subject_sessions AS (
         SELECT s.id, s.subject_id
           FROM sessions s
           JOIN student_subjects ss ON ss.subject_id = s.subject_id
          WHERE s.end_at < NOW()
       ),
       subject_present AS (
         SELECT s.subject_id,
                COUNT(DISTINCT s.id) FILTER (
                  WHERE a.status IN ('present', 'late')
                )::int AS attended,
                COUNT(DISTINCT a.id)::int AS records
           FROM sessions s
           LEFT JOIN attendance a
             ON a.session_id = s.id AND a.student_id = $1
          WHERE s.end_at < NOW()
            AND s.subject_id IN (SELECT subject_id FROM student_subjects)
          GROUP BY s.subject_id
       )
       SELECT sub.id          AS subject_id,
              sub.code        AS subject_code,
              sub.name        AS subject_name,
              COALESCE((SELECT COUNT(*) FROM subject_sessions ss WHERE ss.subject_id = sub.id), 0)::int AS total_sessions,
              COALESCE(sp.attended, 0)::int   AS attended,
              COALESCE(sp.records, 0)::int    AS records
         FROM subjects sub
         LEFT JOIN subject_present sp ON sp.subject_id = sub.id
        WHERE sub.id IN (SELECT subject_id FROM student_subjects)`,
      [targetStudentId],
    );

    let totalSessionsCount = 0;
    let totalAttendedCount = 0;
    const subjectsBreakdown = breakdownRows.rows.map((r) => {
      const total = Number(r.total_sessions) || 0;
      const attended = Number(r.attended) || 0;
      totalSessionsCount += total;
      totalAttendedCount += attended;
      const pct = total > 0 ? Math.round((attended / total) * 10000) / 100 : 0;
      return {
        id: r.subject_id,
        code: r.subject_code,
        name: r.subject_name,
        total,
        attended,
        records: Number(r.records) || 0,
        missed: Math.max(0, total - attended),
        percentage: pct,
      };
    });

    let percentage = totalSessionsCount > 0
      ? Math.round((totalAttendedCount / totalSessionsCount) * 10000) / 100
      : 0;
    if (percentage > 100) percentage = 100;

    const history = attended.rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      sessionTitle: row.session_title,
      subject: row.subject_id ? { id: row.subject_id, code: row.subject_code, name: row.subject_name } : null,
      startAt: row.start_at,
      endAt: row.end_at,
      status: row.status,
      markedAt: row.marked_at,
      confidence: row.confidence === null ? null : Number(row.confidence),
      method: row.method,
      livenessPassed: row.liveness_passed === null ? null : Boolean(row.liveness_passed),
      note: row.note,
    }));

    res.json({
      student: {
        id: stu.id,
        fullName: stu.full_name,
        email: stu.email,
        rollNumber: stu.roll_number,
        department: stu.department,
      },
      stats: {
        sessionsAttended: totalAttendedCount,
        totalPastSessions: totalSessionsCount,
        attendancePercentage: percentage,
      },
      subjectsBreakdown,
      history,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;