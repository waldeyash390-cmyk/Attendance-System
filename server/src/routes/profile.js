const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { query } = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();

// Photo storage location. Files land on disk under server/uploads/ and are
// served back to the browser as <img src="/api/uploads/">.
const UPLOAD_DIR = path.resolve(__dirname, '..', '..', 'uploads');
const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10MB

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const PHOTO_MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg':  '.jpg',
  'image/png':  '.png',
  'image/webp': '.webp',
  'image/gif':  '.gif',
};

function bad(res, msg, status = 400) {
  return res.status(status).json({ error: msg });
}

// The student profile is a small subset of columns on `users`. This mapper
// flattens a row from pg into the shape the SPA expects.
function publicProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    rollNumber: row.roll_number,
    department: row.department,
    phoneNumber: row.phone_number,
    profilePhotoUrl: row.profile_photo_url,
    editCount: row.edit_count == null ? 0 : Number(row.edit_count),
    profileLocked: Boolean(row.profile_locked),
    profileUpdatedAt: row.profile_updated_at,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

const PROFILE_COLUMNS = `
  id, email, full_name, role, roll_number, department,
  phone_number, profile_photo_url, edit_count, profile_locked,
  profile_updated_at, is_active, created_at
`;

async function loadUser(id) {
  const r = await query(
    `SELECT ${PROFILE_COLUMNS} FROM users WHERE id = $1 LIMIT 1`,
    [id],
  );
  return r.rows[0] || null;
}

// Accepts any string of digits/optional leading + of length 10 to 15. Loose
// on purpose — international formats vary — but rejects letters, whitespace,
// and obvious garbage. The same regex is shared by the registration route.
function isValidPhone(raw) {
  if (raw == null) return false;
  const s = String(raw).trim();
  if (!s) return false;
  // Allow an optional leading +, then 10 to 15 digits.
  return /^\+?[0-9]{10,15}$/.test(s);
}

function normalizePhone(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/[\s\-()]/g, '');
  return s || null;
}

// Parse a data-URL or a raw base64 string and write it to disk. Returns the
// public URL the SPA should store on the user record. Rejects anything that
// isn't an image MIME in the allow-list, anything over the size limit,
// and anything that can't be decoded as base64.
function persistProfilePhoto({ data, ownerId }) {
  let mime = null;
  let b64 = null;

  if (typeof data !== 'string' || !data) {
    return { error: 'photo data is required' };
  }

  const m = data.match(/^data:([^;]+);base64,(.+)$/);
  if (m) {
    mime = m[1].toLowerCase();
    b64 = m[2];
  } else {
    // Bare base64. Default to JPEG when the client doesn't say.
    mime = 'image/jpeg';
    b64 = data;
  }

  if (!PHOTO_MIME_TO_EXT[mime]) {
    return { error: 'photo must be an image (jpg, png, webp, or gif)' };
  }

  let buf;
  try {
    buf = Buffer.from(b64, 'base64');
  } catch (err) {
    return { error: 'photo is not valid base64' };
  }
  if (!buf || buf.length === 0) {
    return { error: 'photo is empty' };
  }
  if (buf.length > MAX_PHOTO_BYTES) {
    return { error: `photo must be at most ${MAX_PHOTO_BYTES / (1024 * 1024)}MB` };
  }

  const ext = PHOTO_MIME_TO_EXT[mime];
  const filename = `profile_${ownerId}_${crypto.randomBytes(6).toString('hex')}${ext}`;
  const fullPath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(fullPath, buf);
  return { url: `/api/uploads/${filename}`, filename, bytes: buf.length };
}

