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
  'ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS notes TEXT',
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
