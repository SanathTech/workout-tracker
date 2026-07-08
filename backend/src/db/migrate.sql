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
  ALTER TABLE routine_exercises DROP COLUMN IF EXISTS target_rir;
  DO $$
DECLARE d RECORD;
BEGIN
  FOR d IN SELECT id, MIN(id) OVER (PARTITION BY name) AS keep_id FROM exercises LOOP
    IF d.id <> d.keep_id THEN
      UPDATE routine_exercises SET exercise_id = d.keep_id WHERE exercise_id = d.id;
      UPDATE routine_exercise_subs SET exercise_id = d.keep_id WHERE exercise_id = d.id;
      UPDATE workout_exercises SET exercise_id = d.keep_id WHERE exercise_id = d.id;
      DELETE FROM exercises WHERE id = d.id;
    END IF;
  END LOOP;
END $$;
  CREATE UNIQUE INDEX IF NOT EXISTS exercises_name_key ON exercises (name);
COMMIT;
