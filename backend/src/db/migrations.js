// Idempotent schema migrations that bring an existing database up to the current
// schema.sql without wiping data. Safe to run repeatedly (every statement is a
// no-op when already applied). Applied standalone by `npm run db:migrate` and
// reused by the program seed. Keep in sync with schema.sql.
const MIGRATIONS = [
  'ALTER TABLE programs ALTER COLUMN total_weeks DROP NOT NULL',
  'ALTER TABLE programs ALTER COLUMN total_weeks DROP DEFAULT',
  'ALTER TABLE workout_sets ADD COLUMN IF NOT EXISTS rir INTEGER',
  'ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS target_sets INTEGER NOT NULL DEFAULT 3',
  'ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS rep_range_low INTEGER',
  'ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS rep_range_high INTEGER',
  "ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS target_rir_per_set INTEGER[] NOT NULL DEFAULT '{}'",
  'ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS rest_seconds INTEGER',
  'ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS rest_seconds_high INTEGER',
  'ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS notes TEXT',
  'ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS warmup_sets_low INTEGER',
  'ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS warmup_sets_high INTEGER',
  'ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS is_main BOOLEAN NOT NULL DEFAULT false',
  // Drop the legacy single-RIR column superseded by target_rir_per_set.
  'ALTER TABLE routine_exercises DROP COLUMN IF EXISTS target_rir',
  // Collapse duplicate exercise names left by earlier non-idempotent seeds:
  // repoint every reference to the lowest id, delete the extras, then enforce uniqueness.
  `DO $$
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
END $$`,
  'CREATE UNIQUE INDEX IF NOT EXISTS exercises_name_key ON exercises (name)',
  // Retire routines instead of deleting them, so editing a program stops nulling
  // workouts.routine_id and wiping the prescriptions off past workouts.
  'ALTER TABLE routines ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ',
  // Which prescription slot a logged exercise came from (2026-09-05). Backfilled by
  // direct match first, then via the slot's substitutes — a swapped-in substitute
  // gets its slot back — so past workouts keep their targets after the read path
  // switched to preferring the slot id.
  'ALTER TABLE workout_exercises ADD COLUMN IF NOT EXISTS routine_exercise_id INTEGER REFERENCES routine_exercises(id) ON DELETE SET NULL',
  `UPDATE workout_exercises we
      SET routine_exercise_id = re.id
     FROM workouts w, routine_exercises re
    WHERE we.workout_id = w.id AND re.routine_id = w.routine_id
      AND re.exercise_id = we.exercise_id AND we.routine_exercise_id IS NULL`,
  `UPDATE workout_exercises we
      SET routine_exercise_id = s.routine_exercise_id
     FROM workouts w, routine_exercises re, routine_exercise_subs s
    WHERE we.workout_id = w.id AND re.routine_id = w.routine_id
      AND s.routine_exercise_id = re.id AND s.exercise_id = we.exercise_id
      AND we.routine_exercise_id IS NULL`,
  'DROP INDEX IF EXISTS idx_routines_program',
  'CREATE INDEX IF NOT EXISTS idx_routines_program ON routines(program_id) WHERE deleted_at IS NULL',
  // Phase 3: per-muscle volume + bodyweight
  `CREATE TABLE IF NOT EXISTS exercise_muscles (
     exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
     muscle VARCHAR(32) NOT NULL,
     contribution NUMERIC(3, 2) NOT NULL DEFAULT 1.0,
     PRIMARY KEY (exercise_id, muscle)
   )`,
  'CREATE INDEX IF NOT EXISTS idx_exercise_muscles_exercise ON exercise_muscles(exercise_id)',
  `CREATE TABLE IF NOT EXISTS bodyweight_logs (
     id SERIAL PRIMARY KEY,
     date DATE NOT NULL UNIQUE,
     weight_kg NUMERIC(5, 2) NOT NULL,
     notes TEXT,
     created_at TIMESTAMPTZ DEFAULT NOW()
   )`,
  'CREATE INDEX IF NOT EXISTS idx_bodyweight_date ON bodyweight_logs(date DESC)',
  'ALTER TABLE exercises ADD COLUMN IF NOT EXISTS is_bodyweight BOOLEAN NOT NULL DEFAULT FALSE',

  // Phase 4: set types. Existing rows are working sets by definition — nothing else
  // could be logged before this column existed.
  "ALTER TABLE workout_sets ADD COLUMN IF NOT EXISTS set_type VARCHAR(16) NOT NULL DEFAULT 'working'",

  // Rest tracking: when a set was first logged, stamped client-side the first time reps
  // land on the row. Rests are derived from the gaps. Nullable — history has no stamps.
  'ALTER TABLE workout_sets ADD COLUMN IF NOT EXISTS logged_at TIMESTAMPTZ',
];

// Applies all migrations atomically on the given client (BEGIN/COMMIT, ROLLBACK on error).
async function migrate(client) {
  await client.query('BEGIN');
  try {
    for (const stmt of MIGRATIONS) await client.query(stmt);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

module.exports = { MIGRATIONS, migrate };
