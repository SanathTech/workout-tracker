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
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_routines_program ON routines(program_id);

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
  notes TEXT
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
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_workout_sets_we ON workout_sets(workout_exercise_id);
