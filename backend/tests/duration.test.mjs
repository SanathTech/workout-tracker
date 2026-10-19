// Duration is derived at Finish from created_at → now, capped at 6h.
import pg from 'pg';

const BASE = process.env.TEST_API_URL || 'http://localhost:3997';
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
// Shift created_at into the past so the elapsed-time branch can be exercised without
// actually waiting hours.
const backdate = (id, hours) =>
  db.query(`UPDATE workouts SET created_at = NOW() - INTERVAL '${hours} hours' WHERE id = $1`, [id]);
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

const { body: exercises } = await api('GET', '/api/exercises');
const ex = Object.fromEntries(exercises.map((e) => [e.name, e.id]));

const { body: prog } = await api('POST', '/api/programs', {
  name: 'Duration Block', total_weeks: 4,
  routines: [{ name: 'Day A', exercises: [{ exercise_id: ex['Squat'], target_sets: 2 }] }],
});
await api('POST', `/api/programs/${prog.id}/start`);
const routineId = prog.routines[0].id;

console.log('\n─── duration is written at Finish ───');
{
  const { body: w } = await api('POST', '/api/workouts', { routine_id: routineId });
  ok(w.duration_minutes === null, 'starts null', `got ${w.duration_minutes}`);
  const { body: done } = await api('POST', `/api/workouts/${w.id}/complete`);
  ok(done.duration_minutes === 1, 'a just-started workout finishes at 1 min (floor)', `got ${done.duration_minutes}`);
  const { body: fetched } = await api('GET', `/api/workouts/${w.id}`);
  ok(fetched.duration_minutes === 1, 'persisted, not just echoed');
}

console.log('\n─── an explicit duration is never overwritten ───');
{
  const { body: w } = await api('POST', '/api/workouts', { routine_id: routineId });
  await api('PUT', `/api/workouts/${w.id}`, { duration_minutes: 47 });
  const { body: done } = await api('POST', `/api/workouts/${w.id}/complete`);
  ok(done.duration_minutes === 47, 'manual 47 survives Finish', `got ${done.duration_minutes}`);
}

console.log('\n─── a forgotten session does not record a fake duration ───');
{
  const { body: w } = await api('POST', '/api/workouts', { routine_id: routineId });
  // Backdate created_at by 19 hours — the "forgot to hit Finish until tomorrow" case.
  await backdate(w.id, 19);
  const { body: done } = await api('POST', `/api/workouts/${w.id}/complete`);
  ok(done.duration_minutes === null, 'over the 6h cap → left null, not 1140', `got ${done.duration_minutes}`);
  ok(done.status === 'completed', 'still completes normally');
}

console.log('\n─── just inside the cap still records ───');
{
  const { body: w } = await api('POST', '/api/workouts', { routine_id: routineId });
  await backdate(w.id, 2);
  const { body: done } = await api('POST', `/api/workouts/${w.id}/complete`);
  ok(done.duration_minutes === 120, '2h session records 120 min', `got ${done.duration_minutes}`);
}

console.log('\n─── a resumed session adds its sitting, not the night between ───');
{
  const backdateResume = (id, minutes) =>
    db.query(`UPDATE workouts SET resumed_at = NOW() - INTERVAL '${minutes} minutes' WHERE id = $1`, [id]);
  const { body: w } = await api('POST', '/api/workouts', { routine_id: routineId });
  await backdate(w.id, 0.5);
  await api('POST', `/api/workouts/${w.id}/complete`);
  // The next morning: created_at is now a day old, which alone would read as "forgotten".
  await backdate(w.id, 24);
  const resumed = await api('POST', `/api/workouts/${w.id}/resume`);
  ok(resumed.status === 200 && resumed.body.status === 'in_progress', 'resume reopens it', `got ${resumed.status}`);
  ok(resumed.body.duration_minutes === 30, 'first sitting kept while resumed', `got ${resumed.body.duration_minutes}`);
  const again = await api('POST', `/api/workouts/${w.id}/resume`);
  ok(again.status === 409, 'an open session cannot be resumed again', `got ${again.status}`);
  const skipped = await api('POST', `/api/workouts/${w.id}/skip`);
  ok(skipped.status === 404, 'a resumed session cannot be skipped away');
  await backdateResume(w.id, 25);
  const { body: done } = await api('POST', `/api/workouts/${w.id}/complete`);
  ok(done.duration_minutes === 55, '30 + 25 = 55, overnight gap excluded', `got ${done.duration_minutes}`);
  ok(done.resumed_at === null, 'resumed_at cleared on Finish');
  const { body: other } = await api('POST', '/api/workouts', { routine_id: routineId });
  const blocked = await api('POST', `/api/workouts/${w.id}/resume`);
  ok(blocked.status === 409, 'not while another session is under way', `got ${blocked.status}`);
  await api('POST', `/api/workouts/${other.id}/complete`);
}

console.log('\n─── a resumed sitting left open overnight adds nothing ───');
{
  const { body: w } = await api('POST', '/api/workouts', { routine_id: routineId });
  await api('PUT', `/api/workouts/${w.id}`, { duration_minutes: 40 });
  await api('POST', `/api/workouts/${w.id}/complete`);
  await api('POST', `/api/workouts/${w.id}/resume`);
  await db.query(`UPDATE workouts SET resumed_at = NOW() - INTERVAL '19 hours' WHERE id = $1`, [w.id]);
  const { body: done } = await api('POST', `/api/workouts/${w.id}/complete`);
  ok(done.duration_minutes === 40, 'earlier total stands', `got ${done.duration_minutes}`);
}

console.log('\n─────────────────────────────');
console.log(`  ${pass} passed, ${fail} failed`);
await db.end();
process.exit(fail ? 1 : 0);
