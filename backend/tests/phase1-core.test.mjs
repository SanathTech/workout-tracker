// Drives the real HTTP API against a throwaway Postgres to prove the Phase 1 fixes.
const BASE = process.env.TEST_API_URL || 'http://localhost:3997';
let pass = 0, fail = 0;

const ok = (cond, label, detail = '') => {
  if (cond) { console.log(`  PASS  ${label}`); pass++; }
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
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, body: json, raw: text };
}

const exById = {};

console.log('\n─── setup ───');
{
  const { body: exercises } = await api('GET', '/api/exercises');
  for (const e of exercises) exById[e.name] = e.id;
  ok(exercises.length > 0, `exercise library seeded (${exercises.length})`);
}

// ── C-04: editing a program must not erase past workouts' prescriptions ──
console.log('\n─── C-04  program edit preserves logged history ───');

const squat = exById['Squat'], bench = exById['Bench Press'];

const { body: program } = await api('POST', '/api/programs', {
  name: 'Test Block',
  total_weeks: 4,
  routines: [
    {
      name: 'Day A',
      exercises: [
        { exercise_id: squat, target_sets: 3, rep_range_low: 5, rep_range_high: 8, rest_seconds: 180, target_rir_per_set: [2, 2, 1], notes: 'brace hard' },
        { exercise_id: bench, target_sets: 3, rep_range_low: 8, rep_range_high: 12 },
      ],
    },
    { name: 'Day B', exercises: [{ exercise_id: bench, target_sets: 4 }] },
  ],
});
ok(program?.id != null, 'program created');
ok(program.routines.length === 2, 'two routines');

await api('POST', `/api/programs/${program.id}/start`);
const routineA = program.routines[0];

const { body: workout } = await api('POST', '/api/workouts', { routine_id: routineA.id });
ok(workout?.id != null, 'workout started from routine');
ok(workout.exercises.length === 2, 'workout prefilled from template');
ok(workout.exercises[0].target?.rep_range_low === 5, 'target prescription present at start');
ok(workout.exercises[0].target?.notes === 'brace hard', 'target notes present at start');

// logged_at is the passive rest-tracking stamp: client-set when reps first land on a
// row, stored verbatim, junk stored as null rather than failing the save.
const t1 = '2026-01-05T09:00:00.000Z';
const t2 = '2026-01-05T09:03:20.000Z';
await api('PUT', `/api/workouts/${workout.id}`, {
  notes: 'felt strong',
  exercises: [
    { exercise_id: squat, sets: [{ set_number: 1, reps: 5, weight_kg: 100, rir: 2, logged_at: t1 }, { set_number: 2, reps: 5, weight_kg: 100, rir: 1, logged_at: t2 }] },
    { exercise_id: bench, sets: [{ set_number: 1, reps: 10, weight_kg: 60, rir: 2, logged_at: 'not-a-date' }] },
  ],
});
await api('POST', `/api/workouts/${workout.id}/complete`);

{
  const { body: rt } = await api('GET', `/api/workouts/${workout.id}`);
  const sets = rt.exercises[0].sets;
  ok(Date.parse(sets[0].logged_at) === Date.parse(t1), 'logged_at round-trips', `got ${sets[0].logged_at}`);
  ok(Date.parse(sets[1].logged_at) - Date.parse(sets[0].logged_at) === 200_000,
    'rest between sets is derivable from the stamps');
  ok(rt.exercises[1].sets[0].logged_at == null, 'an unparseable stamp stores as null, not a failed save');
}

const before = await api('GET', `/api/workouts/${workout.id}`);
ok(before.body.routine_id != null, 'completed workout is linked to its routine');
ok(before.body.exercises[0].target?.rep_range_low === 5, 'prescription resolves BEFORE program edit');

// The trigger: save an edit to the program.
const editRes = await api('PUT', `/api/programs/${program.id}`, {
  name: 'Test Block v2',
  routines: [
    { name: 'Day A', exercises: [{ exercise_id: squat, target_sets: 4, rep_range_low: 6, rep_range_high: 10 }] },
    { name: 'Day B', exercises: [{ exercise_id: bench, target_sets: 4 }] },
  ],
});
ok(editRes.status === 200, 'program edit saved');

