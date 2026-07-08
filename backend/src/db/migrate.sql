-- Standalone, non-destructive schema migration (idempotent).
-- Brings an existing database up to the current schema.sql without wiping data.
-- Paste into the Neon SQL Editor and Run, or apply with any Postgres client.

BEGIN;
  ALTER TABLE programs ALTER COLUMN total_weeks DROP NOT NULL;
  ALTER TABLE programs ALTER COLUMN total_weeks DROP DEFAULT;
  ALTER TABLE workout_sets ADD COLUMN IF NOT EXISTS rir INTEGER;
  ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS target_sets INTEGER NOT NULL DEFAULT 3;
  ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS rep_range_low INTEGER;
  ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS rep_range_high INTEGER;
  ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS target_rir_per_set INTEGER[] NOT NULL DEFAULT '{}';
  ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS rest_seconds INTEGER;
  ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS notes TEXT;
COMMIT;
