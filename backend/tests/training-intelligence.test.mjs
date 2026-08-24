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

// A session that ramps within the exercise. The working weight is the top set, but the
// rep target has to come from the sets done AT that weight — pairing the heaviest load
// with the first row's rep count ghosted "50kg x 12" for a lift he had only taken to 8.
console.log('\n─── a ramped session targets reps at the working weight ───');
{
  await logSession({
    squat: [{ reps: 8, weight_kg: 95 }, { reps: 5, weight_kg: 105 }],
    lateral: [], daysAgo: 0,
  });
  const { body: s } = await api('GET', '/api/progress/suggestions');
  const squat = s.find((x) => x.exercise_name === 'Squat');
  ok(squat.action === 'hold', 'the top set is short of 8 → hold', `${squat.action}: ${squat.reason}`);
  ok(squat.suggested_weight_kg === 105, 'working weight is the top set', `got ${squat.suggested_weight_kg}`);
  ok(squat.suggested_reps_next === 6,
    'next target is 5+1 at 105kg, not 8+1 from the 95kg set', `got ${squat.suggested_reps_next}`);
  ok(/up to 105kg for 5/.test(squat.reason),
    'reason names what was done at the working weight, not "stay at 105kg"', squat.reason);
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

// The same exercise can be prescribed a different rep range on different days, and the
// suggestion engine used to be blind to that: one DISTINCT ON per exercise picked
// whichever routine row had the lower id, and the history came from the most recent
// session in ANY routine. On 2026-08-20 that told him to do 9 reps of an exercise whose
// range in that routine tops out at 8 — he followed it, because the app is the
// prescription. Range and history are both scoped to the routine now.
//
// Runs last: starting a program archives the active one, so anything after this would
// be graded against the wrong block.
console.log('\n─── suggestions are scoped to the routine ───');
{
  const { body: two } = await api('POST', '/api/programs', {
    name: 'Two-routine ranges',
    total_weeks: 4,
    routines: [
      { name: 'Heavy Day', exercises: [{ exercise_id: ex['Squat'], target_sets: 3, rep_range_low: 5, rep_range_high: 8 }] },
      { name: 'Volume Day', exercises: [{ exercise_id: ex['Squat'], target_sets: 3, rep_range_low: 5, rep_range_high: 12 }] },
    ],
  });
  await api('POST', `/api/programs/${two.id}/start`);
  const heavy = two.routines.find((r) => r.name === 'Heavy Day');
  const volume = two.routines.find((r) => r.name === 'Volume Day');

  const log = async (routine, reps, daysAgo) => {
    const { body: w } = await api('POST', '/api/workouts', { routine_id: routine.id });
    await api('PUT', `/api/workouts/${w.id}`, {
      exercises: [{ exercise_id: ex['Squat'], sets: reps.map((r, i) => ({ set_number: i + 1, reps: r, weight_kg: 100 })) }],
    });
    await api('POST', `/api/workouts/${w.id}/complete`);
    if (daysAgo) {
      await db.query(
        `UPDATE workouts SET date = CURRENT_DATE - $1::int, created_at = NOW() - ($1 || ' days')::interval WHERE id = $2`,
        [daysAgo, w.id]
      );
    }
  };

  // Heavy Day is older, so the unscoped query would grade it on Volume Day's session —
  // where 10 reps clears Heavy Day's ceiling of 8 and reads as "add load".
  await log(heavy, [6, 6, 6], 3);
  await log(volume, [10, 10, 10], 0);

  const { body: h } = await api('GET', `/api/progress/suggestions?routine_id=${heavy.id}`);
  const hs = h.find((x) => x.exercise_name === 'Squat');
  ok(hs.rep_range_high === 8, "the routine's own rep range is used", `got ${hs.rep_range_high}`);
  ok(hs.last_same_routine === true, 'history comes from the same routine', JSON.stringify(hs.last_routine_name));
  ok(hs.action === 'hold', '6/6/6 against 5-8 holds — not graded on the other routine', `${hs.action}: ${hs.reason}`);
  ok(hs.suggested_weight_kg === 100, 'holds the working weight', `got ${hs.suggested_weight_kg}`);

  const { body: v } = await api('GET', `/api/progress/suggestions?routine_id=${volume.id}`);
  const vs = v.find((x) => x.exercise_name === 'Squat');
  ok(vs.rep_range_high === 12, 'the other routine keeps its own range', `got ${vs.rep_range_high}`);
  ok(vs.action === 'hold', '10/10/10 against 5-12 holds', `${vs.action}: ${vs.reason}`);
  ok(/below 12 reps/.test(vs.reason), 'the reason quotes that routine\'s ceiling', vs.reason);

  // An exercise a routine does not prescribe still gets its known working weight, but
  // the caller is told the comparison crosses routines rather than being handed it
  // silently as like-for-like.
  const noRoutine = await api('GET', '/api/progress/suggestions');
  ok(Array.isArray(noRoutine.body), 'a call without a routine still returns');
}

// Rest-aware progression. On a short-on-time day the plan is: cut rest, hold the
// weight, let the reps fall. The engine has to know that, or every compressed office
// Thursday reads as a plateau and a weight full-rest days already cleared is held
// forever. Sets carry logged_at, so a session's median inter-set gap is comparable to
// the routine's prescribed rest floor.
console.log('\n─── short rest is not a plateau ───');
{
  const { body: prog } = await api('POST', '/api/programs', {
    name: 'Rest Aware', total_weeks: 4,
    routines: [{
      name: 'Day X',
      exercises: [{ exercise_id: ex['Squat'], target_sets: 3, rep_range_low: 5, rep_range_high: 8, rest_seconds: 180, rest_seconds_high: 300 }],
    }],
  });
  await api('POST', `/api/programs/${prog.id}/start`);
  const routineId = prog.routines[0].id;

  // gapSeconds spaces logged_at stamps; null leaves sets unstamped (pre-stamp history).
  const log = async (reps, weight, daysAgo, gapSeconds) => {
    const { body: w } = await api('POST', '/api/workouts', { routine_id: routineId });
    const t0 = Date.now() - daysAgo * 86400_000;
    await api('PUT', `/api/workouts/${w.id}`, {
      exercises: [{
        exercise_id: ex['Squat'],
        sets: reps.map((r, i) => ({
          set_number: i + 1, reps: r, weight_kg: weight,
          ...(gapSeconds != null ? { logged_at: new Date(t0 + i * gapSeconds * 1000).toISOString() } : {}),
        })),
      }],
    });
    await api('POST', `/api/workouts/${w.id}/complete`);
    if (daysAgo) {
      await db.query(
        `UPDATE workouts SET date = CURRENT_DATE - $1::int, created_at = NOW() - ($1 || ' days')::interval WHERE id = $2`,
        [daysAgo, w.id]
      );
    }
    return w.id;
  };
  const squat = async () => {
    const { body } = await api('GET', `/api/progress/suggestions?routine_id=${routineId}`);
    return body.find((x) => x.exercise_name === 'Squat');
  };

  // Full rest (200s gaps > 180 floor), range cleared at 100kg.
  await log([8, 8, 8], 100, 3, 200);
  // Then a compressed session (70s gaps): same weight, reps fell — the plan working.
  await log([6, 6, 6], 100, 0, 70);
  {
    const s = await squat();
    ok(s.action === 'increase', 'a compressed shortfall does not cancel a full-rest clear', `${s.action}: ${s.reason}`);
    ok(s.suggested_weight_kg === 102.5, 'the increase the full-rest session earned', `got ${s.suggested_weight_kg}`);
    ok(/short-rest/.test(s.reason), 'the reason says why the last session did not count', s.reason);
  }

  // He takes the increase on another short day: 102.5 has no normal-rest history, so
  // there is nothing to judge against — hold, but named as short-rest, not a stall.
  await log([5, 5, 5], 102.5, 0, 70);
  {
    const s = await squat();
    ok(s.action === 'hold', 'no normal-rest baseline at the new weight → hold', `${s.action}: ${s.reason}`);
    ok(s.suggested_reps_next === 6, 'aims one over the compressed worst', `got ${s.suggested_reps_next}`);
    ok(/short-rest.*not a stall/.test(s.reason), 'and says the reps read low', s.reason);
  }

  // A normal-rest shortfall stays an honest hold — no excuse appended.
  await log([7, 7, 6], 102.5, 0, 200);
  {
    const s = await squat();
    ok(s.action === 'hold', 'full-rest shortfall holds', `${s.action}: ${s.reason}`);
    ok(!/short-rest/.test(s.reason), 'with no short-rest caveat', s.reason);
  }

  // Unstamped history (every set before 2026-08-24) has unknown rest, which must never
  // be read as compressed: the verdict comes from the session itself, as it always did.
  await log([8, 8, 8], 102.5, 0, null);
  {
    const s = await squat();
    ok(s.action === 'increase', 'an unstamped clear still progresses', `${s.action}: ${s.reason}`);
    ok(s.suggested_weight_kg === 105, 'to the next step', `got ${s.suggested_weight_kg}`);
  }
}

console.log('\n─────────────────────────────');
console.log(`  ${pass} passed, ${fail} failed`);
await db.end();
process.exit(fail ? 1 : 0);