const after = await api('GET', `/api/workouts/${workout.id}`);
ok(after.body.routine_id != null, 'routine_id SURVIVES the program edit', `got ${after.body.routine_id}`);
ok(after.body.exercises[0].target?.rep_range_low === 5, 'past workout keeps its ORIGINAL 5-8 prescription', JSON.stringify(after.body.exercises[0].target?.rep_range_low));
ok(after.body.exercises[0].target?.notes === 'brace hard', 'past workout keeps its original notes');
ok(after.body.exercises[0].sets.length === 2, 'logged sets intact');
ok(Number(after.body.exercises[0].sets[0].weight_kg) === 100, 'logged weight intact');

// The live program must reflect the NEW prescription, not the retired one.
const { body: activeProgram } = await api('GET', '/api/programs/active');
ok(activeProgram.routines.length === 2, 'active program still shows exactly 2 routines (retired ones hidden)');
ok(activeProgram.routines[0].exercises[0].rep_range_low === 6, 'active program shows the NEW 6-10 prescription');

const { body: programList } = await api('GET', '/api/programs');
ok(programList[0].routine_count === 2, 'routine_count excludes retired routines', `got ${programList[0].routine_count}`);

// Sequencing must not be thrown off by retired rows.
ok(activeProgram.progress.total_workouts === 8, 'total_workouts = 4 weeks x 2 routines', `got ${activeProgram.progress.total_workouts}`);
ok(activeProgram.progress.next_routine?.name === 'Day B', 'next routine is Day B after 1 completed', activeProgram.progress.next_routine?.name);

// ── C-05: notes must be clearable ──
console.log('\n─── C-05  notes can be cleared ───');
const w2 = (await api('POST', '/api/workouts', { routine_id: activeProgram.routines[0].id })).body;

await api('PUT', `/api/workouts/${w2.id}`, { notes: 'a note', exercises: [] });
ok((await api('GET', `/api/workouts/${w2.id}`)).body.notes === 'a note', 'note written');

await api('PUT', `/api/workouts/${w2.id}`, { notes: null, exercises: [] });
ok((await api('GET', `/api/workouts/${w2.id}`)).body.notes === null, 'note CLEARED and stays cleared');

await api('PUT', `/api/workouts/${w2.id}`, { exercises: [] }); // key absent
await api('PUT', `/api/workouts/${w2.id}`, { notes: 'restored', exercises: [] });
await api('PUT', `/api/workouts/${w2.id}`, { exercises: [] }); // key absent — must not wipe
ok((await api('GET', `/api/workouts/${w2.id}`)).body.notes === 'restored', 'absent notes key leaves the value alone');

// Program description, same class of bug.
await api('PUT', `/api/programs/${program.id}`, { description: 'a description' });
ok((await api('GET', `/api/programs/${program.id}`)).body.description === 'a description', 'program description written');
await api('PUT', `/api/programs/${program.id}`, { description: '' });
ok((await api('GET', `/api/programs/${program.id}`)).body.description === null, 'program description CLEARED');
await api('PUT', `/api/programs/${program.id}`, { name: 'Renamed only' });
ok((await api('GET', `/api/programs/${program.id}`)).body.name === 'Renamed only', 'rename works with description absent');

// ── C-02: workout dates ──
console.log('\n─── C-02  workout dates ───');
const w3 = (await api('POST', '/api/workouts', { routine_id: activeProgram.routines[0].id, date: '2026-03-15' })).body;
ok(String(w3.date).slice(0, 10) === '2026-03-15', 'client-supplied local date is respected', String(w3.date));

const bad = await api('PUT', `/api/workouts/${w3.id}`, { date: '2026-02-31' });
ok(bad.status === 400, 'impossible date rejected with 400', `got ${bad.status}`);
const bad2 = await api('PUT', `/api/workouts/${w3.id}`, { date: 'not-a-date' });
ok(bad2.status === 400, 'malformed date rejected with 400', `got ${bad2.status}`);
ok(String((await api('GET', `/api/workouts/${w3.id}`)).body.date).slice(0, 10) === '2026-03-15', 'rejected date left the row untouched');

const w4 = (await api('POST', '/api/workouts', { routine_id: activeProgram.routines[0].id })).body;
const melbourneToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
ok(String(w4.date).slice(0, 10) === melbourneToday, 'server fallback uses the Melbourne day, not UTC', `got ${String(w4.date).slice(0,10)}, expected ${melbourneToday}`);

console.log(`\n─────────────────────────────\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
