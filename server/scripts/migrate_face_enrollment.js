require('dotenv').config({ path: __dirname + '/../.env' });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  await pool.query(`
    DO $$ BEGIN
      CREATE TYPE face_update_request_status AS ENUM ('pending', 'approved', 'rejected');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);

  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS face_enrolled     BOOLEAN     NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS face_enrolled_at  TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS face_image_url    TEXT
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_users_face_enrolled
      ON users (face_enrolled)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS face_update_requests (
      id                UUID                          PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id        UUID                          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      teacher_id        UUID                          REFERENCES users (id) ON DELETE SET NULL,
      status            face_update_request_status    NOT NULL DEFAULT 'pending',
      pending_image_url TEXT                          NOT NULL,
      reason            TEXT,
      review_note       TEXT,
      requested_at      TIMESTAMPTZ                   NOT NULL DEFAULT NOW(),
      reviewed_at       TIMESTAMPTZ,
      CONSTRAINT face_update_requests_reviewed_when_closed
        CHECK (
          (status = 'pending'  AND reviewed_at IS NULL AND teacher_id IS NULL)
          OR
          (status IN ('approved', 'rejected') AND reviewed_at IS NOT NULL AND teacher_id IS NOT NULL)
        )
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_face_update_requests_one_pending
      ON face_update_requests (student_id)
      WHERE status = 'pending'
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_face_update_requests_status
      ON face_update_requests (status, requested_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_face_update_requests_student
      ON face_update_requests (student_id, requested_at DESC)
  `);

  console.log('[migrate_face_enrollment] done');
})()
  .then(() => pool.end())
  .catch((err) => {
    console.error('[migrate_face_enrollment] failed', err);
    process.exit(1);
  });
