// Phase 3: per-muscle volume, double progression, 1RM, bodyweight.
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

const { body: exercises } = await api('GET', '/api/exercises');
const ex = Object.fromEntries(exercises.map((e) => [e.name, e.id]));

// A block with a squat (quads primary; glutes/adductors/lower_back assisting) and a
// lateral raise (side delts only) — enough to prove fractional crediting.
const { body: prog } = await api('POST', '/api/programs', {
  name: 'Phase 3 Block',
  total_weeks: 8,
  routines: [{
    name: 'Day A',
    exercises: [
      { exercise_id: ex['Squat'], target_sets: 3, rep_range_low: 5, rep_range_high: 8 },
      { exercise_id: ex['Lateral Raise'], target_sets: 3, rep_range_low: 10, rep_range_high: 15 },
    ],
  }],
});
await api('POST', `/api/programs/${prog.id}/start`);
const routineId = prog.routines[0].id;

// Log a session with given reps/weights, then backdate it so weeks separate.
async function logSession({ squat, lateral, daysAgo }) {
  const { body: w } = await api('POST', '/api/workouts', { routine_id: routineId });
  await api('PUT', `/api/workouts/${w.id}`, {
    exercises: [
      { exercise_id: ex['Squat'], sets: squat.map((s, i) => ({ set_number: i + 1, ...s })) },
      { exercise_id: ex['Lateral Raise'], sets: lateral.map((s, i) => ({ set_number: i + 1, ...s })) },
    ],
  });
  await api('POST', `/api/workouts/${w.id}/complete`);
  if (daysAgo) {
    await db.query(
      `UPDATE workouts SET date = CURRENT_DATE - $1::int, created_at = NOW() - ($1 || ' days')::interval WHERE id = $2`,
      [daysAgo, w.id]
    );
  }
  return w.id;
}

console.log('\n─── per-muscle volume, with fractional credit ───');
// 3 squat sets + 3 lateral sets, this week.
await logSession({
  squat: [{ reps: 5, weight_kg: 100 }, { reps: 5, weight_kg: 100 }, { reps: 5, weight_kg: 100 }],
  lateral: [{ reps: 12, weight_kg: 10 }, { reps: 12, weight_kg: 10 }, { reps: 12, weight_kg: 10 }],
  daysAgo: 0,
});
{
  const { body: mv } = await api('GET', '/api/progress/muscle-volume?weeks=4');
  const byMuscle = Object.fromEntries(mv.summary.map((s) => [s.muscle, s.sets]));
  ok(byMuscle.quads === 3, 'quads = 3 (squat primary, full credit)', `got ${byMuscle.quads}`);
  ok(byMuscle.side_delts === 3, 'side delts = 3 (lateral raise)', `got ${byMuscle.side_delts}`);
  ok(byMuscle.glutes === 1.5, 'glutes = 1.5 (assisting, half credit)', `got ${byMuscle.glutes}`);
  ok(byMuscle.adductors === 1.5, 'adductors = 1.5 (assisting)', `got ${byMuscle.adductors}`);
  ok(byMuscle.chest === 0, 'chest = 0 (untrained muscles still reported)', `got ${byMuscle.chest}`);
  const quads = mv.summary.find((s) => s.muscle === 'quads');
  ok(quads.status === 'below_mev', '3 quad sets flagged below MEV', quads.status);
  ok(quads.mev === 8 && quads.mrv === 20, 'landmarks returned with the counts');
}

console.log('\n─── sets with no reps are not hard sets ───');
{
  const { body: w } = await api('POST', '/api/workouts', { routine_id: routineId });
  await api('PUT', `/api/workouts/${w.id}`, {
    exercises: [{ exercise_id: ex['Squat'], sets: [{ set_number: 1, reps: null, weight_kg: 100 }] }],
  });
  await api('POST', `/api/workouts/${w.id}/complete`);
  const { body: mv } = await api('GET', '/api/progress/muscle-volume?weeks=4');
  const quads = mv.summary.find((s) => s.muscle === 'quads').sets;
  ok(quads === 3, 'a weight-only set with no reps does not count', `got ${quads}`);
  await api('DELETE', `/api/workouts/${w.id}`);
}

console.log('\n─── double progression ───');
{
  const { body: s } = await api('GET', '/api/progress/suggestions');
  const squat = s.find((x) => x.exercise_name === 'Squat');
  ok(squat.action === 'hold', 'all sets at 5 of 5–8 → hold', `${squat.action}: ${squat.reason}`);
  ok(squat.suggested_weight_kg === 100, 'holds at 100kg', `got ${squat.suggested_weight_kg}`);
  ok(/add reps/i.test(squat.reason), 'reason says add reps', squat.reason);
}

