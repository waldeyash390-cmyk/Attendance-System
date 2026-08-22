const express = require('express');
const { query } = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();

const DEFAULT_DEFAULTER_THRESHOLD = 75;
const MIN_DEFAULTER_THRESHOLD = 0;
const MAX_DEFAULTER_THRESHOLD = 100;

function bad(res, msg, status = 400) {
  return res.status(status).json({ error: msg });
}

function parseRange(queryParams) {
  const out = { from: null, to: null };
  if (queryParams.from) {
    const d = new Date(queryParams.from);
    if (Number.isNaN(d.getTime())) return { error: 'from is not a valid ISO timestamp' };
    out.from = d.toISOString();
  }
  if (queryParams.to) {
    const d = new Date(queryParams.to);
    if (Number.isNaN(d.getTime())) return { error: 'to is not a valid ISO timestamp' };
    out.to = d.toISOString();
  }
  if (out.from && out.to && out.to < out.from) {
    return { error: 'to must be after from' };
  }
  return out;
}

function parseThreshold(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_DEFAULTER_THRESHOLD;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n < MIN_DEFAULTER_THRESHOLD || n > MAX_DEFAULTER_THRESHOLD) return null;
  return n;
}

// Aggregate per-student attendance against the sessions of one subject that
// have already ended. Excused is treated as neutral: present/late count as
// attended, absent counts as missed, excused is not counted either way.
async function loadSubjectAnalytics({ subjectId, fromIso, toIso }) {
  const sessionWhere = [
    's.subject_id = $1',
    "s.end_at < NOW()",
  ];
  const sessionParams = [subjectId];
  if (fromIso) {
    sessionParams.push(fromIso);
    sessionWhere.push(`s.start_at >= $${sessionParams.length}`);
  }
  if (toIso) {
    sessionParams.push(toIso);
    sessionWhere.push(`s.start_at <= $${sessionParams.length}`);
  }

  const sql = `
    WITH subject_sessions AS (
      SELECT s.id, s.start_at, s.end_at
        FROM sessions s
       WHERE ${sessionWhere.join(' AND ')}
    ),
    counts AS (
      SELECT
        a.student_id,
        COUNT(*) FILTER (WHERE a.status IN ('present','late'))::int AS attended,
        COUNT(*) FILTER (WHERE a.status = 'absent')::int               AS absent,
        COUNT(*) FILTER (WHERE a.status = 'late')::int                AS late,
        COUNT(*) FILTER (WHERE a.status = 'present')::int             AS present,
        COUNT(*) FILTER (WHERE a.status = 'excused')::int             AS excused,
        COUNT(*)::int                                                  AS marked
      FROM attendance a
      JOIN subject_sessions ss ON ss.id = a.session_id
      GROUP BY a.student_id
    )
    SELECT
      u.id,
      u.full_name,
      u.email,
      u.roll_number,
      u.department,
      COALESCE(c.attended, 0) AS attended,
      COALESCE(c.absent,   0) AS absent,
      COALESCE(c.late,     0) AS late,
      COALESCE(c.present,  0) AS present,
      COALESCE(c.excused,  0) AS excused,
      COALESCE(c.marked,   0) AS marked,
      (SELECT COUNT(*) FROM subject_sessions)::int AS sessions_held
    FROM users u
    LEFT JOIN counts c ON c.student_id = u.id
    WHERE u.role = 'student' AND u.is_active = TRUE
    ORDER BY u.full_name ASC
  `;

  const result = await query(sql, sessionParams);
  const sessionsHeld = result.rows[0] ? Number(result.rows[0].sessions_held) : 0;

  const students = result.rows.map((r) => {
    const attended = Number(r.attended) || 0;
    const absent = Number(r.absent) || 0;
    const present = Number(r.present) || 0;
    const late = Number(r.late) || 0;
    const excused = Number(r.excused) || 0;
    const marked = Number(r.marked) || 0;
    const denominator = attended + absent; // present/late + absent only — excused excluded
    const percentage = denominator > 0 ? (attended / denominator) * 100 : 0;
    return {
      id: r.id,
      fullName: r.full_name,
      email: r.email,
      rollNumber: r.roll_number,
      department: r.department,
      sessionsHeld: sessionsHeld,
      attended,
      present,
      late,
      absent,
      excused,
      marked,
      missed: Math.max(0, sessionsHeld - marked),
      percentage: Math.round(percentage * 100) / 100,
    };
  });

  return { sessionsHeld, students };
}

function publicSubject(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    department: row.department,
    semester: row.semester,
  };
}

async function loadSubject(id) {
  const r = await query(
    `SELECT id, code, name, department, semester FROM subjects WHERE id = $1 LIMIT 1`,
    [id],
  );
  return r.rows[0] || null;
}

