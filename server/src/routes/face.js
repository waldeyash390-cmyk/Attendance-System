const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../auth');

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

router.post('/enroll', requireAuth, async (req, res, next) => {
  try {
    const { descriptor, source, quality, replace } = req.body || {};

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

    const doReplace = replace === undefined ? true : Boolean(replace);

    let row;
    if (doReplace) {
      // Mark existing active descriptors for this user inactive, then insert fresh one.
      await query(
        `UPDATE face_descriptors SET is_active = FALSE WHERE user_id = $1 AND is_active = TRUE`,
        [req.user.id],
      );
    }

    const ins = await query(
      `INSERT INTO face_descriptors (user_id, descriptor, source, quality, is_active)
       VALUES ($1, $2::jsonb, $3, $4, TRUE)
       RETURNING id, user_id, source, quality, is_active, created_at`,
      [req.user.id, JSON.stringify(normalized), finalSource, finalQuality],
    );
    row = ins.rows[0];

    res.status(201).json({ descriptor: publicDescriptor(row), replaced: doReplace });
  } catch (err) {
    next(err);
  }
});

router.get('/status', requireAuth, async (req, res, next) => {
  try {
    const targetUserId = req.query.userId || req.user.id;
    if (targetUserId !== req.user.id && req.user.role !== 'admin') {
      return bad(res, 'Only admins can query another user\'s enrollment status', 403);
    }

    const result = await query(
      `SELECT id, user_id, source, quality, is_active, created_at
         FROM face_descriptors
        WHERE user_id = $1 AND is_active = TRUE
        ORDER BY created_at DESC
        LIMIT 1`,
      [targetUserId],
    );
    const active = result.rows[0] || null;

    const all = await query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE is_active)::int AS active
         FROM face_descriptors
        WHERE user_id = $1`,
      [targetUserId],
    );
    const counts = all.rows[0];

    res.json({
      userId: targetUserId,
      enrolled: Boolean(active),
      active: publicDescriptor(active),
      counts,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
