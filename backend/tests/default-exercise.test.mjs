// "Make this the default" from inside a session: a logged exercise remembers the routine
// slot it came from (routine_exercise_id), so a swapped-in substitute keeps its
// prescription across reloads and can be promoted to the routine's default in place.
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

// The seed has no cable variant; exercises persist across suites, so tolerate a re-run.
const created = await api('POST', '/api/exercises', { name: 'Cable Lateral Raise', muscle_group: 'Shoulders' });
ok(created.status === 201 || created.status === 409, `cable variant available (${created.status})`);
const { body: exercises } = await api('GET', '/api/exercises');
const ex = Object.fromEntries(exercises.map((e) => [e.name, e.id]));
const byId = Object.fromEntries(exercises.map((e) => [e.id, e.name]));

console.log('\n─── default exercise from the session ───');

const { body: prog } = await api('POST', '/api/programs', {
  name: 'Default Block',
  total_weeks: 2,
  routines: [
    {
      name: 'Day A',
      exercises: [
        { exercise_id: ex['Squat'], target_sets: 3, rep_range_low: 4, rep_range_high: 6 },
        {
          exercise_id: ex['Lateral Raise'], target_sets: 3, rep_range_low: 10, rep_range_high: 15,
          notes: 'lead with the elbows',
          // The default listed as its own substitute: promotion must not duplicate it.
          substitutes: [ex['Cable Lateral Raise'], ex['Lateral Raise'], ex['Bench Press']],
        },
      ],
    },
    { name: 'Day B', exercises: [{ exercise_id: ex['Deadlift'], target_sets: 3 }] },
  ],
});
await api('POST', `/api/programs/${prog.id}/start`);
let { body: active } = await api('GET', '/api/programs/active');
const dayA = active.routines.find((r) => r.name === 'Day A');
const slot = dayA.exercises.find((e) => e.exercise_id === ex['Lateral Raise']);

// 1) Starting from a routine stamps each row with its slot.
const { body: w } = await api('POST', '/api/workouts', { routine_id: dayA.id });
const lateral = w.exercises.find((e) => e.exercise_id === ex['Lateral Raise']);
ok(w.exercises.every((e) => Number.isInteger(e.routine_exercise_id)), 'every templated row carries routine_exercise_id');
ok(lateral?.routine_exercise_id === slot.id, 'row points at its own slot', `got ${lateral?.routine_exercise_id} want ${slot.id}`);
ok(lateral?.target?.exercise_name === 'Lateral Raise', 'target carries the prescribed exercise name');

// 2) Swap it mid-session (what the picker does) — the slot rides along, so the
//    prescription survives a reload instead of vanishing with the old exercise_id.
const swapped = w.exercises.map((e) => ({
  exercise_id: e.exercise_id === ex['Lateral Raise'] ? ex['Cable Lateral Raise'] : e.exercise_id,
  routine_exercise_id: e.routine_exercise_id,
  notes: null,
  sets: e.sets.map((s) => ({ set_number: s.set_number, reps: s.set_number === 1 ? 12 : null, weight_kg: s.set_number === 1 ? 5 : null })),
}));
const put = await api('PUT', `/api/workouts/${w.id}`, { exercises: swapped });
ok(put.status < 300, `swap saved (${put.status})`, put.raw);
let { body: reloaded } = await api('GET', `/api/workouts/${w.id}`);
let cable = reloaded.exercises.find((e) => e.exercise_id === ex['Cable Lateral Raise']);
ok(cable?.routine_exercise_id === slot.id, 'slot survives the PUT round-trip');
ok(cable?.target?.rep_range_high === 15 && cable?.target?.notes === 'lead with the elbows', 'swapped-in exercise keeps the slot prescription after reload', JSON.stringify(cable?.target));
ok(cable?.target?.exercise_id === ex['Lateral Raise'], 'target still names the routine default, so the UI knows this is a swap');

// 3) Rows without a slot (added ad hoc) still fall back to matching by exercise.
const adhoc = await api('PUT', `/api/workouts/${w.id}`, {
  exercises: [...swapped, { exercise_id: ex['Lateral Raise'], routine_exercise_id: null, notes: null, sets: [{ set_number: 1 }] }],
});
ok(adhoc.status < 300, 'ad-hoc row accepted without a slot');
({ body: reloaded } = await api('GET', `/api/workouts/${w.id}`));
const adhocRow = reloaded.exercises.find((e) => e.exercise_id === ex['Lateral Raise']);
ok(adhocRow?.routine_exercise_id === null && adhocRow?.target?.id === slot.id, 'slot-less row still finds a target by exercise_id');
await api('PUT', `/api/workouts/${w.id}`, { exercises: swapped });

