const express = require('express');
const { query, withTransaction } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { tryDeletePhotoFile } = require('../utils/facePhoto');

const router = express.Router();

function bad(res, msg, status = 400) {
  return res.status(status).json({ error: msg });
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

const REQUEST_COLUMNS = `
  id, student_id, teacher_id, status, pending_image_url,
  reason, review_note, requested_at, reviewed_at
`;

async function loadRequestForTeacher(client, requestId) {
  const r = await client.query(
    `SELECT ${REQUEST_COLUMNS}
       FROM face_update_requests
      WHERE id = $1
      FOR UPDATE`,
    [requestId],
  );
  return r.rows[0] || null;
}

async function loadStudent(client, studentId) {
  const r = await client.query(
    `SELECT id, full_name, roll_number, email, face_image_url, face_enrolled_at
       FROM users WHERE id = $1`,
    [studentId],
  );
  return r.rows[0] || null;
}

// GET /api/teacher/face-requests?status=pending
// Lists face update requests scoped to this teacher. Admins see all rows;
// teachers see only requests from students that belong to one of their
// subjects (i.e. a session they teach). If the teacher has never run a
// session they see no rows.
router.get('/', requireAuth, requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const status = req.query.status ? String(req.query.status) : 'pending';
    const VALID_STATUSES = new Set(['pending', 'approved', 'rejected']);
    if (!VALID_STATUSES.has(status)) {
      return bad(res, `status must be one of: ${Array.from(VALID_STATUSES).join(', ')}`);
    }

    const params = [status];
    let scopeClause = '';
    if (req.user.role === 'teacher') {
      params.push(req.user.id);
      scopeClause = `
        AND r.student_id IN (
          SELECT a.student_id
            FROM attendance a
            JOIN sessions s ON s.id = a.session_id
           WHERE s.teacher_id = $${params.length}
          UNION
          SELECT s.teacher_id
            FROM sessions s
           WHERE s.teacher_id = $${params.length}
        )`;
    }

    const r = await query(
      `SELECT r.id, r.student_id, r.teacher_id, r.status, r.pending_image_url,
              r.reason, r.review_note, r.requested_at, r.reviewed_at,
              u.id, u.full_name, u.roll_number, u.email, u.face_image_url, u.face_enrolled_at
         FROM face_update_requests r
         JOIN users u ON u.id = r.student_id
        WHERE r.status = $1
          ${scopeClause}
        ORDER BY r.requested_at DESC
        LIMIT 200`,
      params,
    );

    const requests = r.rows.map((row) => publicRequest(
      {
        id: row.id,
        student_id: row.student_id,
        teacher_id: row.teacher_id,
        status: row.status,
        pending_image_url: row.pending_image_url,
        reason: row.reason,
        review_note: row.review_note,
        requested_at: row.requested_at,
        reviewed_at: row.reviewed_at,
      },
      {
        id: row.id,
        full_name: row.full_name,
        roll_number: row.roll_number,
        email: row.email,
        face_image_url: row.face_image_url,
        face_enrolled_at: row.face_enrolled_at,
      },
    ));

    res.json({ requests });
  } catch (err) {
    next(err);
  }
});

// POST /api/teacher/face-requests/:id/approve
// Promotes the pending photo into the student's live face_image_url and
// closes the request. The old live photo is deleted from disk; the
// pending photo is kept because it IS the new live one.
router.post('/:id/approve', requireAuth, requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const { reviewNote } = req.body || {};

    let result;
    try {
      result = await withTransaction(async (client) => {
        const reqRow = await loadRequestForTeacher(client, req.params.id);
        if (!reqRow) {
          const err = new Error('Request not found');
          err.status = 404;
          throw err;
        }
        if (reqRow.status !== 'pending') {
          const err = new Error(`Request already ${reqRow.status}`);
          err.status = 409;
          throw err;
        }

        const student = await loadStudent(client, reqRow.student_id);
        if (!student) {
          const err = new Error('Student not found');
          err.status = 404;
          throw err;
        }

        // Apply: students.face_image_url = pending_image_url.
        // face_enrolled stays TRUE and face_enrolled_at is not touched —
        // the lock still binds to this student.
        const upd = await client.query(
          `UPDATE users
              SET face_image_url = $2,
                  profile_photo_url = COALESCE($2, profile_photo_url)
            WHERE id = $1
        RETURNING id, face_image_url`,
          [student.id, reqRow.pending_image_url],
        );

        const updReq = await client.query(
          `UPDATE face_update_requests
              SET status      = 'approved',
                  teacher_id  = $2,
                  review_note = $3,
                  reviewed_at = NOW()
            WHERE id = $1
          RETURNING ${REQUEST_COLUMNS}`,
          [reqRow.id, req.user.id, reviewNote ? String(reviewNote).trim() || null : null],
        );

        return {
          request: updReq.rows[0],
          student,
          oldFaceUrl: student.face_image_url,
          newFaceUrl: reqRow.pending_image_url,
        };
      });
    } catch (err) {
      throw err;
    }

    if (result.oldFaceUrl && result.oldFaceUrl !== result.newFaceUrl) {
      tryDeletePhotoFile(result.oldFaceUrl);
    }

    res.json({ request: publicRequest(result.request, result.student) });
  } catch (err) {
    if (err && err.status) return bad(res, err.message, err.status);
    next(err);
  }
});

// POST /api/teacher/face-requests/:id/reject
// Discards the pending photo (file deleted) and closes the request.
// The live face is left untouched.
router.post('/:id/reject', requireAuth, requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const { reviewNote } = req.body || {};

    let result;
    try {
      result = await withTransaction(async (client) => {
        const reqRow = await loadRequestForTeacher(client, req.params.id);
        if (!reqRow) {
          const err = new Error('Request not found');
          err.status = 404;
          throw err;
        }
        if (reqRow.status !== 'pending') {
          const err = new Error(`Request already ${reqRow.status}`);
          err.status = 409;
          throw err;
        }

        const student = await loadStudent(client, reqRow.student_id);

        const updReq = await client.query(
          `UPDATE face_update_requests
              SET status      = 'rejected',
                  teacher_id  = $2,
                  review_note = $3,
                  reviewed_at = NOW()
            WHERE id = $1
          RETURNING ${REQUEST_COLUMNS}`,
          [reqRow.id, req.user.id, reviewNote ? String(reviewNote).trim() || null : null],
        );

        return {
          request: updReq.rows[0],
          student,
          pendingUrl: reqRow.pending_image_url,
        };
      });
    } catch (err) {
      throw err;
    }

    // Discard the staged photo. Live face is untouched.
    if (result.pendingUrl) tryDeletePhotoFile(result.pendingUrl);

    res.json({ request: publicRequest(result.request, result.student) });
  } catch (err) {
    if (err && err.status) return bad(res, err.message, err.status);
    next(err);
  }
});

module.exports = router;
