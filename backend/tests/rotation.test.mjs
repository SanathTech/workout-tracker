// Next up is the routine done longest ago (2026-11-03), replacing the weekday schedule:
// any routine can be done on any day, and nothing is ever banked as missed.
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

const melToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const daysAgo = (n) => {
  const [y, m, d] = melToday.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
};

const { body: exercises } = await api('GET', '/api/exercises');
const ex = Object.fromEntries(exercises.map((e) => [e.name, e.id]));
const routine = (name, exId) => ({ name, exercises: [{ exercise_id: exId, target_sets: 2 }] });
const ROUTINES = [routine('Hinge', ex['Deadlift']), routine('Squat', ex['Squat']), routine('Upper', ex['Bench Press'])];

const { body: prog } = await api('POST', '/api/programs', { name: 'Rotation', total_weeks: null, routines: ROUTINES });
await api('POST', `/api/programs/${prog.id}/start`);
const active = async () => (await api('GET', '/api/programs/active')).body;
const byName = (p) => Object.fromEntries(p.routines.map((r) => [r.name, r]));
async function doneOn(name, date) {
  const r = byName(await active())[name];
  const { body: w } = await api('POST', '/api/workouts', { routine_id: r.id, date });
  await api('POST', `/api/workouts/${w.id}/complete`);
  return w;
}

console.log('\n─── never-done routines come first, in program order ───');
{
  const p = await active();
  ok(p.progress.next_routine?.name === 'Hinge', 'a fresh program offers its first routine', p.progress.next_routine?.name);
  ok(p.routines.every((r) => r.last_done === null && r.in_progress === false), 'every routine reports never done');
}

console.log('\n─── picked out of order, the offer follows what was actually done ───');
{
  await doneOn('Upper', daysAgo(5));
  let p = await active();
  ok(p.progress.next_routine?.name === 'Hinge', 'Upper done first: Hinge (never done) still up', p.progress.next_routine?.name);
  ok(byName(p).Upper.last_done === daysAgo(5), 'Upper carries its last-done date', byName(p).Upper.last_done);

  await doneOn('Hinge', daysAgo(3));
  await doneOn('Squat', daysAgo(1));
  p = await active();
  ok(p.progress.next_routine?.name === 'Upper', 'all done: the oldest (Upper, 5 days) is next', p.progress.next_routine?.name);
}

console.log('\n─── a skip is not a session ───');
{
  const p = await active();
  await api('POST', '/api/workouts/skip', { routine_id: byName(p).Upper.id });
  const after = await active();
  ok(after.progress.next_routine?.name === 'Upper', 'skipping Upper leaves it up next', after.progress.next_routine?.name);
  ok(byName(after).Upper.last_done === daysAgo(5), 'and its last-done date unchanged');
}

console.log('\n─── an open session is today\'s, so it is not offered again ───');
{
  const p = await active();
  const { body: w } = await api('POST', '/api/workouts', { routine_id: byName(p).Upper.id, date: melToday });
  const open = await active();
  ok(byName(open).Upper.in_progress === true, 'Upper reports in progress');
  ok(open.progress.next_routine?.name === 'Hinge', 'next is Hinge (3 days), not the open Upper', open.progress.next_routine?.name);
  await api('POST', `/api/workouts/${w.id}/complete`);
}

console.log('\n─── an edit re-inserts routines; history follows by name ───');
{
  await api('PUT', `/api/programs/${prog.id}`, { name: 'Rotation', total_weeks: null, routines: ROUTINES });
  const p = await active();
  ok(byName(p).Hinge.last_done === daysAgo(3), 'Hinge keeps its last-done date under its new id', byName(p).Hinge.last_done);
  ok(p.progress.next_routine?.name === 'Hinge', 'and is still up next', p.progress.next_routine?.name);
}

console.log('\n─── nothing is ever auto-skipped ───');
{
  const { body: history } = await api('GET', '/api/workouts?limit=50');
  const rows = Array.isArray(history) ? history : history?.workouts || [];
  ok(rows.length === 5, 'history holds exactly the 4 sessions and 1 manual skip', `got ${rows.length}`);
  ok(!rows.some((w) => /skipped automatically/.test(w.notes || '')), 'no auto-skip rows after gaps of days');
}

console.log('\n─── another program\'s same-named routine doesn\'t count ───');
{
  const { body: other } = await api('POST', '/api/programs', { name: 'Old block', total_weeks: null, routines: [routine('Hinge', ex['Deadlift'])] });
  const { body: w } = await api('POST', '/api/workouts', { routine_id: other.routines[0].id, date: melToday });
  await api('POST', `/api/workouts/${w.id}/complete`);
  const p = await active();
  ok(p.id === prog.id, 'the rotation program is still the active one');
  ok(byName(p).Hinge.last_done === daysAgo(3), 'Hinge keeps its own last-done date', byName(p).Hinge.last_done);
  ok(p.progress.next_routine?.name === 'Hinge', 'and is still up next', p.progress.next_routine?.name);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
