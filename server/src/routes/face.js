const express = require('express');
const { query, withTransaction } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { persistFacePhoto, tryDeletePhotoFile } = require('../utils/facePhoto');

const router = express.Router();

const DESCRIPTOR_LENGTH = 128;

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

function publicDescriptor(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    source: row.source,
    quality: row.quality === null ? null : Number(row.quality),
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

function publicUserFace(row) {
  if (!row) return null;
  return {
    faceEnrolled: Boolean(row.face_enrolled),
    faceEnrolledAt: row.face_enrolled_at,
    faceImageUrl: row.face_image_url,
  };
}

function publicRequest(row, student) {
  if (!row) return null;
  return {
    id: row.id,
    studentId: row.student_id,
    teacherId: row.teacher_id,
    status: row.status,
    pendingImageUrl: row.pending_image_url,
    reason: row.reason,
    reviewNote: row.review_note,
    requestedAt: row.requested_at,
    reviewedAt: row.reviewed_at,
    student: student ? {
      id: student.id,
      fullName: student.full_name,
      rollNumber: student.roll_number,
      email: student.email,
      currentFaceImageUrl: student.face_image_url,
      faceEnrolledAt: student.face_enrolled_at,
    } : null,
  };
}

// Shared helper: figure out the student's enrollment state plus their
// most recent open update request (if any). One round-trip each.
async function loadStudentState(studentId) {
  const userRes = await query(
    `SELECT id, full_name, roll_number, email, face_enrolled, face_enrolled_at, face_image_url
       FROM users WHERE id = $1 LIMIT 1`,
    [studentId],
  );
  const user = userRes.rows[0] || null;

  const reqRes = await query(
    `SELECT id, student_id, teacher_id, status, pending_image_url, reason, review_note,
            requested_at, reviewed_at
       FROM face_update_requests
      WHERE student_id = $1 AND status = 'pending'
      ORDER BY requested_at DESC
      LIMIT 1`,
    [studentId],
  );

  return {
    user,
    activeDescriptor: null,
    pendingRequest: reqRes.rows[0] || null,
  };
}

// POST /api/face/enroll
// First-time only. After a successful enrollment the user's face_enrolled
// flag flips to TRUE and a subsequent POST /enroll returns 403.
router.post('/enroll', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'student') {
      return bad(res, 'Only students can enroll their face', 403);
    }

    const { descriptor, source, quality, photo } = req.body || {};

    const normalized = normalizeDescriptor(descriptor);
    if (!normalized) {
      return bad(res, `descriptor must be an array of ${DESCRIPTOR_LENGTH} finite numbers`);
    }

    const finalSource = source || 'enrollment';
    const VALID_SOURCES = new Set(['enrollment', 're_enrollment', 'manual']);
    if (!VALID_SOURCES.has(finalSource)) {
      return bad(res, `source must be one of: ${Array.from(VALID_SOURCES).join(', ')}`);
    }

    let finalQuality = null;
    if (quality !== undefined && quality !== null) {
      const n = Number(quality);
      if (!Number.isFinite(n) || n < 0 || n > 1) {
        return bad(res, 'quality must be a number between 0 and 1');
      }
      finalQuality = n;
    }

    // Optional photo (data URL) to store alongside the descriptor so the
    // teacher has something visual to compare against later.
    let photoUrl = null;
    if (photo) {
      const persisted = persistFacePhoto({ data: photo, prefix: `face_${req.user.id}` });
      if (persisted.error) return bad(res, persisted.error);
      photoUrl = persisted.url;
    }

    let result;
    try {
      result = await withTransaction(async (client) => {
        const lockRes = await client.query(
          `SELECT face_enrolled FROM users WHERE id = $1 FOR UPDATE`,
          [req.user.id],
        );
        if (!lockRes.rows[0]) throw new Error('User not found');
        if (lockRes.rows[0].face_enrolled) {
          const err = new Error('Face already enrolled. Submit a face update request to change it.');
          err.status = 403;
          throw err;
        }

        await client.query(
          `UPDATE face_descriptors SET is_active = FALSE
             WHERE user_id = $1 AND is_active = TRUE`,
          [req.user.id],
        );

        const ins = await client.query(
          `INSERT INTO face_descriptors (user_id, descriptor, source, quality, is_active)
             VALUES ($1, $2::jsonb, $3, $4, TRUE)
           RETURNING id, user_id, source, quality, is_active, created_at`,
          [req.user.id, JSON.stringify(normalized), finalSource, finalQuality],
        );

        const upd = await client.query(
          `UPDATE users
              SET face_enrolled    = TRUE,
                  face_enrolled_at = NOW(),
                  face_image_url   = COALESCE($2, face_image_url)
            WHERE id = $1
          RETURNING face_enrolled, face_enrolled_at, face_image_url`,
          [req.user.id, photoUrl],
        );

        return { descriptor: ins.rows[0], user: upd.rows[0] };
      });
    } catch (err) {
      // Rollback also drops any photo we wrote, since the row didn't commit.
      if (photoUrl) tryDeletePhotoFile(photoUrl);
      throw err;
    }

    res.status(201).json({
      descriptor: publicDescriptor(result.descriptor),
      face: publicUserFace(result.user),
    });
  } catch (err) {
    if (err && err.status) return bad(res, err.message, err.status);
    next(err);
  }
});

