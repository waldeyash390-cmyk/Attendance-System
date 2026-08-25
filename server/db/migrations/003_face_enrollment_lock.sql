-- Migration: lock face enrollment + teacher-approved update requests
-- Adds a one-time enrollment flag on users (face_enrolled + face_enrolled_at
-- + face_image_url) and a face_update_requests table that stores a student's
-- pending new photo until a teacher approves or rejects it.

BEGIN;

DO $$ BEGIN
  CREATE TYPE face_update_request_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS face_enrolled     BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS face_enrolled_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS face_image_url    TEXT;

CREATE INDEX IF NOT EXISTS idx_users_face_enrolled
  ON users (face_enrolled);

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
);

-- One open request per student at any time. A student may have many
-- historical (approved/rejected) rows, but only a single pending row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_face_update_requests_one_pending
  ON face_update_requests (student_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_face_update_requests_status
  ON face_update_requests (status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_face_update_requests_student
  ON face_update_requests (student_id, requested_at DESC);

COMMIT;