// Best-effort cleanup when a user uploads a new photo: we try to remove the
// old file from disk. Failure here is logged and ignored — a stale file
// doesn't break the API.
function tryDeletePhotoFile(publicUrl) {
  if (!publicUrl) return;
  const m = String(publicUrl).match(/^\/api\/uploads\/([^/?#]+)$/);
  if (!m) return;
  const filename = m[1];
  // Only ever delete files inside UPLOAD_DIR. Bail out if anything tries
  // to point at "../" or other escape sequences.
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return;
  }
  const fullPath = path.join(UPLOAD_DIR, filename);
  fs.unlink(fullPath, (err) => {
    if (err && err.code !== 'ENOENT') {
      console.warn('[profile] failed to delete old photo', fullPath, err.message);
    }
  });
}

// GET /api/profile/me — current user's own profile. Used by the student on
// their "My Profile" page.
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const row = await loadUser(req.user.id);
    if (!row) return bad(res, 'User not found', 404);
    res.json({ profile: publicProfile(row) });
  } catch (err) {
    next(err);
  }
});

// PUT /api/profile/me — student updates their own profile. The server is
// the single source of truth for the one-time edit lock: once edit_count is
// non-zero (or profile_locked is true) we reject further self-saves with
// 403. Teachers editing a student go through /api/profile/:userId instead,
// which bypasses this gate.
router.put('/me', requireAuth, async (req, res, next) => {
  try {
    const existing = await loadUser(req.user.id);
    if (!existing) return bad(res, 'User not found', 404);

    if (existing.role !== 'student') {
      return bad(res, 'Only students use this endpoint to set up their profile', 400);
    }

    if (existing.profile_locked || Number(existing.edit_count || 0) >= 1) {
      return bad(res, 'Your profile has been set and can no longer be edited. Contact your teacher if you need to make a correction.', 403);
    }

    const { fullName, rollNumber, email, phoneNumber, profilePhoto } = req.body || {};

    const updates = [];
    const params = [];
    let nextIdx = 1;

    if (fullName != null) {
      const name = String(fullName).trim();
      if (name.length < 2) return bad(res, 'fullName must be at least 2 characters');
      params.push(name);
      updates.push(`full_name = $${nextIdx++}`);
    }

    if (rollNumber != null) {
      const roll = String(rollNumber).trim();
      if (!roll) return bad(res, 'rollNumber is required');
      params.push(roll);
      updates.push(`roll_number = $${nextIdx++}`);
    }

    if (email != null) {
      const mail = String(email).trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) {
        return bad(res, 'email is not valid');
      }
      params.push(mail);
      updates.push(`email = $${nextIdx++}`);
    }

    if (phoneNumber != null) {
      const phone = normalizePhone(phoneNumber);
      if (!isValidPhone(phone)) {
        return bad(res, 'phoneNumber must be 10-15 digits (optional leading +)');
      }
      params.push(phone);
      updates.push(`phone_number = $${nextIdx++}`);
    }

    // Optional photo upload. Either pass `null` (no change) or omit it
    // (no change) or pass a base64 data URL to replace the current photo.
    let newPhotoUrl = null;
    let photoReplaced = false;
    if (profilePhoto) {
      const result = persistProfilePhoto({ data: profilePhoto, ownerId: existing.id });
      if (result.error) return bad(res, result.error);
      newPhotoUrl = result.url;
      photoReplaced = true;
      params.push(newPhotoUrl);
      updates.push(`profile_photo_url = $${nextIdx++}`);
    }

    if (updates.length === 0) {
      return bad(res, 'no editable fields supplied');
    }

    // Always bump edit_count to 1 and stamp profile_updated_at when a
    // student self-saves. This is what makes the one-time lock stick —
    // the next self-save hits the 403 guard above.
    updates.push(`edit_count = 1`);
    updates.push(`profile_locked = TRUE`);
    updates.push(`profile_updated_at = NOW()`);

    params.push(existing.id);
    const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = $${nextIdx}
                  RETURNING ${PROFILE_COLUMNS}`;

    let updated;
    try {
      const r = await query(sql, params);
      updated = r.rows[0];
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

    if (photoReplaced && existing.profile_photo_url) {
      tryDeletePhotoFile(existing.profile_photo_url);
    }

    res.json({ profile: publicProfile(updated) });
  } catch (err) {
    next(err);
  }
});

// GET /api/profile/:userId — teacher/admin view of any student profile.
// Students can fetch their own row through /api/profile/me, but they
// shouldn't be able to read arbitrary other users' records here.
router.get('/:userId', requireAuth, requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const row = await loadUser(req.params.userId);
    if (!row) return bad(res, 'User not found', 404);
    if (row.role !== 'student') return bad(res, 'User is not a student', 400);
    res.json({ profile: publicProfile(row) });
  } catch (err) {
    next(err);
  }
});

// PUT /api/profile/:userId — teacher/admin edits a student profile. Bypasses
// the one-time lock regardless of edit_count/profile_locked. Teachers may
// also set `unlock: true` in the body to reset edit_count=0 and clear
// profile_locked so the student can edit their own profile again.
router.put('/:userId', requireAuth, requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const existing = await loadUser(req.params.userId);
    if (!existing) return bad(res, 'User not found', 404);
    if (existing.role !== 'student') return bad(res, 'User is not a student', 400);

    const {
      fullName, rollNumber, email, phoneNumber, department, profilePhoto, unlock,
    } = req.body || {};

    const updates = [];
    const params = [];
    let nextIdx = 1;

    if (fullName != null) {
      const name = String(fullName).trim();
      if (name.length < 2) return bad(res, 'fullName must be at least 2 characters');
      params.push(name);
      updates.push(`full_name = $${nextIdx++}`);
    }

    if (rollNumber != null) {
      const roll = String(rollNumber).trim();
      if (!roll) return bad(res, 'rollNumber is required');
      params.push(roll);
      updates.push(`roll_number = $${nextIdx++}`);
    }

    if (email != null) {
      const mail = String(email).trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) {
        return bad(res, 'email is not valid');
      }
      params.push(mail);
      updates.push(`email = $${nextIdx++}`);
    }

    if (phoneNumber != null) {
      const phone = normalizePhone(phoneNumber);
      if (!isValidPhone(phone)) {
        return bad(res, 'phoneNumber must be 10-15 digits (optional leading +)');
      }
      params.push(phone);
      updates.push(`phone_number = $${nextIdx++}`);
    }

    if (department != null) {
      const dept = String(department).trim();
      params.push(dept || null);
      updates.push(`department = $${nextIdx++}`);
    }

    let newPhotoUrl = null;
    let photoReplaced = false;
    if (profilePhoto) {
      const result = persistProfilePhoto({ data: profilePhoto, ownerId: existing.id });
      if (result.error) return bad(res, result.error);
      newPhotoUrl = result.url;
      photoReplaced = true;
      params.push(newPhotoUrl);
      updates.push(`profile_photo_url = $${nextIdx++}`);
    }

    // The unlock flag is the teacher's "allow this student to edit again"
    // lever. We always reset edit_count to 0 and clear profile_locked in
    // the same UPDATE so the student immediately regains edit access on
    // their next GET /api/profile/me.
    if (unlock === true) {
      updates.push(`edit_count = 0`);
      updates.push(`profile_locked = FALSE`);
    }

    if (updates.length === 0) {
      return bad(res, 'no editable fields supplied');
    }

    updates.push(`profile_updated_at = NOW()`);

    params.push(existing.id);
    const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = $${nextIdx}
                  RETURNING ${PROFILE_COLUMNS}`;

    let updated;
    try {
      const r = await query(sql, params);
      updated = r.rows[0];
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

    if (photoReplaced && existing.profile_photo_url) {
      tryDeletePhotoFile(existing.profile_photo_url);
    }

    res.json({ profile: publicProfile(updated) });
  } catch (err) {
    next(err);
  }
});

// POST /api/profile/:userId/unlock — convenience endpoint that exposes only
// the unlock behaviour of PUT /:userId. Returns the same shape.
router.post('/:userId/unlock', requireAuth, requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const existing = await loadUser(req.params.userId);
    if (!existing) return bad(res, 'User not found', 404);
    if (existing.role !== 'student') return bad(res, 'User is not a student', 400);

    const r = await query(
      `UPDATE users
          SET edit_count = 0,
              profile_locked = FALSE,
              profile_updated_at = NOW()
        WHERE id = $1
        RETURNING ${PROFILE_COLUMNS}`,
      [existing.id],
    );
    res.json({ profile: publicProfile(r.rows[0]) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