// GET /api/face/status — own status by default; admins can pass ?userId=.
// Surfaces the lock flag + the student's current pending request so the
// SPA can render the right UI without a second round-trip.
router.get('/status', requireAuth, async (req, res, next) => {
  try {
    const targetUserId = req.query.userId || req.user.id;
    if (targetUserId !== req.user.id && req.user.role !== 'admin') {
      return bad(res, 'Only admins can query another user\'s enrollment status', 403);
    }

    const state = await loadStudentState(targetUserId);
    if (!state.user) return bad(res, 'User not found', 404);

    const activeRes = await query(
      `SELECT id, user_id, source, quality, is_active, created_at
         FROM face_descriptors
        WHERE user_id = $1 AND is_active = TRUE
        ORDER BY created_at DESC
        LIMIT 1`,
      [targetUserId],
    );

    const countsRes = await query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE is_active)::int AS active
         FROM face_descriptors
        WHERE user_id = $1`,
      [targetUserId],
    );

    res.json({
      userId: targetUserId,
      enrolled: Boolean(state.user.face_enrolled),
      face: publicUserFace(state.user),
      active: publicDescriptor(activeRes.rows[0] || null),
      counts: countsRes.rows[0],
      pendingRequest: publicRequest(state.pendingRequest, null),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/face/update-request
// Student submits a new photo. Stored as a PENDING row — does NOT overwrite
// the live face. Rejected if the student isn't enrolled or already has a
// pending request open.
router.post('/update-request', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'student') {
      return bad(res, 'Only students can submit a face update request', 403);
    }

    const { photo, reason } = req.body || {};

    if (!photo) return bad(res, 'photo is required');

    const persisted = persistFacePhoto({ data: photo, prefix: `facereq_${req.user.id}` });
    if (persisted.error) return bad(res, persisted.error);

    let row;
    try {
      row = await withTransaction(async (client) => {
        const lockRes = await client.query(
          `SELECT face_enrolled FROM users WHERE id = $1 FOR UPDATE`,
          [req.user.id],
        );
        if (!lockRes.rows[0]) throw new Error('User not found');
        if (!lockRes.rows[0].face_enrolled) {
          const err = new Error('You must enroll your face before requesting a change.');
          err.status = 400;
          throw err;
        }

        const existing = await client.query(
          `SELECT id FROM face_update_requests
             WHERE student_id = $1 AND status = 'pending'
             FOR UPDATE`,
          [req.user.id],
        );
        if (existing.rows[0]) {
          const err = new Error('You already have a pending face update request.');
          err.status = 409;
          throw err;
        }

        const ins = await client.query(
          `INSERT INTO face_update_requests
             (student_id, status, pending_image_url, reason, requested_at)
             VALUES ($1, 'pending', $2, $3, NOW())
           RETURNING id, student_id, teacher_id, status, pending_image_url,
                     reason, review_note, requested_at, reviewed_at`,
          [req.user.id, persisted.url, reason ? String(reason).trim() || null : null],
        );
        return ins.rows[0];
      });
    } catch (err) {
      // Rollback drops the row; clean up the orphaned photo too.
      tryDeletePhotoFile(persisted.url);
      throw err;
    }

    res.status(201).json({ request: publicRequest(row, null) });
  } catch (err) {
    if (err && err.status) return bad(res, err.message, err.status);
    next(err);
  }
});

// GET /api/face/update-request/me — student polls their own request status.
// Returns the most recent request of any status (pending/approved/rejected)
// so the UI can render the latest outcome.
router.get('/update-request/me', requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, student_id, teacher_id, status, pending_image_url, reason, review_note,
              requested_at, reviewed_at
         FROM face_update_requests
        WHERE student_id = $1
        ORDER BY requested_at DESC
        LIMIT 1`,
      [req.user.id],
    );
    const row = result.rows[0] || null;
    res.json({ request: publicRequest(row, null) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
