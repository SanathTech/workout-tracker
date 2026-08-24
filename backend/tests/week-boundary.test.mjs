// "This week" is a local-time question.
//
// Neon and Vercel run in UTC, so for the first ten hours of a Melbourne weekday the
// server is still on the previous calendar day — and on a Monday morning that puts it in
// the previous ISO week entirely. The dashboard counter read "3 workouts this week" at
// 9am on a Monday when nothing had been logged yet, because DATE_TRUNC('week',
// CURRENT_DATE) was still pointing at the Monday before.
//
// The boundary this asserts is the app timezone's, which is the same one workouts.date
// is written in. Outside the UTC-disagrees window the old code would pass too — that is
// the nature of the bug — but the semantics are pinned either way.
const BASE = process.env.TEST_API_URL || 'http://localhost:3997';
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

// The same derivation the server uses, deliberately duplicated: if these two ever
// disagree about which Monday it is, that disagreement is the thing worth catching.
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: process.env.APP_TIMEZONE || 'Australia/Melbourne',
  year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const shift = (iso, delta) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
};
const [ty, tm, td] = today.split('-').map(Number);
const monday = shift(today, -((new Date(Date.UTC(ty, tm - 1, td)).getUTCDay() + 6) % 7));

const { body: exercises } = await api('GET', '/api/exercises');
const ex = Object.fromEntries(exercises.map((e) => [e.name, e.id]));

const { body: prog } = await api('POST', '/api/programs', {
  name: 'Week Boundary', total_weeks: 4,
  routines: [{
    name: 'Day A',
    exercises: [{ exercise_id: ex['Squat'], target_sets: 1, rep_range_low: 5, rep_range_high: 8 }],
  }],
});
await api('POST', `/api/programs/${prog.id}/start`);
const routineId = prog.routines[0].id;

// One session on Sunday night, one on Monday. Only the Monday one is "this week".
for (const date of [shift(monday, -1), monday]) {
  const { body: w } = await api('POST', '/api/workouts', { routine_id: routineId, date });
  await api('PUT', `/api/workouts/${w.id}`, {
    exercises: [{ exercise_id: ex['Squat'], sets: [{ set_number: 1, reps: 5, weight_kg: 100, set_type: 'working' }] }],
  });
  await api('POST', `/api/workouts/${w.id}/complete`);
}

console.log('\n─── the week starts on the local Monday, not the UTC one ───');
{
  const { body: stats } = await api('GET', '/api/progress/stats');
  ok(stats.total_workouts === 2, 'both sessions were logged', `got ${stats.total_workouts}`);
  ok(stats.workouts_this_week === 1,
    `only the session on or after ${monday} counts`, `got ${stats.workouts_this_week}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
