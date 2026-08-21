const express = require('express');
const { query } = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();

function bad(res, msg, status = 400) {
  return res.status(status).json({ error: msg });
}

function publicSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    subjectId: row.subject_id,
    teacherId: row.teacher_id,
    teacherName: row.teacher_name || null,
    title: row.title,
    startAt: row.start_at,
    endAt: row.end_at,
    location: row.location,
    isOpen: row.is_open,
    opensAt: row.opens_at,
    closesAt: row.closes_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadSession(id) {
  const result = await query(
    `SELECT s.id, s.subject_id, s.teacher_id, s.title, s.start_at, s.end_at,
            s.location, s.is_open, s.opens_at, s.closes_at, s.created_at, s.updated_at,
            u.full_name AS teacher_name
       FROM sessions s
       LEFT JOIN users u ON u.id = s.teacher_id
      WHERE s.id = $1
      LIMIT 1`,
    [id],
  );
  return result.rows[0] || null;
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { subjectId, teacherId, openOnly, upcoming } = req.query;
    const where = [];
    const params = [];
    if (subjectId) {
      params.push(subjectId);
      where.push(`s.subject_id = $${params.length}`);
    }
    if (teacherId) {
      params.push(teacherId);
      where.push(`s.teacher_id = $${params.length}`);
    }
    if (openOnly === 'true') where.push('s.is_open = TRUE');
    if (upcoming === 'true') where.push('s.end_at >= NOW()');

    const sql = `
      SELECT s.id, s.subject_id, s.teacher_id, s.title, s.start_at, s.end_at,
             s.location, s.is_open, s.opens_at, s.closes_at, s.created_at, s.updated_at,
             u.full_name AS teacher_name
        FROM sessions s
        LEFT JOIN users u ON u.id = s.teacher_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY s.start_at DESC
       LIMIT 200`;
    const result = await query(sql, params);
    res.json({ sessions: result.rows.map(publicSession) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const row = await loadSession(req.params.id);
    if (!row) return bad(res, 'Session not found', 404);
    res.json({ session: publicSession(row) });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAuth, requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const { subjectId, teacherId, title, startAt, endAt, location, opensAt, closesAt, isOpen } = req.body || {};
    if (!subjectId || !startAt || !endAt) return bad(res, 'subjectId, startAt, endAt are required');

    const start = new Date(startAt);
    const end = new Date(endAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return bad(res, 'startAt and endAt must be valid ISO timestamps');
    }
    if (end <= start) return bad(res, 'endAt must be after startAt');

    let opens = null, closes = null;
    if (opensAt) {
      opens = new Date(opensAt);
      if (Number.isNaN(opens.getTime())) return bad(res, 'opensAt must be a valid ISO timestamp');
    }
    if (closesAt) {
      closes = new Date(closesAt);
      if (Number.isNaN(closes.getTime())) return bad(res, 'closesAt must be a valid ISO timestamp');
    }
    if (opens && closes && closes <= opens) return bad(res, 'closesAt must be after opensAt');

    let effectiveTeacherId = teacherId || req.user.id;
    if (teacherId && teacherId !== req.user.id && req.user.role !== 'admin') {
      return bad(res, 'Only admins can assign another teacher', 403);
    }

    const subj = await query(`SELECT id FROM subjects WHERE id = $1 LIMIT 1`, [subjectId]);
    if (!subj.rows[0]) return bad(res, 'Subject not found', 404);

    const t = await query(`SELECT id, role FROM users WHERE id = $1 LIMIT 1`, [effectiveTeacherId]);
    if (!t.rows[0]) return bad(res, 'Teacher not found', 404);
    if (!['teacher', 'admin'].includes(t.rows[0].role)) {
      return bad(res, 'Assigned user must have teacher or admin role', 400);
    }

    const ins = await query(
      `INSERT INTO sessions
         (subject_id, teacher_id, title, start_at, end_at, location, is_open, opens_at, closes_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, subject_id, teacher_id, title, start_at, end_at, location, is_open, opens_at, closes_at, created_at, updated_at`,
      [subjectId, effectiveTeacherId, title || null, start.toISOString(), end.toISOString(),
       location || null, isOpen !== undefined ? Boolean(isOpen) : true, opens ? opens.toISOString() : null, closes ? closes.toISOString() : null],
    );
    const row = ins.rows[0];
    const full = await loadSession(row.id);
    res.status(201).json({ session: publicSession(full) });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireAuth, requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const existing = await loadSession(req.params.id);
    if (!existing) return bad(res, 'Session not found', 404);

    if (req.user.role !== 'admin' && existing.teacher_id !== req.user.id) {
      return bad(res, 'Only the assigned teacher or an admin can edit this session', 403);
    }

    const { title, startAt, endAt, location, opensAt, closesAt } = req.body || {};
    if (!startAt || !endAt) return bad(res, 'startAt and endAt are required');

    const start = new Date(startAt);
    const end = new Date(endAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return bad(res, 'startAt and endAt must be valid ISO timestamps');
    }
    if (end <= start) return bad(res, 'endAt must be after startAt');

    let opens = null, closes = null;
    if (opensAt) {
      opens = new Date(opensAt);
      if (Number.isNaN(opens.getTime())) return bad(res, 'opensAt must be a valid ISO timestamp');
    }
    if (closesAt) {
      closes = new Date(closesAt);
      if (Number.isNaN(closes.getTime())) return bad(res, 'closesAt must be a valid ISO timestamp');
    }
    if (opens && closes && closes <= opens) return bad(res, 'closesAt must be after opensAt');

    await query(
      `UPDATE sessions SET title = $1, start_at = $2, end_at = $3, location = $4, opens_at = $5, closes_at = $6
       WHERE id = $7`,
      [title || null, start.toISOString(), end.toISOString(), location || null,
       opens ? opens.toISOString() : null, closes ? closes.toISOString() : null, req.params.id],
    );
    const fresh = await loadSession(req.params.id);
    res.json({ session: publicSession(fresh) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireAuth, requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const existing = await loadSession(req.params.id);
    if (!existing) return bad(res, 'Session not found', 404);

    if (req.user.role !== 'admin' && existing.teacher_id !== req.user.id) {
      return bad(res, 'Only the assigned teacher or an admin can delete this session', 403);
    }

    await query(`DELETE FROM sessions WHERE id = $1`, [req.params.id]);
    res.json({ deleted: true, id: req.params.id });
  } catch (err) {
    next(err);
  }
});

async function setOpen(req, res, next, open) {
  try {
    const row = await loadSession(req.params.id);
    if (!row) return bad(res, 'Session not found', 404);

    if (req.user.role !== 'admin' && row.teacher_id !== req.user.id) {
      return bad(res, 'Only the assigned teacher or an admin can change session state', 403);
    }

    const upd = await query(
      `UPDATE sessions SET is_open = $1 WHERE id = $2
       RETURNING id, subject_id, teacher_id, title, start_at, end_at, location, is_open, opens_at, closes_at, created_at, updated_at`,
      [open, req.params.id],
    );
    const fresh = await loadSession(upd.rows[0].id);
    res.json({ session: publicSession(fresh) });
  } catch (err) {
    next(err);
  }
}

router.post('/:id/open', requireAuth, requireRole('teacher', 'admin'), (req, res, next) => setOpen(req, res, next, true));
router.post('/:id/close', requireAuth, requireRole('teacher', 'admin'), (req, res, next) => setOpen(req, res, next, false));

module.exports = router;