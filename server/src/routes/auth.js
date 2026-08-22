const express = require('express');
const bcrypt = require('bcrypt');
const { query } = require('../db');
const { signToken, requireAuth, requireRole } = require('../auth');
const router = express.Router();
const ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 10;
const VALID_ROLES = new Set(['student', 'teacher', 'admin']);
function bad(res, msg, status = 400) {
  return res.status(status).json({ error: msg });
}
function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    rollNumber: row.roll_number,
    department: row.department,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, fullName, role, rollNumber, department, inviteCode } = req.body || {};
    if (!email || !password || !fullName) {
      return bad(res, 'email, password and fullName are required');
    }
    if (typeof password !== 'string' || password.length < 8) {
      return bad(res, 'password must be at least 8 characters');
    }
    const finalRole = role || 'student';
    if (!VALID_ROLES.has(finalRole)) {
      return bad(res, `role must be one of: ${Array.from(VALID_ROLES).join(', ')}`);
    }
    if (finalRole === 'student' && !rollNumber) {
      return bad(res, 'rollNumber is required for student role');
    }
    if (finalRole === 'teacher') {
      const requiredCode = process.env.TEACHER_INVITE_CODE;
      if (!requiredCode) {
        return bad(res, 'Teacher registration is currently disabled', 403);
      }
      if (!inviteCode || inviteCode !== requiredCode) {
        return bad(res, 'Invalid teacher invite code', 403);
      }
    }
    const hash = await bcrypt.hash(password, ROUNDS);
    let row;
    try {
      const result = await query(
        `INSERT INTO users (email, password_hash, full_name, role, roll_number, department)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, email, full_name, role, roll_number, department, is_active, created_at`,
        [String(email).toLowerCase().trim(), hash, fullName, finalRole, rollNumber || null, department || null],
      );
      row = result.rows[0];
    } catch (err) {
      if (err.code === '23505') {
        const constraint = err.constraint || '';
        const field = constraint.includes('email') ? 'email'
                    : constraint.includes('roll_number') ? 'rollNumber'
                    : 'field';
        return bad(res, `${field} already in use`, 409);
      }
      throw err;
    }
    const token = signToken({ sub: row.id, role: row.role, email: row.email });
    res.status(201).json({ user: publicUser(row), token });
  } catch (err) {
    next(err);
  }
});
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return bad(res, 'email and password are required');
    const result = await query(
      `SELECT id, email, password_hash, full_name, role, roll_number, department, is_active, created_at
         FROM users
        WHERE email = $1
        LIMIT 1`,
      [String(email).toLowerCase().trim()],
    );
    const row = result.rows[0];
    const ok = row ? await bcrypt.compare(password, row.password_hash) : false;
    if (!row || !ok) return bad(res, 'Invalid credentials', 401);
    if (!row.is_active) return bad(res, 'Account is disabled', 403);
    const token = signToken({ sub: row.id, role: row.role, email: row.email });
    res.json({ user: publicUser(row), token });
  } catch (err) {
    next(err);
  }
});
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, email, full_name, role, roll_number, department, is_active, created_at
         FROM users
        WHERE id = $1
        LIMIT 1`,
      [req.user.id],
    );
    const row = result.rows[0];
    if (!row) return bad(res, 'User not found', 404);
    res.json({ user: publicUser(row) });
  } catch (err) {
    next(err);
  }
});
router.get('/lookup', requireAuth, requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const { email, rollNumber } = req.query;
    if (!email && !rollNumber) {
      return bad(res, 'email or rollNumber is required');
    }
    let result;
    if (email) {
      result = await query(
        `SELECT id, email, full_name, role, roll_number FROM users WHERE email = $1 LIMIT 1`,
        [String(email).toLowerCase().trim()],
      );
    } else {
      result = await query(
        `SELECT id, email, full_name, role, roll_number FROM users WHERE roll_number = $1 LIMIT 1`,
        [rollNumber],
      );
    }
    const row = result.rows[0];
    if (!row) return bad(res, 'User not found', 404);
    if (row.role !== 'student') return bad(res, 'User is not a student', 400);
    res.json({ user: publicUser(row) });
  } catch (err) {
    next(err);
  }
});
module.exports = router;