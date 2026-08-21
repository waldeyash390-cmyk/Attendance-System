const express = require('express');
const { query } = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();

const DESCRIPTOR_LENGTH = 128;

const DEFAULT_MATCH_THRESHOLD = Number(process.env.FACE_MATCH_THRESHOLD) || 0.6;
if (!Number.isFinite(DEFAULT_MATCH_THRESHOLD) || DEFAULT_MATCH_THRESHOLD <= 0) {
  console.warn('[attendance] FACE_MATCH_THRESHOLD must be a positive number; using default 0.6');
}

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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadSession(id) {
  const result = await query(
    `SELECT id, subject_id, teacher_id, title, start_at, end_at,
            location, is_open, opens_at, closes_at, created_at, updated_at
       FROM sessions
      WHERE id = $1
      LIMIT 1`,
    [id],
  );
  return result.rows[0] || null;
}

function isSessionOpen(session, now = new Date()) {
  if (!session.is_open) return false;
  if (session.opens_at && now < new Date(session.opens_at)) return false;
  if (session.closes_at && now > new Date(session.closes_at)) return false;
  return true;
}

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

    let attendanceRow;
    try {
      const ins = await query(
        `INSERT INTO attendance (session_id, student_id, status, confidence, method, note)
         VALUES ($1, $2, $3, NULL, 'manual', $4)
         RETURNING id, session_id, student_id, status, marked_at, confidence, method, note, created_at, updated_at`,
        [sessionId, studentId, finalStatus, note || null],
      );
      attendanceRow = ins.rows[0];
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({
          error: 'Attendance already marked for this student in this session',
          sessionId,
          studentId,
        });
      }
      throw err;
    }

    res.status(201).json({ attendance: publicAttendance(attendanceRow) });
  } catch (err) {
    next(err);
  }
});

router.post('/mark', requireAuth, async (req, res, next) => {
  try {
    const { sessionId, descriptor, threshold, status, note, method } = req.body || {};

    if (!sessionId) return bad(res, 'sessionId is required');
    const normalized = normalizeDescriptor(descriptor);
    if (!normalized) {
      return bad(res, `descriptor must be an array of ${DESCRIPTOR_LENGTH} finite numbers`);
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

    let attendanceRow;
    try {
      const ins = await query(
        `INSERT INTO attendance (session_id, student_id, status, confidence, method, note)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, session_id, student_id, status, marked_at, confidence, method, note, created_at, updated_at`,
        [sessionId, userRow.id, finalStatus, confidence, finalMethod, note || null],
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
              a.confidence, a.method, a.note, a.created_at, a.updated_at,
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
              a.confidence, a.method, a.note,
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

    const totalSessions = await query(
      `SELECT COUNT(*)::int AS n FROM sessions
        WHERE end_at < NOW()`,
    );
    const total = totalSessions.rows[0].n;

    const presentRows = attended.rows.filter((r) => r.status === 'present' || r.status === 'late').length;
    const percentage = total > 0 ? Math.round((presentRows / total) * 10000) / 100 : 0;

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
        sessionsAttended: presentRows,
        totalPastSessions: total,
        attendancePercentage: percentage,
      },
      history,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;