function summarize(students, threshold) {
  const total = students.length;
  const classAttended = students.reduce((s, x) => s + x.attended, 0);
  const classAbsent = students.reduce((s, x) => s + x.absent, 0);
  const denominator = classAttended + classAbsent;
  const classPct = denominator > 0 ? (classAttended / denominator) * 100 : 0;
  const defaulters = students
    .filter((s) => s.sessionsHeld > 0 && s.percentage < threshold)
    .sort((a, b) => a.percentage - b.percentage);
  return {
    studentCount: total,
    classAttendancePercentage: Math.round(classPct * 100) / 100,
    defaulterCount: defaulters.length,
    defaulters,
  };
}

// CSV helpers ---------------------------------------------------------------

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  // Quote if contains comma, quote, newline, or carriage return.
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function csvRow(values) {
  return values.map(csvEscape).join(',');
}

function buildAnalyticsCsv({ subject, fromIso, toIso, threshold, sessionsHeld, students, summary }) {
  const rows = [];
  rows.push(csvRow(['Attendance Report']));
  rows.push(csvRow(['Subject', subject ? `${subject.code} - ${subject.name}` : '']));
  rows.push(csvRow(['Subject code', subject ? subject.code : '']));
  rows.push(csvRow(['Department', subject ? (subject.department || '') : '']));
  rows.push(csvRow(['Semester', subject && subject.semester != null ? subject.semester : '']));
  rows.push(csvRow(['Date range', `${fromIso || 'all time'} to ${toIso || 'now'}`]));
  rows.push(csvRow(['Sessions held (ended)', String(sessionsHeld)]));
  rows.push(csvRow(['Defaulter threshold', `${threshold}%`]));
  rows.push(csvRow(['Class attendance %', summary.classAttendancePercentage.toFixed(2)]));
  rows.push(csvRow(['Defaulter count', String(summary.defaulterCount)]));
  rows.push(csvRow(['Students in roster', String(summary.studentCount)]));
  rows.push(csvRow([]));
  rows.push(csvRow([
    'Roll number', 'Full name', 'Email', 'Department',
    'Sessions held', 'Present', 'Late', 'Excused', 'Absent', 'Missed (no record)',
    'Attended (present+late)', 'Attendance %', 'Defaulter (< threshold)',
  ]));
  students.forEach((s) => {
    rows.push(csvRow([
      s.rollNumber || '',
      s.fullName || '',
      s.email || '',
      s.department || '',
      s.sessionsHeld,
      s.present,
      s.late,
      s.excused,
      s.absent,
      s.missed,
      s.attended,
      s.percentage.toFixed(2),
      (s.sessionsHeld > 0 && s.percentage < threshold) ? 'YES' : 'no',
    ]));
  });
  // \r\n is the most Excel-friendly line terminator.
  return '\uFEFF' + rows.join('\r\n') + '\r\n';
}

function safeFilenamePart(s) {
  return String(s || 'subject').replace(/[^a-z0-9-_]+/gi, '_').slice(0, 60) || 'subject';
}

// Routes --------------------------------------------------------------------

router.get('/subject/:subjectId', requireAuth, requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const { subjectId } = req.params;
    const threshold = parseThreshold(req.query.threshold);
    if (threshold === null) {
      return bad(res, `threshold must be a number between ${MIN_DEFAULTER_THRESHOLD} and ${MAX_DEFAULTER_THRESHOLD}`);
    }
    const range = parseRange(req.query);
    if (range.error) return bad(res, range.error);

    const subject = await loadSubject(subjectId);
    if (!subject) return bad(res, 'Subject not found', 404);

    const { sessionsHeld, students } = await loadSubjectAnalytics({
      subjectId,
      fromIso: range.from,
      toIso: range.to,
    });

    const summary = summarize(students, threshold);

    res.json({
      subject: publicSubject(subject),
      range: { from: range.from, to: range.to },
      threshold,
      sessionsHeld,
      summary,
      students,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/subject/:subjectId/export.csv', requireAuth, requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const { subjectId } = req.params;
    const threshold = parseThreshold(req.query.threshold);
    if (threshold === null) {
      return bad(res, `threshold must be a number between ${MIN_DEFAULTER_THRESHOLD} and ${MAX_DEFAULTER_THRESHOLD}`);
    }
    const range = parseRange(req.query);
    if (range.error) return bad(res, range.error);

    const subject = await loadSubject(subjectId);
    if (!subject) return bad(res, 'Subject not found', 404);

    const { sessionsHeld, students } = await loadSubjectAnalytics({
      subjectId,
      fromIso: range.from,
      toIso: range.to,
    });
    const summary = summarize(students, threshold);

    const csv = buildAnalyticsCsv({
      subject,
      fromIso: range.from,
      toIso: range.to,
      threshold,
      sessionsHeld,
      students,
      summary,
    });

    const filename = `attendance_${safeFilenamePart(subject.code)}_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(csv);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
