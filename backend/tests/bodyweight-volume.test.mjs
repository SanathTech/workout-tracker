// Volume on the movements where his body is the load.
//
// The regression this exists for: a session of squats, bodyweight dips and assisted
// pull-ups totalled -21kg, because the assistance was logged as a negative weight and
// summed straight into the total. The coach read the negative as a data entry error and
// graded a completed workout as a glitch. Volume has to count the body.
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

const { body: exercises } = await api('GET', '/api/exercises');
const ex = Object.fromEntries(exercises.map((e) => [e.name, e.id]));

// Named rather than assumed: if the seed ever stops marking these as bodyweight the
// arithmetic below silently reverts to the bug, and the failure should say so.
{
  const bw = Object.fromEntries(exercises.map((e) => [e.name, e.is_bodyweight]));
  ok(bw['Pull-Up'] === true, 'Pull-Up is flagged bodyweight');
  ok(bw['Dips'] === true, 'Dips is flagged bodyweight');
  ok(bw['Squat'] === false, 'Squat is not');
}

// He weighed 90kg the day before the session, and the lookup takes the last reading on
// or before the workout date — a stale-by-a-day scale still gives the right answer, and
// the older reading must not win.
//
// The same day carries a Garmin figure too, deliberately absurd: a manual weigh-in is a
// correction, so it has to beat the scale on a tie the way the coach's bodyweight block
// already does. If the tie-break breaks, every number below moves.
await db.query(
  `INSERT INTO training_load (date, weight_kg, ctl, atl, raw)
        VALUES ($1, 200, 10, 10, '{}'::jsonb), ($2, 55, 10, 10, '{}'::jsonb)
   ON CONFLICT (date) DO NOTHING`,
  [shift(today, -1), shift(today, -4)]
);
await db.query(
  'INSERT INTO bodyweight_logs (date, weight_kg) VALUES ($1, 90) ON CONFLICT (date) DO NOTHING',
  [shift(today, -1)]
);

const { body: prog } = await api('POST', '/api/programs', {
  name: 'Bodyweight Volume', total_weeks: 4,
  routines: [{
    name: 'Day A',
    exercises: [
      { exercise_id: ex['Squat'], target_sets: 1, rep_range_low: 5, rep_range_high: 8 },
      { exercise_id: ex['Dips'], target_sets: 1, rep_range_low: 5, rep_range_high: 8 },
      { exercise_id: ex['Pull-Up'], target_sets: 1, rep_range_low: 5, rep_range_high: 8 },
    ],
  }],
});
await api('POST', `/api/programs/${prog.id}/start`);

const { body: w } = await api('POST', '/api/workouts', { routine_id: prog.routines[0].id });
await api('PUT', `/api/workouts/${w.id}`, {
  exercises: [
    { exercise_id: ex['Squat'], sets: [
      { set_number: 1, reps: 5, weight_kg: 60, set_type: 'warmup' },
      { set_number: 2, reps: 5, weight_kg: 100, set_type: 'working' },
    ] },
    // A bodyweight warm-up is the case that made the history list's missing filter
    // visible: before, it contributed nothing and hid the omission.
    { exercise_id: ex['Dips'], sets: [
      { set_number: 1, reps: 8, weight_kg: 0, set_type: 'warmup' },
      { set_number: 2, reps: 10, weight_kg: 0, set_type: 'working' },
    ] },
    { exercise_id: ex['Pull-Up'], sets: [{ set_number: 1, reps: 10, weight_kg: -20, set_type: 'working' }] },
  ],
});
await api('POST', `/api/workouts/${w.id}/complete`);

// 100x5 squat = 500, bodyweight dips 90x10 = 900, pull-ups assisted to 70kg x10 = 700.
// The warm-ups would add 300 and 720 on top if any surface forgot to exclude them.
const EXPECTED = 500 + 900 + 700;

console.log('\n─── the body counts, and assistance subtracts from it ───');
{
  const { body: stats } = await api('GET', '/api/progress/stats');
  ok(Number(stats.total_volume_kg) === EXPECTED,
    `total volume is ${EXPECTED}kg, not -21`, `got ${stats.total_volume_kg}`);
  ok(Number(stats.total_volume_kg) > 0, 'a session of assisted work is never negative');

  const { body: vol } = await api('GET', '/api/progress/volume?weeks=4');
  ok(Number(vol[0].total_volume) === EXPECTED, 'the weekly chart agrees', `got ${vol[0]?.total_volume}`);

  const { body: hist } = await api('GET', '/api/workouts?status=completed');
  ok(Number(hist[0].total_volume) === EXPECTED,
    'the history list agrees, warm-ups and all', `got ${hist[0]?.total_volume}`);

  const { body: perEx } = await api('GET', `/api/progress/exercise/${ex['Pull-Up']}?weeks=4`);
  ok(Number(perEx[0].volume) === 700, 'per-exercise volume is 70kg x 10', `got ${perEx[0]?.volume}`);
  ok(Number(perEx[0].max_weight) === -20,
    'but max_weight stays the added load — that is the axis progression moves along',
    `got ${perEx[0]?.max_weight}`);
}

// The number the coach reasons over is the one that was wrong, so assert the bundle
// itself rather than trusting that the shared expression reached it.
console.log('\n─── and the coach reads the same number ───');
{
  const { default: ctx } = await import('../src/util/coachContext.js');
  const sessions = await ctx.strengthSessions(7);
  const session = sessions.find((s) => s.date === today);
  ok(session != null, 'the session is in the coach bundle', JSON.stringify(sessions));
  ok(Number(session?.volume_kg) === EXPECTED,
    'the coach sees the same volume as the app', `got ${session?.volume_kg}`);
}

// Assistance heavier than he is would otherwise drive the total below zero and eat into
// the rest of the session's work.
console.log('\n─── over-assistance floors at zero rather than going negative ───');
{
  const { body: w2 } = await api('POST', '/api/workouts', { routine_id: prog.routines[0].id });
  await api('PUT', `/api/workouts/${w2.id}`, {
    exercises: [
      { exercise_id: ex['Pull-Up'], sets: [{ set_number: 1, reps: 10, weight_kg: -200, set_type: 'working' }] },
    ],
  });
  await api('POST', `/api/workouts/${w2.id}/complete`);

  const { body: stats } = await api('GET', '/api/progress/stats');
  ok(Number(stats.total_volume_kg) === EXPECTED,
    'a weightless set adds nothing and takes nothing away', `got ${stats.total_volume_kg}`);
}

await db.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
