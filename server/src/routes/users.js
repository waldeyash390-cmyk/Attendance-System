const express = require('express');
const { query } = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();

router.get('/', requireAuth, requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const { role, q, department, activeOnly } = req.query || {};
    const params = [];
    const where = [];

    if (role) {
      params.push(String(role));
      where.push(`role = $${params.length}`);
    } else {
      where.push(`role IN ('student', 'teacher')`);
    }

    if (department) {
      params.push(String(department));
      where.push(`department = $${params.length}`);
    }

    if (activeOnly === 'true') {
      where.push(`is_active = TRUE`);
    }

    if (q) {
      params.push(`%${String(q).toLowerCase()}%`);
      const idx = params.length;
      where.push(`(LOWER(full_name) LIKE $${idx} OR LOWER(email) LIKE $${idx} OR LOWER(COALESCE(roll_number, '')) LIKE $${idx})`);
    }

    const sql = `
      SELECT id, email, full_name, role, roll_number, department, phone_number, is_active, created_at
        FROM users
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY role ASC, full_name ASC
       LIMIT 500`;
    const result = await query(sql, params);

    const users = result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      role: row.role,
      rollNumber: row.roll_number,
      department: row.department,
      phoneNumber: row.phone_number,
      isActive: row.is_active,
      createdAt: row.created_at,
    }));

    res.json({ users });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
