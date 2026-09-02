// The weight goal line on Trends: a target expressed as a WEEKLY MEAN.
//
// The distinction this suite defends is not cosmetic. His daily scale readings swing
// most of a kilo overnight on hydration alone, so a "distance to goal" computed from the
// latest reading would swing with them and manufacture alarm on a plan that is working.
// Everything here therefore asserts on two 7-day means and the move between them.
import pg from 'pg';

const BASE = process.env.TEST_API_URL || 'http://localhost:3997';
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, label, detail = '') => {
  if (c) { console.log(`  PASS  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ''}`); fail++; }
};
async function api(path) {
  const res = await fetch(BASE + path);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, body: json };
}

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: process.env.APP_TIMEZONE || 'Australia/Melbourne',
  year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const shift = (iso, delta) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
};

// Seeded as MANUAL rows on purpose: manual wins the COALESCE over the Garmin figure, so
// these means are deterministic no matter what training_load rows an earlier suite left
// on the same dates.
const setWeight = (offset, kg) => db.query(
  `INSERT INTO bodyweight_logs (date, weight_kg) VALUES ($1, $2)
   ON CONFLICT (date) DO UPDATE SET weight_kg = EXCLUDED.weight_kg`,
  [shift(today, offset), kg]
);
// Both sources are cleared, not just the manual one. An earlier suite seeds deliberately
// absurd Garmin weights (200kg, 55kg) inside this same fortnight to prove a tie-break,
// and those rows would otherwise leak into these means on any day this suite does not
// itself overwrite — which is exactly the case the thin-week block below depends on.
const clearWeights = async () => {
  await db.query(`DELETE FROM bodyweight_logs WHERE date >= $1::date - 13`, [today]);
  await db.query(
    `UPDATE training_load SET weight_kg = NULL WHERE date >= $1::date - 13`, [today]
  );
};

const goal = async () => (await api('/api/coach/trends')).body?.protocol?.weight;

// A losing week: this week means 95.6, last week 95.9.
console.log('\nWeight goal — a week that moved');
{
  await clearWeights();
  // today-6 .. today  ->  mean 95.60
  const thisWeek = [95.0, 95.2, 95.4, 95.6, 95.8, 96.0, 96.2];
  for (let i = 0; i < 7; i += 1) await setWeight(-6 + i, thisWeek[i]);
  // today-13 .. today-7  ->  mean 95.90
  const prevWeek = [95.3, 95.6, 95.9, 95.9, 95.9, 96.2, 96.5];
  for (let i = 0; i < 7; i += 1) await setWeight(-13 + i, prevWeek[i]);

  const g = await goal();
  ok(g != null, 'protocol carries a weight goal block');
  ok(g?.goal_kg === 93.5, 'the goal is served as a number', `got ${g?.goal_kg}`);
  ok(g?.week_mean === 95.6, 'this week is a mean, not the latest reading',
    `got ${g?.week_mean}`);
  ok(g?.prev_week_mean === 95.9, 'last week is a mean too', `got ${g?.prev_week_mean}`);
  ok(g?.change_kg === -0.3, 'week-on-week move is the difference of the means',
    `got ${g?.change_kg}`);
  ok(g?.to_goal_kg === 2.1, 'distance to goal is measured from the mean',
    `got ${g?.to_goal_kg}`);
  ok(g?.pace === 'losing', 'a 0.3kg week is losing at a sane rate', `got ${g?.pace}`);
  ok(g?.week_readings === 7, 'the readings behind the mean are reported',
    `got ${g?.week_readings}`);
}

// The guardrail: faster than 0.4kg/week is not "better", it is lean tissue.
console.log('\nWeight goal — too fast is flagged, not celebrated');
{
  await clearWeights();
  for (let i = 0; i < 7; i += 1) await setWeight(-6 + i, 95.0);
  for (let i = 0; i < 7; i += 1) await setWeight(-13 + i, 96.0);
  const g = await goal();
  ok(g?.change_kg === -1, 'a 1kg drop is reported at face value', `got ${g?.change_kg}`);
  ok(g?.pace === 'too_fast', 'and classified as too fast', `got ${g?.pace}`);
}

// One flat week is noise. It must read as flat rather than as progress in either
// direction, because it is TWO in a row that mean something.
console.log('\nWeight goal — a flat week reads flat');
{
  await clearWeights();
  for (let i = 0; i < 7; i += 1) await setWeight(-6 + i, 95.5);
  for (let i = 0; i < 7; i += 1) await setWeight(-13 + i, 95.55);
  const g = await goal();
  ok(g?.pace === 'flat', 'a move inside the noise band is flat', `got ${g?.pace}`);
}

// A mean over one or two weigh-ins is a reading wearing a disguise. It must report
// nothing rather than something wrong — the UI hides the line on a null mean.
console.log('\nWeight goal — a thin week reports nothing');
{
  await clearWeights();
  await setWeight(-1, 95.0);
  await setWeight(-2, 95.4);
  for (let i = 0; i < 7; i += 1) await setWeight(-13 + i, 96.0);
  const g = await goal();
  ok(g?.week_mean === null, 'two weigh-ins is not a weekly mean', `got ${g?.week_mean}`);
  ok(g?.change_kg === null, 'and no week-on-week move is claimed from it',
    `got ${g?.change_kg}`);
  ok(g?.to_goal_kg === null, 'nor a distance to goal', `got ${g?.to_goal_kg}`);
  ok(g?.pace === null, 'nor a pace', `got ${g?.pace}`);
  ok(g?.week_readings === 2, 'but the thin count is still visible',
    `got ${g?.week_readings}`);
}

await clearWeights();
await db.end();
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
