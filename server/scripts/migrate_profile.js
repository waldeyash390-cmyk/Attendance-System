// Adds profile support to the users table:
//   - phone_number     VARCHAR(20)  — required at registration time, stored as the
//                                     user typed it (trimmed of spaces/dashes). The
//                                     app validates the format at the edges.
//   - profile_photo_url TEXT       — nullable. Set after the user uploads a profile
//                                    photo through the /api/profile endpoints. The
//                                     file lives on disk under server/uploads/ and is
//                                    served back via /api/uploads/.
//   - edit_count        INTEGER    — incremented when the student saves their
//                                    profile. Used together with the per-student
//                                    "one-time edit" rule:
//                                      edit_count = 0 → editable
//                                      edit_count ≥ 1 → read-only (locked)
//                                    Teachers always bypass this lock when editing
//                                    on a student's behalf.
//   - profile_locked    BOOLEAN    — redundant flag set by a teacher when they
//                                    want to re-allow a student to edit their
//                                    profile. The app resets it on the unlock
//                                    endpoint and zeroes edit_count in the same
//                                    transaction.
//   - profile_updated_at TIMESTAMPTZ — set whenever the profile fields change so
//                                     the client can show "last edited" hints.
//
// Idempotent: safe to run multiple times.
require('dotenv').config({ path: __dirname + '/../.env' });
const { pool } = require('../src/db');

(async () => {
  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS phone_number       VARCHAR(20),
      ADD COLUMN IF NOT EXISTS profile_photo_url  TEXT,
      ADD COLUMN IF NOT EXISTS edit_count         INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS profile_locked     BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS profile_updated_at TIMESTAMPTZ
  `);

  // Per-student uniqueness on roll_number is already enforced by the UNIQUE
  // constraint declared in schema.sql, but we add an index for the email
  // lookup path the profile routes use if it doesn't exist yet.
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_users_phone
      ON users (phone_number)
  `);

  console.log('[migrate_profile] done');
})()
  .then(() => pool.end())
  .catch((err) => {
    console.error('[migrate_profile] failed', err);
    process.exit(1);
  });
