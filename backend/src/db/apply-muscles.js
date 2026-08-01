// Populates exercise_muscles (and exercises.is_bodyweight) from the mapping in muscles.js.
//
// Safe to re-run: it rewrites the rows for each exercise from the current mapping, so
// editing muscles.js and re-running is the intended way to correct a mapping. Nothing here
// touches logged sets.
//
//   npm run db:apply-muscles            # dry run — prints what would change
//   npm run db:apply-muscles -- --apply
const db = require('./index');
const { musclesFor, isBodyweight } = require('./muscles');

const apply = process.argv.includes('--apply');

(async () => {
  const client = await db.pool.connect();
  try {
    const { rows: exercises } = await client.query(
      'SELECT id, name, muscle_group, is_bodyweight FROM exercises ORDER BY name'
    );
    if (!exercises.length) {
      console.log('No exercises found — run db:seed first.');
      return;
    }

    const bySource = { exact: [], keyword: [], group: [], none: [] };
    const plan = [];
    for (const ex of exercises) {
      const { rows, source } = musclesFor(ex.name, ex.muscle_group);
      bySource[source].push(ex.name);
      plan.push({ ...ex, muscles: rows, source, bodyweight: isBodyweight(ex.name) });
    }

    console.log(`${exercises.length} exercises\n`);
    console.log(`  exact mapping   ${bySource.exact.length}`);
    console.log(`  keyword match   ${bySource.keyword.length}`);
    console.log(`  coarse fallback ${bySource.group.length}`);
    console.log(`  unmapped        ${bySource.none.length}`);

    // These are the ones worth eyeballing — a keyword or coarse match is a guess, and a
    // wrong guess quietly skews every weekly total that muscle appears in.
    for (const key of ['keyword', 'group', 'none']) {
      if (!bySource[key].length) continue;
      console.log(`\n  ${key}:`);
      for (const name of bySource[key]) {
        const p = plan.find((x) => x.name === name);
        console.log(`    ${name.padEnd(28)} → ${p.muscles.map((m) => `${m.muscle}${m.contribution < 1 ? '*' : ''}`).join(', ') || '(nothing)'}`);
      }
    }

    const bwChanges = plan.filter((p) => p.bodyweight !== p.is_bodyweight);
    if (bwChanges.length) {
      console.log(`\n  bodyweight flag changes: ${bwChanges.map((p) => `${p.name}→${p.bodyweight}`).join(', ')}`);
    }

    if (!apply) {
      console.log('\nDry run — nothing written. Re-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');
    let written = 0;
    for (const p of plan) {
      await client.query('DELETE FROM exercise_muscles WHERE exercise_id = $1', [p.id]);
      for (const m of p.muscles) {
        await client.query(
          'INSERT INTO exercise_muscles (exercise_id, muscle, contribution) VALUES ($1, $2, $3)',
          [p.id, m.muscle, m.contribution]
        );
        written++;
      }
      if (p.bodyweight !== p.is_bodyweight) {
        await client.query('UPDATE exercises SET is_bodyweight = $1 WHERE id = $2', [p.bodyweight, p.id]);
      }
    }
    await client.query('COMMIT');
    console.log(`\n✅ Wrote ${written} muscle rows across ${plan.length} exercises.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await db.pool.end();
  }
})();
