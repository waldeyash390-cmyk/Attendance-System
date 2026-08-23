-- attendance-system schema
-- PostgreSQL 12+

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Enums ---------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('student', 'teacher', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'late', 'excused');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- users ---------------------------------------------------------------------
-- Central account table for students, teachers, and admins.
CREATE TABLE IF NOT EXISTS users (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(150) NOT NULL,
  role          user_role    NOT NULL DEFAULT 'student',
  roll_number   VARCHAR(50)  UNIQUE,
  department    VARCHAR(100),
  phone_number  VARCHAR(20),
  profile_photo_url  TEXT,
  edit_count         INTEGER     NOT NULL DEFAULT 0,
  profile_locked     BOOLEAN     NOT NULL DEFAULT FALSE,
  profile_updated_at TIMESTAMPTZ,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT users_student_roll_required
    CHECK ((role <> 'student') OR (roll_number IS NOT NULL)),
  CONSTRAINT users_email_format CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

CREATE INDEX IF NOT EXISTS idx_users_role          ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_department    ON users (department);
CREATE INDEX IF NOT EXISTS idx_users_active        ON users (is_active);

-- subjects -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subjects (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  code        VARCHAR(20)  NOT NULL UNIQUE,
  name        VARCHAR(150) NOT NULL,
  department  VARCHAR(100),
  semester    SMALLINT     CHECK (semester IS NULL OR (semester BETWEEN 1 AND 12)),
  created_by  UUID         REFERENCES users (id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subjects_department ON subjects (department);
CREATE INDEX IF NOT EXISTS idx_subjects_semester   ON subjects (semester);

-- sessions -------------------------------------------------------------------
-- A class meeting of a subject, conducted by a teacher.
CREATE TABLE IF NOT EXISTS sessions (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id      UUID         NOT NULL REFERENCES subjects (id) ON DELETE CASCADE,
  teacher_id      UUID         NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  title           VARCHAR(200),
  start_at        TIMESTAMPTZ  NOT NULL,
  end_at          TIMESTAMPTZ  NOT NULL,
  location        VARCHAR(150),
  is_open         BOOLEAN      NOT NULL DEFAULT TRUE,
  opens_at        TIMESTAMPTZ,
  closes_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT sessions_time_order CHECK (end_at > start_at),
  CONSTRAINT sessions_window_order CHECK (
    opens_at IS NULL OR closes_at IS NULL OR closes_at > opens_at
  )
);

CREATE INDEX IF NOT EXISTS idx_sessions_subject_start ON sessions (subject_id, start_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_teacher_start ON sessions (teacher_id, start_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_open         ON sessions (is_open, start_at);

-- attendance -----------------------------------------------------------------
-- One row per (student, session). Updated when student is recognized.
CREATE TABLE IF NOT EXISTS attendance (
  id           UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID             NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  student_id   UUID             NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status       attendance_status NOT NULL DEFAULT 'present',
  marked_at    TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  confidence   NUMERIC(5,4)     CHECK (confidence IS NULL OR (confidence BETWEEN 0 AND 1)),
  method       VARCHAR(20)      NOT NULL DEFAULT 'face'
                              CHECK (method IN ('face', 'manual', 'proxy')),
  note         TEXT,
  created_at   TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ      NOT NULL DEFAULT NOW(),

  CONSTRAINT attendance_unique_per_session UNIQUE (session_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_session     ON attendance (session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_student     ON attendance (student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_status      ON attendance (status);
CREATE INDEX IF NOT EXISTS idx_attendance_student_dt  ON attendance (student_id, marked_at DESC);

-- face_descriptors -----------------------------------------------------------
-- Stored face-api.js 128-d descriptor (Float32 vector) per user.
-- Stored as JSONB for portability; pgvector can be added later if needed.
CREATE TABLE IF NOT EXISTS face_descriptors (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  descriptor   JSONB        NOT NULL,
  source       VARCHAR(50)  NOT NULL DEFAULT 'enrollment'
                          CHECK (source IN ('enrollment', 're_enrollment', 'manual')),
  quality      NUMERIC(5,4) CHECK (quality IS NULL OR (quality BETWEEN 0 AND 1)),
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT face_descriptors_array_length
    CHECK (jsonb_typeof(descriptor) = 'array'
           AND jsonb_array_length(descriptor) = 128)
);

CREATE INDEX IF NOT EXISTS idx_face_descriptors_user_active
  ON face_descriptors (user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_face_descriptors_source
  ON face_descriptors (source);

-- updated_at trigger ---------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at       ON users;
DROP TRIGGER IF EXISTS trg_subjects_updated_at    ON subjects;
DROP TRIGGER IF EXISTS trg_sessions_updated_at    ON sessions;
DROP TRIGGER IF EXISTS trg_attendance_updated_at  ON attendance;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_subjects_updated_at
  BEFORE UPDATE ON subjects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_sessions_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_attendance_updated_at
  BEFORE UPDATE ON attendance
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
