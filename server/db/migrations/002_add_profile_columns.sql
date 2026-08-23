-- Migration: add profile columns to users
-- Adds phone_number, profile_photo_url, edit_count, profile_locked, and
-- profile_updated_at. See server/scripts/migrate_profile.js for the JS
-- equivalent; this file is kept for documentation and to be re-runnable
-- against a fresh database that only sees the SQL migrations folder.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone_number       VARCHAR(20),
  ADD COLUMN IF NOT EXISTS profile_photo_url  TEXT,
  ADD COLUMN IF NOT EXISTS edit_count         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profile_locked     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS profile_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_phone
  ON users (phone_number);

COMMIT;