// Now hit the top of the range on every set.
await logSession({
  squat: [{ reps: 8, weight_kg: 100 }, { reps: 8, weight_kg: 100 }, { reps: 8, weight_kg: 100 }],
  lateral: [{ reps: 15, weight_kg: 10 }, { reps: 15, weight_kg: 10 }, { reps: 12, weight_kg: 10 }],
  daysAgo: 0,
});
{
  const { body: s } = await api('GET', '/api/progress/suggestions');
  const squat = s.find((x) => x.exercise_name === 'Squat');
  ok(squat.action === 'increase', '8/8/8 at top of 5–8 → increase', `${squat.action}: ${squat.reason}`);
  ok(squat.suggested_weight_kg === 102.5, 'compound gets a 2.5kg step', `got ${squat.suggested_weight_kg}`);
  ok(squat.suggested_reps_low === 5, 'drops back to the bottom of the range', `got ${squat.suggested_reps_low}`);

  const lat = s.find((x) => x.exercise_name === 'Lateral Raise');
  ok(lat.action === 'hold', 'one set short of 15 → hold', `${lat.action}: ${lat.reason}`);
  ok(/1 of 3 sets below 15/.test(lat.reason), 'reason counts the short sets', lat.reason);
}

console.log('\n─── isolation gets a smaller jump ───');
{
  await logSession({
    squat: [{ reps: 8, weight_kg: 102.5 }],
    lateral: [{ reps: 15, weight_kg: 10 }, { reps: 15, weight_kg: 10 }, { reps: 15, weight_kg: 10 }],
    daysAgo: 0,
  });
  const { body: s } = await api('GET', '/api/progress/suggestions');
  const lat = s.find((x) => x.exercise_name === 'Lateral Raise');
  ok(lat.action === 'increase', 'all sets at 15 → increase', lat.reason);
  ok(lat.suggested_weight_kg === 11.25, 'isolation gets 1.25kg, not 2.5kg', `got ${lat.suggested_weight_kg}`);
}

console.log('\n─── estimated 1RM ───');
{
  const { body: orm } = await api('GET', `/api/progress/one-rm/${ex['Squat']}`);
  ok(orm.length > 0, 'returns a series');
  const best = orm[orm.length - 1];
  // Epley: 102.5 × (1 + 8/30) = 129.83
  ok(Math.abs(best.estimated_1rm - 129.8) < 0.2, 'Epley on 102.5×8 ≈ 129.8', `got ${best.estimated_1rm}`);
  ok(/102.5kg × 8/.test(best.from), 'reports the set it came from', best.from);
}

console.log('\n─── 1RM refuses to guess above 12 reps ───');
{
  const { body: w } = await api('POST', '/api/workouts', { routine_id: routineId });
  await api('PUT', `/api/workouts/${w.id}`, {
    exercises: [{ exercise_id: ex['Leg Extension'], sets: [{ set_number: 1, reps: 25, weight_kg: 40 }] }],
  });
  await api('POST', `/api/workouts/${w.id}/complete`);
  const { body: orm } = await api('GET', `/api/progress/one-rm/${ex['Leg Extension']}`);
  ok(orm.length === 0, '25-rep set produces no estimate rather than a bad one', JSON.stringify(orm));
}

console.log('\n─── bodyweight ───');
{
  const a = await api('POST', '/api/progress/bodyweight', { weight_kg: 82.4 });
  ok(a.status === 201, 'logs a weigh-in', `got ${a.status}`);
  const dup = await api('POST', '/api/progress/bodyweight', { weight_kg: 82.9 });
  ok(dup.status === 201, 'same-day re-log accepted');
  const { body: list } = await api('GET', '/api/progress/bodyweight');
  ok(list.length === 1, 'one entry per day, not two', `got ${list.length}`);
  ok(list[0].weight_kg === 82.9, 'the later value wins', `got ${list[0].weight_kg}`);
  const bad = await api('POST', '/api/progress/bodyweight', { weight_kg: 'heavy' });
  ok(bad.status === 400, 'rejects a non-numeric weight', `got ${bad.status}`);
  const neg = await api('POST', '/api/progress/bodyweight', { weight_kg: -5 });
  ok(neg.status === 400, 'rejects a negative weight', `got ${neg.status}`);
  const del = await api('DELETE', `/api/progress/bodyweight/${list[0].id}`);
  ok(del.status === 200, 'deletes an entry');
  const { body: after } = await api('GET', '/api/progress/bodyweight');
  ok(after.length === 0, 'entry is gone');
}

console.log('\n─── weekly series buckets by week ───');
{
  await logSession({
    squat: [{ reps: 6, weight_kg: 95 }, { reps: 6, weight_kg: 95 }],
    lateral: [], daysAgo: 21,
  });
  const { body: mv } = await api('GET', '/api/progress/muscle-volume?weeks=8');
  ok(mv.series.length >= 2, 'sessions three weeks apart land in different weeks', `got ${mv.series.length}`);
  const total = mv.series.reduce((n, wk) => n + wk.quads, 0);
  ok(total > mv.series[mv.series.length - 1].quads, 'history is kept separate from the current week');
}

console.log('\n─────────────────────────────');
console.log(`  ${pass} passed, ${fail} failed`);
await db.end();
process.exit(fail ? 1 : 0);
