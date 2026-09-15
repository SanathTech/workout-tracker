// Home's day-first data (2026-09-15 rethink): the one-line Tomorrow row, the plan card's
// "last time" figures, and the "N of M lifts up" progress line.
//
// Tomorrow is the bug he walked straight into: Home showed "Up next: Day A" — the next
// routine in the rotation, with no day attached — on a Tuesday, and he read it as
// Wednesday's session when Wednesday is the swim. It has to come off the weekday map.
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
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekdayOf = (iso) => WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];

const { body: exercises } = await api('GET', '/api/exercises');
const ex = Object.fromEntries(exercises.map((e) => [e.name, e.id]));

console.log('\n─── /progress/last-session: null before anything is logged ───');
{
  const { status, body } = await api('GET', '/api/progress/last-session');
  ok(status === 200 && body === null, 'no completed session → null', JSON.stringify(body));
}

const { body: prog } = await api('POST', '/api/programs', {
  name: 'Home Day First', total_weeks: 4,
  routines: [
    { name: 'Day A — Squat / Push', exercises: [
      { exercise_id: ex['Squat'], target_sets: 2, rep_range_low: 4, rep_range_high: 6, is_main: true },
      { exercise_id: ex['Dips'], target_sets: 2, rep_range_low: 6, rep_range_high: 8, is_main: true },
      { exercise_id: ex['Pull-Up'], target_sets: 2, rep_range_low: 6, rep_range_high: 8 },
    ] },
    { name: 'Day B — Hinge / Row', exercises: [
      { exercise_id: ex['Squat'], target_sets: 1, rep_range_low: 4, rep_range_high: 6 },
    ] },
  ],
});
await api('POST', `/api/programs/${prog.id}/start`);
const [dayA, dayB] = prog.routines;

async function logSession(routineId, date, exs) {
  const { body: w } = await api('POST', '/api/workouts', { routine_id: routineId, date });
  await api('PUT', `/api/workouts/${w.id}`, {
    exercises: exs.map(([id, sets]) => ({
      exercise_id: id,
      sets: sets.map(([weight_kg, reps], i) => ({ set_number: i + 1, weight_kg, reps, set_type: 'working' })),
    })),
  });
  await api('POST', `/api/workouts/${w.id}/complete`);
  return w.id;
}

// Older session: squat top set 50 × 5, dips +2.5 × 8, assisted pull-up -20.5 × 8.
await logSession(dayA.id, shift(today, -9), [
  [ex['Squat'], [[40, 8], [50, 5]]],
  [ex['Dips'], [[2.5, 8], [2.5, 8]]],
  [ex['Pull-Up'], [[-20.5, 8]]],
]);
// Newest session: squat same weight more reps (up), dips identical (same), pull-up
// less assistance (up — the axis he moves along), plus a first-ever calf raise (new).
const lastId = await logSession(dayA.id, shift(today, -2), [
  [ex['Squat'], [[50, 6], [50, 6]]],
  [ex['Dips'], [[2.5, 8]]],
  [ex['Pull-Up'], [[-18, 8], [-18, 7]]],
  [ex['Calf Raise'] ?? ex['Standing Calf Raise'] ?? ex['Plank'], [[20, 12]]],
]);

console.log('\n─── /progress/last-session: top set vs the time before ───');
{
  const { body } = await api('GET', '/api/progress/last-session');
  ok(body?.workout_id === lastId, 'reads the most recent completed session', JSON.stringify(body));
  const by = Object.fromEntries((body?.lifts || []).map((l) => [l.exercise_id, l]));
  ok(by[ex['Squat']]?.change === 'up' && by[ex['Squat']].reps === 6, 'same weight, more reps → up', JSON.stringify(by[ex['Squat']]));
  ok(by[ex['Dips']]?.change === 'same', 'identical top set → same', JSON.stringify(by[ex['Dips']]));
  ok(by[ex['Pull-Up']]?.change === 'up' && by[ex['Pull-Up']].weight_kg === -18, 'less assistance on an assisted lift → up', JSON.stringify(by[ex['Pull-Up']]));
  ok(body?.lifts?.some((l) => l.change === 'new'), 'a first-ever lift is new, not up');
  ok(body?.up === 2 && body?.compared === 3, 'up 2 of 3 compared (new lifts excluded)', `up=${body?.up} compared=${body?.compared}`);
  ok(body?.lifts?.[0]?.exercise_id === ex['Squat'], 'lifts come back in session order');
}

console.log('\n─── /coach/week: tomorrow comes off the weekday map ───');
await db.query(
  `INSERT INTO activities (id, start_date_local, date, type, name, moving_time, distance,
                          average_hr, hr_zone_times, stream_summary, raw)
        VALUES ('home-run-prev', $1::date + TIME '12:45', $1, 'Run', 'Easy', 4127, 8941, 147,
                ARRAY[960, 2546, 489, 103],
                '{"kind":"run","run_only":{"pace_s_per_km":437},"efforts":[{},{},{},{},{},{}]}'::jsonb, '{}'::jsonb),
               ('home-run-today', $2::date + TIME '07:00', $2, 'Run', 'Today', 1800, 4000, 140,
                ARRAY[900, 900, 0, 0], '{"kind":"run","efforts":[{}]}'::jsonb, '{}'::jsonb)`,
  [shift(today, -8), today]
);
{
  const { body: week } = await api('GET', '/api/coach/week');
  ok(week.days.length === 7, 'the week is still seven days');
  const t = week.tomorrow;
  ok(t?.date === shift(today, 1), 'tomorrow is the next calendar day, even across a Sunday', JSON.stringify(t?.date));
  ok(t?.weekday === weekdayOf(shift(today, 1)), 'tomorrow carries its weekday');
  const gymDays = ['Monday', 'Thursday', 'Saturday'];
  ok(gymDays.includes(t?.weekday) ? t.planned.kind === 'gym' : t?.planned.kind !== 'gym',
    'tomorrow is a gym slot only on Mon/Thu/Sat', `${t?.weekday} → ${t?.planned.kind}`);
  if (t?.planned.kind === 'gym') {
    ok([dayA.name, dayB.name].includes(t.planned.title), 'a gym tomorrow names its routine', t.planned.title);
  }

  const prev = week.previous?.run;
  ok(prev?.date === shift(today, -8) && prev.stats.run_pace_s === 437, 'previous run is the latest before today', JSON.stringify(prev));
  ok(prev?.stats.strides === 6, 'six efforts count as strides');
  ok(prev?.stats.over_ceiling_min === 9.9, 'minutes over the ceiling from zones 3+', String(prev?.stats.over_ceiling_min));

  const todayRow = week.days.find((d) => d.state === 'today');
  const run = todayRow.actual.find((a) => a.stats?.activity_id === 'home-run-today');
  ok(run && run.stats.distance_m === 4000 && run.stats.moving_s === 1800, "today's run carries its stats", JSON.stringify(run));
  ok(run?.stats.strides === null, 'one stray effort is not strides');
}

await db.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
