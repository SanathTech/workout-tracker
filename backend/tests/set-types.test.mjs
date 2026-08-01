// Set types. The load-bearing claim: a warm-up must not count anywhere that a working set
// does — volume, per-muscle sets, 1RM, personal bests, or progression.
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
  name: 'Set Types', total_weeks: 4,
  routines: [{ name: 'Day A', exercises: [{ exercise_id: ex['Squat'], target_sets: 4, rep_range_low: 5, rep_range_high: 8 }] }],
});
await api('POST', `/api/programs/${prog.id}/start`);
const routineId = prog.routines[0].id;

// Two warm-ups at a light load, then two working sets.
const { body: w } = await api('POST', '/api/workouts', { routine_id: routineId });
await api('PUT', `/api/workouts/${w.id}`, {
  exercises: [{
    exercise_id: ex['Squat'],
    sets: [
      { set_number: 1, reps: 5, weight_kg: 60, set_type: 'warmup' },
      { set_number: 2, reps: 3, weight_kg: 80, set_type: 'warmup' },
      { set_number: 3, reps: 8, weight_kg: 100, set_type: 'working' },
      { set_number: 4, reps: 8, weight_kg: 100, set_type: 'working' },
    ],
  }],
});
await api('POST', `/api/workouts/${w.id}/complete`);

console.log('\n─── the sets are all stored ───');
{
  const { body: fetched } = await api('GET', `/api/workouts/${w.id}`);
  const sets = fetched.exercises[0].sets;
  ok(sets.length === 4, 'all four sets persist', `got ${sets.length}`);
  ok(sets.filter((s) => s.set_type === 'warmup').length === 2, 'two are marked warmup');
  ok(sets.filter((s) => s.set_type === 'working').length === 2, 'two are working');
}

console.log('\n─── but warm-ups count nowhere ───');
{
  const { body: mv } = await api('GET', '/api/progress/muscle-volume?weeks=4');
  const quads = mv.summary.find((s) => s.muscle === 'quads').sets;
  ok(quads === 2, 'per-muscle volume counts 2 hard sets, not 4', `got ${quads}`);

  const { body: stats } = await api('GET', '/api/progress/stats');
  ok(stats.total_sets === 2, 'total sets excludes warm-ups', `got ${stats.total_sets}`);
  // 2 x 100kg x 8 = 1600. With warm-ups it would be 1600 + 300 + 240 = 2140.
  ok(Number(stats.total_volume_kg) === 1600, 'total volume excludes warm-up load', `got ${stats.total_volume_kg}`);

  const { body: vol } = await api('GET', '/api/progress/volume?weeks=4');
  ok(Number(vol[0].total_volume) === 1600, 'weekly volume chart agrees', `got ${vol[0]?.total_volume}`);

  const { body: pbs } = await api('GET', '/api/progress/personal-bests');
  const squat = pbs.find((p) => p.exercise_name === 'Squat');
  ok(Number(squat.best_weight) === 100, 'PB is the working set', `got ${squat.best_weight}`);

  const { body: orm } = await api('GET', `/api/progress/one-rm/${ex['Squat']}`);
  ok(orm.length === 1 && /100kg/.test(orm[0].from), '1RM comes from the working set', JSON.stringify(orm));
}

console.log('\n─── a heavy warm-up single cannot become a PR ───');
{
  const { body: w2 } = await api('POST', '/api/workouts', { routine_id: routineId });
  await api('PUT', `/api/workouts/${w2.id}`, {
    exercises: [{
      exercise_id: ex['Squat'],
      sets: [
        { set_number: 1, reps: 1, weight_kg: 140, set_type: 'warmup' },
        { set_number: 2, reps: 8, weight_kg: 100, set_type: 'working' },
      ],
    }],
  });
  await api('POST', `/api/workouts/${w2.id}/complete`);
  const { body: pbs } = await api('GET', '/api/progress/personal-bests');
  const squat = pbs.find((p) => p.exercise_name === 'Squat');
  ok(Number(squat.best_weight) === 100, '140kg warm-up single is not the PB', `got ${squat.best_weight}`);
}

console.log('\n─── progression ignores warm-ups ───');
{
  // Working sets were 8/8 at the top of 5–8, so this must read as "increase" — a naive
  // implementation would see the 1-rep warm-up and hold.
  const { body: s } = await api('GET', '/api/progress/suggestions');
  const squat = s.find((x) => x.exercise_name === 'Squat');
  ok(squat.action === 'increase', 'all WORKING sets at the top → increase', `${squat.action}: ${squat.reason}`);
  ok(squat.last_sets.length === 1, 'only the working set is considered', JSON.stringify(squat.last_sets));
}

console.log('\n─── drop and failure sets still count ───');
{
  const { body: w3 } = await api('POST', '/api/workouts', { routine_id: routineId });
  await api('PUT', `/api/workouts/${w3.id}`, {
    exercises: [{
      exercise_id: ex['Squat'],
      sets: [
        { set_number: 1, reps: 8, weight_kg: 100, set_type: 'working' },
        { set_number: 2, reps: 6, weight_kg: 80, set_type: 'drop' },
        { set_number: 3, reps: 4, weight_kg: 60, set_type: 'failure' },
      ],
    }],
  });
  await api('POST', `/api/workouts/${w3.id}/complete`);
  const { body: mv } = await api('GET', '/api/progress/muscle-volume?weeks=4');
  const quads = mv.summary.find((s) => s.muscle === 'quads').sets;
  // 2 (first session) + 1 (second) + 3 (this one) = 6
  ok(quads === 6, 'drop and failure count as hard sets', `got ${quads}`);
}

console.log('\n─── an unknown type is stored as working, not dropped ───');
{
  const { body: w4 } = await api('POST', '/api/workouts', { routine_id: routineId });
  await api('PUT', `/api/workouts/${w4.id}`, {
    exercises: [{
      exercise_id: ex['Squat'],
      sets: [{ set_number: 1, reps: 5, weight_kg: 90, set_type: 'nonsense' }],
    }],
  });
  const { body: fetched } = await api('GET', `/api/workouts/${w4.id}`);
  ok(fetched.exercises[0].sets[0].set_type === 'working', 'a bad type falls back to working', fetched.exercises[0].sets[0].set_type);
}

console.log('\n─── sets default to working when the field is absent ───');
{
  const { body: w5 } = await api('POST', '/api/workouts', { routine_id: routineId });
  await api('PUT', `/api/workouts/${w5.id}`, {
    exercises: [{ exercise_id: ex['Squat'], sets: [{ set_number: 1, reps: 5, weight_kg: 90 }] }],
  });
  const { body: fetched } = await api('GET', `/api/workouts/${w5.id}`);
  ok(fetched.exercises[0].sets[0].set_type === 'working', 'omitted set_type defaults to working');
}

console.log('\n─────────────────────────────');
console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
