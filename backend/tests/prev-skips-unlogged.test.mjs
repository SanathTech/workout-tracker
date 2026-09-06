// PREV column source: a completed session that carried the exercise but logged no sets
// (finished early, skipped it) must not shadow the last session that actually has numbers.
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

console.log('\n─── last-by-exercise skips set-less sessions ───');

const { body: exercises } = await api('GET', '/api/exercises');
const ex = Object.fromEntries(exercises.map((e) => [e.name, e.id]));
const curl = ex['Lateral Raise'];
ok(!!curl, 'seed exercise present');

// Session 1: logged. Session 2 (newer): the exercise is on the sheet, nothing entered.
const { body: w1 } = await api('POST', '/api/workouts', { date: '2026-08-24', exercises: [] });
await api('PUT', `/api/workouts/${w1.id}`, {
  exercises: [{ exercise_id: curl, notes: null, sets: [
    { set_number: 1, weight_kg: 10, reps: 12, rir: 1, set_type: 'working' },
    { set_number: 2, weight_kg: 10, reps: 11, rir: 1, set_type: 'working' },
  ] }],
});
await api('POST', `/api/workouts/${w1.id}/complete`);

const { body: w2 } = await api('POST', '/api/workouts', { date: '2026-08-31', exercises: [] });
await api('PUT', `/api/workouts/${w2.id}`, { exercises: [{ exercise_id: curl, notes: null, sets: [] }] });
const done2 = await api('POST', `/api/workouts/${w2.id}/complete`);
ok(done2.status < 300, `set-less session completed (${done2.status})`, done2.raw);

const { body: w3 } = await api('POST', '/api/workouts', { date: '2026-09-07', exercises: [] });
const { body: prev } = await api('GET', `/api/workouts/last-by-exercise/${curl}?exclude=${w3.id}`);
ok(prev !== null, 'a previous session is returned');
ok(prev?.sets?.length === 2, 'it is the one with numbers, not the empty newer one', JSON.stringify(prev));
ok(String(prev?.date).startsWith('2026-08-24'), 'dated from the logged session', String(prev?.date));

// The exclude guard still applies alongside the new filter.
const { body: self } = await api('GET', `/api/workouts/last-by-exercise/${curl}?exclude=${w1.id}`);
ok(self === null, 'nothing left once the only logged session is excluded', JSON.stringify(self));

console.log('\n─────────────────────────────');
console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
