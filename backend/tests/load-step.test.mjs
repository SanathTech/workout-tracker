// A lift's own load step (2026-09-21). The engine moved everything by muscle group —
// 2.5kg compound, 1.25kg isolation — so the RDL, which he takes in 5kg-plate steps,
// needed a standing coach note to override it every single time. Standing notes are
// exactly the wrong tool for a permanent property of a lift: they outlive their reason
// (see the overtaken-call rule) and they suppress the engine while they stand.
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

const { body: exercises } = await api('GET', '/api/exercises');
const ex = Object.fromEntries(exercises.map((e) => [e.name, e.id]));

const { body: prog } = await api('POST', '/api/programs', {
  name: 'Load Step', total_weeks: 4,
  routines: [{ name: 'Day A', exercises: [
    { exercise_id: ex['Deadlift'] ?? ex['Squat'], target_sets: 3, rep_range_low: 5, rep_range_high: 8 },
  ] }],
});
await api('POST', `/api/programs/${prog.id}/start`);
const routineId = prog.routines[0].id;
const lift = prog.routines[0].exercises[0].exercise_id;

// Cleared the range at 60kg → the engine wants to add load.
const { body: w } = await api('POST', '/api/workouts', { routine_id: routineId });
await api('PUT', `/api/workouts/${w.id}`, {
  exercises: [{ exercise_id: lift, sets: [1, 2, 3].map((n) => ({ set_number: n, reps: 8, weight_kg: 60, set_type: 'working' })) }],
});
await api('POST', `/api/workouts/${w.id}/complete`);

const suggestion = async () => (await api('GET', `/api/progress/suggestions?routine_id=${routineId}`)).body
  .find((s) => s.exercise_id === lift);

console.log('\n─── without a step, the muscle-group default stands ───');
{
  const s = await suggestion();
  ok(s.action === 'increase', 'the range was cleared, so it adds load', s.action);
  ok(s.suggested_weight_kg === 62.5, 'a compound moves 2.5kg by default', String(s.suggested_weight_kg));
}

console.log('\n─── the lift can carry its own step ───');
{
  const { status } = await api('PUT', `/api/exercises/${lift}`, { load_step_kg: 10 });
  ok(status === 200, 'the step saves');
  const s = await suggestion();
  ok(s.suggested_weight_kg === 70, 'and the engine uses it — 60 + 10, not 62.5', String(s.suggested_weight_kg));
  ok(s.reason.includes('10kg') || s.reason.includes('10 kg'), 'the reason says what it added', s.reason);
}

console.log('\n─── it is clearable, and it is validated ───');
{
  ok((await api('PUT', `/api/exercises/${lift}`, { load_step_kg: 0 })).status === 400, 'zero is not a step');
  ok((await api('PUT', `/api/exercises/${lift}`, { load_step_kg: -5 })).status === 400, 'nor is a negative one');
  ok((await api('PUT', `/api/exercises/${lift}`, { load_step_kg: 'heavy' })).status === 400, 'nor a word');
  const { body: still } = await api('GET', `/api/exercises/${lift}`);
  ok(Number(still.load_step_kg) === 10, 'a rejected edit leaves the step alone', String(still.load_step_kg));

  await api('PUT', `/api/exercises/${lift}`, { load_step_kg: null });
  const s = await suggestion();
  ok(s.suggested_weight_kg === 62.5, 'clearing it returns the lift to the default', String(s.suggested_weight_kg));

  await api('PUT', `/api/exercises/${lift}`, { name: `${(await api('GET', `/api/exercises/${lift}`)).body.name}` });
  const { body: untouched } = await api('GET', `/api/exercises/${lift}`);
  ok(untouched.load_step_kg === null, 'an edit that does not mention the step does not clear it', String(untouched.load_step_kg));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
