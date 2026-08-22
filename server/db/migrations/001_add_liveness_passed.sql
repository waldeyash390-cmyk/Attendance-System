-- Migration: add liveness_passed column to attendance
-- Records whether the student passed a client-side liveness check (blink or
-- head-turn) at the moment attendance was marked.

BEGIN;

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS liveness_passed BOOLEAN;

COMMIT;
