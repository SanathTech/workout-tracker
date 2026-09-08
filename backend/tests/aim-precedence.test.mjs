// /progress/suggestions hands out ONE aim per exercise (2026-09-08): a coach note that
// carries a load call wins over the engine; notes without numbers ride along as cues;
// internal memos and other-routine notes never reach the phone.
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

const { body: prog } = await api('POST', '/api/programs', {
  name: 'Aim Block',
  total_weeks: 8,
  routines: [
    {
      name: 'Day A',
      exercises: [
        { exercise_id: ex['Squat'], target_sets: 3, rep_range_low: 5, rep_range_high: 8, target_rir_per_set: [2, 2, 1] },
        { exercise_id: ex['Lateral Raise'], target_sets: 3, rep_range_low: 10, rep_range_high: 15 },
      ],
    },
    { name: 'Day B', exercises: [{ exercise_id: ex['Squat'], target_sets: 3, rep_range_low: 5, rep_range_high: 8 }] },
  ],
});
await api('POST', `/api/programs/${prog.id}/start`);
const dayA = prog.routines[0].id;
const dayB = prog.routines[1].id;

// One session at 100kg × 5/5/5 → the engine says hold and add reps.
{
  const { body: w } = await api('POST', '/api/workouts', { routine_id: dayA });
  await api('PUT', `/api/workouts/${w.id}`, {
    exercises: [
      { exercise_id: ex['Squat'], sets: [1, 2, 3].map((n) => ({ set_number: n, reps: 5, weight_kg: 100 })) },
      { exercise_id: ex['Lateral Raise'], sets: [1, 2, 3].map((n) => ({ set_number: n, reps: 12, weight_kg: 10 })) },
    ],
  });
  await api('POST', `/api/workouts/${w.id}/complete`);
}

