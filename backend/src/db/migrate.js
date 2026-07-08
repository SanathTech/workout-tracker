const db = require('./index');
const { migrate } = require('./migrations');

// Standalone, non-destructive schema migration for an existing database.
// Run after deploying code that expects newer columns (e.g. workout_sets.rir,
// nullable programs.total_weeks) but before/without wiping via db:init.
//
//   node src/db/migrate.js   (or: npm run db:migrate)

async function run() {
  const client = await db.pool.connect();
  try {
    await migrate(client);
    console.log('✅ Schema migrations applied.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await db.pool.end();
  }
}

run();
