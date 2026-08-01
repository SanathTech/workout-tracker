// Covers the seam created by rebasing Phase 1 (soft-deleted routines) onto #39
// (skip workouts). Retired routines must not inflate routines-per-cycle, or the
// week number and next-routine sequence drift after any program edit.
const BASE = process.env.TEST_API_URL || 'http://localhost:3997';
let pass = 0, fail = 0;
const ok = (c, label, detail = '') => {
  if (c) { console.log(`  PASS  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ''}`); fail++; }
};
async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, body: json, raw: text };
}

const { body: exercises } = await api('GET', '/api/exercises');
const ex = Object.fromEntries(exercises.map((e) => [e.name, e.id]));
const routine = (name, exId) => ({
  name,
  exercises: [{ exercise_id: exId, target_sets: 3, rep_range_low: 5, rep_range_high: 8 }],
});

console.log('\n─── skip + soft-delete seam ───');

const { body: prog } = await api('POST', '/api/programs', {
  name: 'Seam Block',
  total_weeks: 3,
  routines: [
    routine('Day A', ex['Squat']),
    routine('Day B', ex['Bench Press']),
    routine('Day C', ex['Deadlift']),
  ],
});
await api('POST', `/api/programs/${prog.id}/start`);

let { body: active } = await api('GET', '/api/programs/active');
ok(active.progress.total_workouts === 9, '3 weeks x 3 routines = 9 total', `got ${active.progress.total_workouts}`);
ok(active.progress.next_routine.name === 'Day A', 'starts on Day A');

// Skip Day A — a skipped row must advance the sequence to Day B.
const skip = await api('POST', '/api/workouts/skip', { routine_id: active.progress.next_routine.id });
ok(skip.status < 300, `skip upcoming accepted (${skip.status})`);
({ body: active } = await api('GET', '/api/programs/active'));
ok(active.progress.next_routine.name === 'Day B', 'skip advanced sequence to Day B', `got ${active.progress.next_routine?.name}`);
ok(active.progress.skipped_workouts === 1, 'skipped counted separately', JSON.stringify(active.progress));
const melToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
ok(skip.body?.date === melToday, 'skip dated in Melbourne, not UTC', `got ${skip.body?.date} want ${melToday}`);
ok(active.progress.completed_workouts === 0, 'skip does NOT count as completed');

// Now edit the program. This retires all 3 routines and inserts 3 fresh rows.
const edit = await api('PUT', `/api/programs/${prog.id}`, {
  name: 'Seam Block',
  total_weeks: 3,
  routines: [
    routine('Day A', ex['Squat']),
    routine('Day B', ex['Bench Press']),
    routine('Day C', ex['Deadlift']),
  ],
});
ok(edit.status < 300, `program edit accepted (${edit.status})`);

({ body: active } = await api('GET', '/api/programs/active'));
ok(active.routines.length === 3, 'still exactly 3 live routines after edit', `got ${active.routines.length}`);
// The load-bearing assertion: 6 rows exist, only 3 are live. If the count ignored
// deleted_at, per-cycle would be 6 and total would jump to 18.
ok(active.progress.total_workouts === 9, 'total STILL 9 — retired routines not counted', `got ${active.progress.total_workouts}`);
ok(active.progress.week === 1, 'still week 1 — retired routines did not deflate the week', `got ${active.progress.week}`);
ok(active.progress.skipped_workouts === 1, 'skip survived the program edit');

// Start + complete a real workout on the post-edit routine set.
const target = active.progress.next_routine;
const { body: w } = await api('POST', '/api/workouts', { routine_id: target.id });
ok(!!w?.id, `workout started on ${target.name}`);
ok(w.program_week === 1, 'program_week computed from LIVE routine count', `got ${w.program_week}`);
await api('POST', `/api/workouts/${w.id}/complete`);

({ body: active } = await api('GET', '/api/programs/active'));
ok(active.progress.completed_workouts === 1, 'completed count is 1', JSON.stringify(active.progress));

// Starting a workout from a RETIRED routine must 404, not silently succeed.
const retired = await api('POST', '/api/workouts', { routine_id: prog.routines[0].id });
ok(retired.status === 404, 'retired routine rejected with 404', `got ${retired.status}`);

console.log('\n─────────────────────────────');
console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
