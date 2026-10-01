// Weekday-bound programs (2026-10-01): each routine owns a weekday, the next session is
// the next gym day's routine, a passed day with nothing logged becomes a skipped row,
// and a session done early covers its day. The rotation this replaces drifted every
// time a session moved — Day C on a Monday pushed Day B onto an office Thursday.
import pg from 'pg';

const BASE = process.env.TEST_API_URL || 'http://localhost:3997';
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, label, detail = '') => {
  if (c) { console.log(`  PASS  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ''}`); fail++; }
};
async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, body: json };
}

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: process.env.APP_TIMEZONE || 'Australia/Melbourne',
  year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const shift = (iso, delta) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
};
const wd = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

const { body: exercises } = await api('GET', '/api/exercises');
const ex = Object.fromEntries(exercises.map((e) => [e.name, e.id]));
const routine = (name, exId, weekday) => ({
  name,
  weekday,
  exercises: [{ exercise_id: exId, target_sets: 3, rep_range_low: 5, rep_range_high: 8 }],
});

console.log('\n─── weekday-bound schedule ───');

// Two slots: one two days ago (missed) and one tomorrow.
const { body: prog } = await api('POST', '/api/programs', {
  name: 'Weekday Block',
  routines: [
    routine('Missed Day', ex['Squat'], wd(shift(today, -2))),
    routine('Tomorrow Day', ex['Bench Press'], wd(shift(today, 1))),
  ],
});
await api('POST', `/api/programs/${prog.id}/start`);
await db.query(`UPDATE programs SET started_at = $2::date - 3 WHERE id = $1`, [prog.id, today]);

const { body: tree } = await api('GET', `/api/programs/${prog.id}`);
ok(tree.routines.map((r) => r.weekday).join() === [wd(shift(today, -2)), wd(shift(today, 1))].join(),
  'weekday survives the create round-trip');

let { body: active } = await api('GET', '/api/programs/active');
const skips = async () => (await db.query(
  `SELECT routine_name, date::text AS date FROM workouts WHERE program_id = $1 AND status = 'skipped' ORDER BY date`,
  [prog.id]
)).rows;
let rows = await skips();
ok(rows.length === 1 && rows[0].routine_name === 'Missed Day' && String(rows[0].date) === shift(today, -2),
  'a passed day with nothing logged is auto-skipped on that date', JSON.stringify(rows));
ok(active.progress.next_routine?.name === 'Tomorrow Day', 'next routine is the next day\'s, not the rotation',
  active.progress.next_routine?.name);
ok(active.progress.next_date === shift(today, 1), 'next_date names the day', active.progress.next_date);

await api('GET', '/api/programs/active');
await api('GET', '/api/coach/week');
ok((await skips()).length === 1, 'reconciling again does not double-skip');

// Tomorrow's routine done today = done early: it covers tomorrow, which is not skipped
// later and is no longer next.
const tomorrowId = active.routines.find((r) => r.name === 'Tomorrow Day').id;
await api('POST', '/api/workouts', { routine_id: tomorrowId, date: today });
({ body: active } = await api('GET', '/api/programs/active'));
ok(active.progress.next_routine?.name === 'Missed Day', 'a session done early moves next on to the following slot',
  active.progress.next_routine?.name);
ok(active.progress.next_date === shift(today, 5), 'following slot is a week after the missed one', active.progress.next_date);

// Editing the program re-inserts routines under new ids; the weekdays must come along.
await api('PUT', `/api/programs/${prog.id}`, {
  name: 'Weekday Block',
  routines: active.routines.map((r) => ({
    name: r.name,
    weekday: r.weekday,
    exercises: r.exercises.map((e) => ({
      exercise_id: e.exercise_id, target_sets: e.target_sets,
      rep_range_low: e.rep_range_low, rep_range_high: e.rep_range_high,
    })),
  })),
});
({ body: active } = await api('GET', '/api/programs/active'));
ok(active.routines.every((r) => r.weekday != null), 'weekdays survive a program edit');
ok(active.progress.next_routine?.name === 'Missed Day', 'early session still counts after an edit',
  active.progress.next_routine?.name);

// A half-dated program would never offer its undated routines, so it stays on the rotation.
await api('POST', `/api/programs/${prog.id}/end`);
await db.query(`UPDATE programs SET status = 'archived' WHERE id = $1`, [prog.id]);
const { body: mixed } = await api('POST', '/api/programs', {
  name: 'Mixed Block',
  routines: [routine('Dated', ex['Squat'], wd(shift(today, 1))), routine('Undated', ex['Bench Press'], null)],
});
await api('POST', `/api/programs/${mixed.id}/start`);
({ body: active } = await api('GET', '/api/programs/active'));
ok(active.progress.next_routine?.name === 'Dated' && active.progress.next_date == null,
  'a partly dated program falls back to the rotation', JSON.stringify(active.progress));
await db.query(`UPDATE programs SET status = 'archived' WHERE id = $1`, [mixed.id]);

// A finite program finishes when auto-skips fill its last slots, and stops skipping there.
const { body: finite } = await api('POST', '/api/programs', {
  name: 'Finite Block',
  total_weeks: 1,
  routines: [routine('Only Day', ex['Squat'], wd(shift(today, -3)))],
});
await api('POST', `/api/programs/${finite.id}/start`);
await db.query(`UPDATE programs SET started_at = $2::date - 20 WHERE id = $1`, [finite.id, today]);
await api('GET', '/api/programs/active');
const { rows: [fin] } = await db.query(
  `SELECT p.status, (SELECT COUNT(*)::int FROM workouts w WHERE w.program_id = p.id) AS n
     FROM programs p WHERE p.id = $1`, [finite.id]);
ok(fin.status === 'completed' && fin.n === 1, 'auto-skip completes a finite program and stops at its target',
  JSON.stringify(fin));

await db.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
