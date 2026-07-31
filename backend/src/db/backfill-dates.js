// One-shot repair for workouts dated from the UTC server clock instead of local time.
// Deliberately NOT in migrations.js: it would re-run forever and clobber any date you
// later corrected by hand.
//
//   npm run db:backfill-dates            # dry run, prints what would change
//   npm run db:backfill-dates -- --apply # writes
const db = require('./index');
const { APP_TIMEZONE } = require('../util/dates');

const apply = process.argv.includes('--apply');

const SELECT_DRIFTED = `
  SELECT id, routine_name, date AS stored_date,
         (created_at AT TIME ZONE $1)::date AS correct_date,
         created_at
    FROM workouts
   WHERE date IS DISTINCT FROM (created_at AT TIME ZONE $1)::date
   ORDER BY created_at`;

(async () => {
  try {
    const { rows } = await db.query(SELECT_DRIFTED, [APP_TIMEZONE]);

    if (!rows.length) {
      console.log(`✅ No drifted dates. Every workout already matches its ${APP_TIMEZONE} calendar day.`);
      return;
    }

    console.log(`Timezone: ${APP_TIMEZONE}`);
    console.log(`${rows.length} workout(s) dated on the wrong day:\n`);
    // DATE columns come back as plain 'YYYY-MM-DD' strings (see the type parser in db/index.js).
    for (const r of rows) {
      console.log(`  #${String(r.id).padEnd(4)} ${(r.routine_name || 'Workout').slice(0, 28).padEnd(30)} ${r.stored_date} → ${r.correct_date}`);
    }

    if (!apply) {
      console.log('\nDry run — nothing written. Re-run with --apply to commit.');
      return;
    }

    const { rowCount } = await db.query(
      `UPDATE workouts SET date = (created_at AT TIME ZONE $1)::date
        WHERE date IS DISTINCT FROM (created_at AT TIME ZONE $1)::date`,
      [APP_TIMEZONE]
    );
    console.log(`\n✅ Corrected ${rowCount} workout date(s).`);
  } catch (err) {
    console.error('❌ Backfill failed:', err.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
})();
