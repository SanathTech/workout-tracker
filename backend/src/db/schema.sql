-- Workout Tracker Schema (Programs / Routines / Workouts)
-- WARNING: This DROPS the old plans/workouts data. Run via `npm run db:init`.

DROP TABLE IF EXISTS workout_sets CASCADE;
DROP TABLE IF EXISTS workout_exercises CASCADE;
DROP TABLE IF EXISTS workouts CASCADE;
DROP TABLE IF EXISTS routine_exercise_subs CASCADE;
DROP TABLE IF EXISTS routine_exercises CASCADE;
DROP TABLE IF EXISTS routines CASCADE;
DROP TABLE IF EXISTS programs CASCADE;
DROP TABLE IF EXISTS plan_exercises CASCADE;
DROP TABLE IF EXISTS workout_plans CASCADE;

CREATE TABLE IF NOT EXISTS exercises (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  muscle_group VARCHAR(100) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE programs (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  total_weeks INTEGER,             -- NULL = open-ended / ongoing (no auto-complete)
  status VARCHAR(20) NOT NULL DEFAULT 'draft',  -- draft | active | completed | archived
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Only one program can be 'active' at a time.
CREATE UNIQUE INDEX programs_one_active ON programs(status) WHERE status = 'active';

CREATE TABLE routines (
  id SERIAL PRIMARY KEY,
  program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- Editing a program retires its routines rather than deleting them. workouts.routine_id
  -- is ON DELETE SET NULL, so a hard delete would strip the prescribed sets/reps/RIR off
  -- every workout ever logged against them. Retired rows keep that history resolvable.
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_routines_program ON routines(program_id) WHERE deleted_at IS NULL;

CREATE TABLE routine_exercises (
  id SERIAL PRIMARY KEY,
  routine_id INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  target_sets INTEGER NOT NULL DEFAULT 3,
  rep_range_low INTEGER,
  rep_range_high INTEGER,
  target_rir_per_set INTEGER[] NOT NULL DEFAULT '{}',
  rest_seconds INTEGER,
  rest_seconds_high INTEGER,
  notes TEXT,
  warmup_sets_low INTEGER,
  warmup_sets_high INTEGER,
  is_main BOOLEAN NOT NULL DEFAULT false   -- highlights the routine's key lift(s)
);

CREATE INDEX idx_routine_exercises_routine ON routine_exercises(routine_id);

CREATE TABLE routine_exercise_subs (
  id SERIAL PRIMARY KEY,
  routine_exercise_id INTEGER NOT NULL REFERENCES routine_exercises(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_routine_exercise_subs_re ON routine_exercise_subs(routine_exercise_id);

CREATE TABLE workouts (
  id SERIAL PRIMARY KEY,
  program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL,
  routine_id INTEGER REFERENCES routines(id) ON DELETE SET NULL,
  routine_name VARCHAR(255),       -- snapshot at workout-start time
  program_week INTEGER,            -- 1-indexed week within the program
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  duration_minutes INTEGER,
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'in_progress',  -- in_progress | completed | skipped
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_workouts_program ON workouts(program_id);
CREATE INDEX idx_workouts_routine ON workouts(routine_id);
CREATE INDEX idx_workouts_date ON workouts(date);
CREATE INDEX idx_workouts_status ON workouts(status);

CREATE TABLE workout_exercises (
  id SERIAL PRIMARY KEY,
  workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  -- The prescription slot this row was created from. Survives a swap: the exercise
  -- changes, the slot doesn't, so the rep range / RIR / how-to stay attached and
  -- "make this the default" knows which routine row to rewrite. NULL for ad-hoc rows.
  routine_exercise_id INTEGER REFERENCES routine_exercises(id) ON DELETE SET NULL
);

CREATE INDEX idx_workout_exercises_workout ON workout_exercises(workout_id);
CREATE INDEX idx_workout_exercises_exercise ON workout_exercises(exercise_id);

CREATE TABLE workout_sets (
  id SERIAL PRIMARY KEY,
  workout_exercise_id INTEGER NOT NULL REFERENCES workout_exercises(id) ON DELETE CASCADE,
  set_number INTEGER NOT NULL,
  reps INTEGER,
  weight_kg NUMERIC(6, 2),
  rir INTEGER,                     -- actual reps-in-reserve logged for this set (nullable)
  -- 'working' | 'warmup' | 'drop' | 'failure'. Only working sets count as hard sets for
  -- volume, and only working sets are eligible for 1RM estimates and personal bests —
  -- a warm-up single would otherwise read as a PR.
  set_type VARCHAR(16) NOT NULL DEFAULT 'working',
  -- When the set was first logged (client clock, first time reps land on the row).
  -- Rest between consecutive sets is DERIVED from these — recorded passively, because
  -- the visible rest timer was removed on purpose (2026-08-10, he rests by his Garmin)
  -- and this must never become one. created_at can't serve: the autosave rewrites every
  -- set on every save, so created_at is just the last save time.
  logged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_workout_sets_we ON workout_sets(workout_exercise_id);

-- Which muscles an exercise trains, and how much of a set each one gets credited.
-- 1.0 = primary, 0.5 = assisting. Kept out of `exercises` because it's many-per-exercise;
-- exercises.muscle_group stays as the coarse label the library UI groups by.
CREATE TABLE IF NOT EXISTS exercise_muscles (
  exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  muscle VARCHAR(32) NOT NULL,
  contribution NUMERIC(3, 2) NOT NULL DEFAULT 1.0,
  PRIMARY KEY (exercise_id, muscle)
);

CREATE INDEX IF NOT EXISTS idx_exercise_muscles_exercise ON exercise_muscles(exercise_id);

-- Bodyweight over time. `date` is a calendar day for the same reason workouts.date is:
-- it's the day you weighed in, not an instant.
CREATE TABLE IF NOT EXISTS bodyweight_logs (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  weight_kg NUMERIC(5, 2) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bodyweight_date ON bodyweight_logs(date DESC);

ALTER TABLE exercises ADD COLUMN IF NOT EXISTS is_bodyweight BOOLEAN NOT NULL DEFAULT FALSE;