// 4) Guard rails before the real thing.
const wrongEx = await api('POST', `/api/workouts/${w.id}/default-exercise`, { routine_exercise_id: slot.id, exercise_id: ex['Squat'] });
ok(wrongEx.status === 404, `exercise not in that slot → 404 (${wrongEx.status})`);
const bad = await api('POST', `/api/workouts/${w.id}/default-exercise`, { routine_exercise_id: 'x' });
ok(bad.status === 400, `missing ids → 400 (${bad.status})`);

// 5) Promote. The routine flips, the old default becomes the first substitute, the
//    promoted exercise leaves the substitute list, nothing else in the slot changes.
const promote = await api('POST', `/api/workouts/${w.id}/default-exercise`, { routine_exercise_id: slot.id, exercise_id: ex['Cable Lateral Raise'] });
ok(promote.status === 200, `promote accepted (${promote.status})`, promote.raw);
ok(promote.body?.target?.exercise_id === ex['Cable Lateral Raise'], 'response target now names the new default');
ok(promote.body?.target?.rep_range_high === 15 && promote.body?.target?.notes === 'lead with the elbows', 'prescription untouched by the promotion');
const subNames = (promote.body?.target?.substitutes || []).map((s) => byId[s.exercise_id]);
ok(JSON.stringify(subNames) === JSON.stringify(['Lateral Raise', 'Bench Press']), 'old default leads the substitutes; new default removed from them', JSON.stringify(subNames));

({ body: active } = await api('GET', '/api/programs/active'));
const dayAAfter = active.routines.find((r) => r.name === 'Day A');
ok(dayAAfter.id === dayA.id, 'routine row edited in place, not retired');
const slotAfter = dayAAfter.exercises.find((e) => e.id === slot.id);
ok(slotAfter?.exercise_id === ex['Cable Lateral Raise'], 'Program page shows the new default');
ok(dayAAfter.exercises.length === 2 && dayAAfter.exercises[0].exercise_id === ex['Squat'], 'other slots untouched');

// 6) The next session from this routine prescribes the new default straight away.
await api('POST', `/api/workouts/${w.id}/complete`);
await api('POST', '/api/workouts/skip', { routine_id: active.routines.find((r) => r.name === 'Day B').id });
const { body: w2 } = await api('POST', '/api/workouts', { routine_id: dayA.id });
ok(w2.exercises.some((e) => e.exercise_id === ex['Cable Lateral Raise'] && e.routine_exercise_id === slot.id), 'next Day A starts on Cable Lateral Raise');
ok(!w2.exercises.some((e) => e.exercise_id === ex['Lateral Raise']), 'next Day A no longer starts on the old default');

// Idempotent: promoting what is already the default changes nothing.
const again = await api('POST', `/api/workouts/${w2.id}/default-exercise`, { routine_exercise_id: slot.id, exercise_id: ex['Cable Lateral Raise'] });
const subsAgain = (again.body?.target?.substitutes || []).map((s) => byId[s.exercise_id]);
ok(again.status === 200 && JSON.stringify(subsAgain) === JSON.stringify(['Lateral Raise', 'Bench Press']), 'promoting the current default is a no-op', JSON.stringify(subsAgain));

// 7) A slot from a retired routine (program edited since the workout started) is refused.
const edit = await api('PUT', `/api/programs/${prog.id}`, {
  name: 'Default Block',
  total_weeks: 2,
  routines: [
    { name: 'Day A', exercises: [{ exercise_id: ex['Squat'], target_sets: 3 }, { exercise_id: ex['Cable Lateral Raise'], target_sets: 3 }] },
    { name: 'Day B', exercises: [{ exercise_id: ex['Deadlift'], target_sets: 3 }] },
  ],
});
ok(edit.status < 300, `program edit accepted (${edit.status})`);
const stale = await api('POST', `/api/workouts/${w2.id}/default-exercise`, { routine_exercise_id: slot.id, exercise_id: ex['Cable Lateral Raise'] });
ok(stale.status === 409, `retired slot → 409 (${stale.status})`, stale.raw);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
