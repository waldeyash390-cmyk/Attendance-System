// Adds geofencing support:
//   - sessions.campus_lat / campus_lng / radius_meters (per-session, nullable)
//   - attendance_attempts log table (every accepted/rejected_location attempt)
// Idempotent: safe to run multiple times.
require('dotenv').config({ path: __dirname + '/../.env' });
const { pool } = require('../src/db');

(async () => {
  await pool.query(`
    ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS campus_lat   DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS campus_lng   DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS radius_meters INTEGER
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS attendance_attempts (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id      uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      student_id      uuid NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
      status          varchar(30) NOT NULL,
      lat             DOUBLE PRECISION,
      lng             DOUBLE PRECISION,
      distance_meters DOUBLE PRECISION,
      accuracy_meters DOUBLE PRECISION,
      created_at      timestamptz NOT NULL DEFAULT NOW(),
      CONSTRAINT attendance_attempts_status_check
        CHECK (status IN ('accepted', 'rejected_location'))
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_attendance_attempts_session
      ON attendance_attempts (session_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_attendance_attempts_student
      ON attendance_attempts (student_id)
  `);

  console.log('[migrate_geofence] done');
})()
  .then(() => pool.end())
  .catch((err) => {
    console.error('[migrate_geofence] failed', err);
    process.exit(1);
  });