const suggestions = async () => (await api('GET', `/api/progress/suggestions?routine_id=${dayA}`)).body;
const note = (fields) => db.query(
  `INSERT INTO coach_notes (exercise_id, routine_id, note, aim_weight_kg, aim_reps, aim_rir, internal)
   VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
  [fields.exercise_id, fields.routine_id ?? null, fields.note, fields.aim_weight_kg ?? null,
   fields.aim_reps ?? null, fields.aim_rir ?? null, fields.internal ?? false]
).then((r) => r.rows[0].id);

console.log('\n─── no notes: the engine is the aim ───');
{
  const squat = (await suggestions()).find((x) => x.exercise_name === 'Squat');
  ok(squat.aim?.source === 'engine', 'aim comes from the engine', JSON.stringify(squat.aim));
  ok(squat.aim?.weight_kg === 100, 'engine holds at 100kg', `got ${squat.aim?.weight_kg}`);
  ok(squat.aim?.reps === 6, 'hold → next rep target 6', `got ${squat.aim?.reps}`);
  ok(squat.aim?.rir === 2, "RIR falls back to the routine's first target", `got ${squat.aim?.rir}`);
  ok(squat.aim?.action === 'hold', 'engine action rides along', squat.aim?.action);
  ok(Array.isArray(squat.cues) && squat.cues.length === 0, 'no cues');
}

console.log('\n─── a note without numbers is a cue, not an aim ───');
const cueId = await note({ exercise_id: ex['Squat'], note: 'Brace before you unrack.' });
{
  const squat = (await suggestions()).find((x) => x.exercise_name === 'Squat');
  ok(squat.aim?.source === 'engine', 'engine still the aim', squat.aim?.source);
  ok(squat.cues.length === 1 && squat.cues[0].id === cueId, 'the note is a cue', JSON.stringify(squat.cues));
}

console.log('\n─── a note with a load call IS the aim ───');
const callId = await note({ exercise_id: ex['Squat'], note: 'Back off to 95 and own the depth.', aim_weight_kg: 95, aim_rir: 1 });
{
  const squat = (await suggestions()).find((x) => x.exercise_name === 'Squat');
  ok(squat.aim?.source === 'coach', 'coach note wins', squat.aim?.source);
  ok(squat.aim?.note_id === callId, 'points at the note', `got ${squat.aim?.note_id}`);
  ok(squat.aim?.weight_kg === 95, 'coach weight replaces the engine number', `got ${squat.aim?.weight_kg}`);
  ok(squat.aim?.rir === 1, 'coach RIR replaces the routine target', `got ${squat.aim?.rir}`);
  ok(squat.aim?.reps === null, 'different load → engine reps are not borrowed', `got ${squat.aim?.reps}`);
  ok(squat.aim?.why === 'Back off to 95 and own the depth.', 'why = the note');
  ok(typeof squat.aim?.engine_reason === 'string' && squat.aim.engine_reason.length > 0, 'engine reason kept for the why-sheet');
  ok(squat.cues.length === 1 && squat.cues[0].id === cueId, 'the cue still rides under the coach aim', JSON.stringify(squat.cues));
  ok(squat.suggested_weight_kg === 100, 'the raw engine verdict is untouched', `got ${squat.suggested_weight_kg}`);
}

console.log('\n─── same load borrows engine reps; newest call wins ───');
const newerId = await note({ exercise_id: ex['Squat'], note: 'Stay at 100, RIR 1 on the last set.', aim_weight_kg: 100, aim_rir: 1 });
{
  const squat = (await suggestions()).find((x) => x.exercise_name === 'Squat');
  ok(squat.aim?.note_id === newerId, 'the newest aim-carrying note is the aim', `got ${squat.aim?.note_id}`);
  ok(squat.aim?.reps === 6, 'same load → engine rep target borrowed', `got ${squat.aim?.reps}`);
  ok(squat.cues.length === 1 && squat.cues[0].id === cueId, 'the older call is not demoted to a cue', JSON.stringify(squat.cues));
}

console.log('\n─── a call without a weight keeps the engine load ───');
{
  await db.query('UPDATE coach_notes SET resolved_at = NOW() WHERE id = ANY($1)', [[callId, newerId]]);
  const rirOnly = await note({ exercise_id: ex['Squat'], note: 'Last set to RIR 0.', aim_rir: 0 });
  const squat = (await suggestions()).find((x) => x.exercise_name === 'Squat');
  ok(squat.aim?.source === 'coach' && squat.aim?.note_id === rirOnly, 'the RIR-only call is the aim', JSON.stringify(squat.aim));
  ok(squat.aim?.weight_kg === 100, 'engine weight is kept when the coach does not name one', `got ${squat.aim?.weight_kg}`);
  ok(squat.aim?.reps === 6, 'same load → engine reps borrowed', `got ${squat.aim?.reps}`);
  ok(squat.aim?.rir === 0, 'coach RIR applies', `got ${squat.aim?.rir}`);
  await db.query('UPDATE coach_notes SET resolved_at = NULL WHERE id = ANY($1)', [[callId, newerId]]);
  await db.query('UPDATE coach_notes SET resolved_at = NOW() WHERE id = $1', [rirOnly]);
}

console.log('\n─── scope: internal memos and other-routine notes never show ───');
await note({ exercise_id: ex['Squat'], note: 'Do not prescribe above 100 this block.', aim_weight_kg: 60, internal: true });
await note({ exercise_id: ex['Squat'], routine_id: dayB, note: 'Day B squats are light.', aim_weight_kg: 70 });
await note({ exercise_id: ex['Lateral Raise'], routine_id: dayA, note: 'Slow eccentric.' });
{
  const s = await suggestions();
  const squat = s.find((x) => x.exercise_name === 'Squat');
  ok(squat.aim?.note_id === newerId, 'internal + other-routine calls are ignored', `got ${squat.aim?.note_id}`);
  const lat = s.find((x) => x.exercise_name === 'Lateral Raise');
  ok(lat.cues.length === 1, 'a note scoped to this routine shows', JSON.stringify(lat.cues));
  const { body: notes } = await api('GET', '/api/coach/notes');
  ok(!notes.some((n) => n.internal || /Do not prescribe/.test(n.note)), '/coach/notes hides internal memos');
  ok(notes.some((n) => n.id === callId && n.aim_weight_kg === 95), '/coach/notes exposes the aim columns');
  ok(notes.find((n) => n.id === callId)?.exercise_name === 'Squat', '/coach/notes joins the exercise name');
}

console.log('\n─── resolving the call hands the aim back to the engine ───');
{
  await db.query('UPDATE coach_notes SET resolved_at = NOW() WHERE id = ANY($1)', [[callId, newerId]]);
  const squat = (await suggestions()).find((x) => x.exercise_name === 'Squat');
  ok(squat.aim?.source === 'engine', 'resolved calls no longer apply', squat.aim?.source);
}

await db.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
