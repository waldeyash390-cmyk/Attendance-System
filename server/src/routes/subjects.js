const express = require('express');
const { query } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const router = express.Router();
function bad(res, msg, status = 400) {
  return res.status(status).json({ error: msg });
}
function publicSubject(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    department: row.department,
    semester: row.semester,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { department, semester, q } = req.query;
    const where = [];
    const params = [];
    if (department) {
      params.push(String(department));
      where.push(`department = $${params.length}`);
    }
    if (semester) {
      const n = Number(semester);
      if (!Number.isInteger(n) || n < 1 || n > 12) return bad(res, 'semester must be 1-12');
      params.push(n);
      where.push(`semester = $${params.length}`);
    }
    if (q) {
      params.push(`%${String(q)}%`);
      where.push(`(name ILIKE $${params.length} OR code ILIKE $${params.length})`);
    }
    const sql = `
      SELECT id, code, name, department, semester, created_by, created_at, updated_at
        FROM subjects
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY code ASC
       LIMIT 200`;
    const result = await query(sql, params);
    res.json({ subjects: result.rows.map(publicSubject) });
  } catch (err) {
    next(err);
  }
});
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, code, name, department, semester, created_by, created_at, updated_at
         FROM subjects WHERE id = $1 LIMIT 1`,
      [req.params.id],
    );
    const row = result.rows[0];
    if (!row) return bad(res, 'Subject not found', 404);
    res.json({ subject: publicSubject(row) });
  } catch (err) {
    next(err);
  }
});
router.post('/', requireAuth, requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const { code, name, department, semester } = req.body || {};
    if (!code || !name) return bad(res, 'code and name are required');
    let sem = null;
    if (semester !== undefined && semester !== null && semester !== '') {
      const n = Number(semester);
      if (!Number.isInteger(n) || n < 1 || n > 12) return bad(res, 'semester must be 1-12');
      sem = n;
    }
    let row;
    try {
      const result = await query(
        `INSERT INTO subjects (code, name, department, semester, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, code, name, department, semester, created_by, created_at, updated_at`,
        [String(code).trim(), String(name).trim(), department || null, sem, req.user.id],
      );
      row = result.rows[0];
    } catch (err) {
      if (err.code === '23505' && err.constraint && err.constraint.includes('code')) {
        return bad(res, 'subject code already exists', 409);
      }
      throw err;
    }
    res.status(201).json({ subject: publicSubject(row) });
  } catch (err) {
    next(err);
  }
});
router.put('/:id', requireAuth, requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const existing = await query(`SELECT id FROM subjects WHERE id = $1 LIMIT 1`, [req.params.id]);
    if (!existing.rows[0]) return bad(res, 'Subject not found', 404);

    const { code, name, department, semester } = req.body || {};
    if (!code || !name) return bad(res, 'code and name are required');

    let sem = null;
    if (semester !== undefined && semester !== null && semester !== '') {
      const n = Number(semester);
      if (!Number.isInteger(n) || n < 1 || n > 12) return bad(res, 'semester must be 1-12');
      sem = n;
    }

    let row;
    try {
      const result = await query(
        `UPDATE subjects SET code = $1, name = $2, department = $3, semester = $4
         WHERE id = $5
         RETURNING id, code, name, department, semester, created_by, created_at, updated_at`,
        [String(code).trim(), String(name).trim(), department || null, sem, req.params.id],
      );
      row = result.rows[0];
    } catch (err) {
      if (err.code === '23505' && err.constraint && err.constraint.includes('code')) {
        return bad(res, 'subject code already exists', 409);
      }
      throw err;
    }
    res.json({ subject: publicSubject(row) });
  } catch (err) {
    next(err);
  }
});
router.delete('/:id', requireAuth, requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const result = await query(`DELETE FROM subjects WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!result.rows[0]) return bad(res, 'Subject not found', 404);
    res.json({ deleted: true, id: req.params.id });
  } catch (err) {
    next(err);
  }
});
module.exports = router;