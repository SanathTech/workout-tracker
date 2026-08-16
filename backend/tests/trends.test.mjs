// The Trends tab's read surface: /api/coach/trends and /api/coach/load-history.
//
// These are pure reads over the hub tables, so the suite seeds them directly rather
// than going through an API that cannot write them (the nas-laptop timers own those
// writes). What is worth asserting is the *shape* the dashboard depends on: a row per
// day including untracked ones, today excluded from the week score, and runs carrying
// over-ceiling minutes.
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

// The app's calendar day, which is what every window anchors to — not the server's.
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: process.env.APP_TIMEZONE || 'Australia/Melbourne',
  year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const shift = (iso, delta) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
};

// Two nights of wellness with a deliberate gap between them, so the null-day assertion
// has something to find.
await db.query(
  `INSERT INTO wellness_daily (date, sleep_score, resting_hr, stress_avg,
                               body_battery_at_wake, sleep_secs, steps, sleep_start, raw)
        VALUES ($1, 80, 52, 30, 85, 25000, 9000, $1::date + TIME '22:40', '{}'::jsonb),
               ($2, 60, 55, 44, 70, 19000, 3000, $2::date + TIME '00:20', '{}'::jsonb)
   ON CONFLICT (date) DO NOTHING`,
  [shift(today, -1), shift(today, -3)]
);
await db.query(
  `INSERT INTO training_load (date, ctl, atl, raw) VALUES ($1, 10.4, 12.2, '{}'::jsonb)
   ON CONFLICT (date) DO NOTHING`,
  [shift(today, -1)]
);
// A run with 4 minutes above the ceiling: hr_zone_times is [z1, z2, z3, ...] seconds,
// and everything from zone 3 up is over the top of his Zone 2.
await db.query(
  `INSERT INTO activities (id, start_date_local, date, type, name, moving_time,
                           distance, average_hr, hr_zone_times, raw)
        VALUES ('test-run-1', $1::date + TIME '07:00', $1, 'Run', 'Test Run',
                2400, 6000, 148, ARRAY[600, 1560, 180, 60], '{}'::jsonb)
   ON CONFLICT (id) DO NOTHING`,
  [shift(today, -2)]
);

console.log('\nTrends read surface');

const { status, body: t } = await api('/api/coach/trends?days=14');
ok(status === 200, 'GET /api/coach/trends returns 200', `got ${status}`);
ok(Array.isArray(t?.wellness) && t.wellness.length === 14,
  'wellness series has one row per requested day', `got ${t?.wellness?.length}`);
ok(t?.wellness?.some((r) => r.sleep_score == null),
  'untracked days are present as nulls, not dropped');
ok(t?.wellness?.at(-1)?.date?.startsWith(shift(today, -1)),
  'series ends yesterday — today is a part-day and would misreport steps and stress',
  `got ${t?.wellness?.at(-1)?.date}`);
ok(!t?.wellness?.some((r) => String(r.date).startsWith(today)),
  'today never appears in the trend series');

ok(t?.week?.days?.length === 7, 'week scorecard covers Monday to Sunday');
ok(t?.week?.days?.filter((d) => d.is_today).length === 1, 'exactly one day is flagged today');
ok(!t?.week?.days?.find((d) => d.is_today)?.upcoming, 'today is not also flagged upcoming');
ok(t?.week?.slots_scored === t?.week?.days?.filter((d) => !d.upcoming && !d.is_today).length,
  'today and future days are excluded from the score');

ok(t?.hr_ceiling === 153, 'hr ceiling is served for the axis label', `got ${t?.hr_ceiling}`);
const run = t?.runs?.find((r) => r.name === 'Test Run');
ok(run != null, 'runs include the seeded run');
ok(Number(run?.minutes_over_hr_ceiling) === 4,
  'over-ceiling minutes sum zones 3+', `got ${run?.minutes_over_hr_ceiling}`);
ok(run?.when != null, 'run rows carry a when label');
ok(!t?.runs?.some((r) => r.type === 'Swim'), 'non-run activities stay out of run discipline');

ok(t?.protocol?.bedtime != null && t?.protocol?.movement != null,
  'protocol block carries bedtime and movement');

const { status: ls, body: load } = await api('/api/coach/load-history?days=30');
ok(ls === 200, 'GET /api/coach/load-history returns 200', `got ${ls}`);
ok(Array.isArray(load) && load.length > 0, 'load history returns rows');
ok(load?.[0]?.tsb != null, 'tsb is served (generated column)');
ok(load?.every((r, i, a) => i === 0 || r.date >= a[i - 1].date), 'load history is ascending by date');

// The readiness card and the coach brief both describe "last night". wellness_daily
// keys a night by the day he woke, and the Garmin sync only carries a night once the
// watch has uploaded it — so on a late wake-up the freshest row is an older night, and
// both surfaces used to call it last night's regardless. The seeded nights above stop
// at yesterday, which is exactly that case.
const { body: ready } = await api('/api/coach/readiness');
ok(ready?.last_night?.date?.startsWith(shift(today, -1)),
  'readiness serves the freshest recorded night', `got ${ready?.last_night?.date}`);
ok(ready?.is_last_night === false,
  'a night older than today is NOT flagged as last night', `got ${ready?.is_last_night}`);

// And the opposite case: seed a night dated today, which is a night he woke from today.
await db.query(
  `INSERT INTO wellness_daily (date, sleep_score, resting_hr, body_battery_at_wake, raw)
        VALUES ($1, 84, 54, 86, '{}'::jsonb)
   ON CONFLICT (date) DO UPDATE SET sleep_score = 84, body_battery_at_wake = 86`,
  [today]
);
const { body: fresh } = await api('/api/coach/readiness');
ok(fresh?.is_last_night === true,
  'a night dated today IS last night', `got ${fresh?.is_last_night}`);
ok(fresh?.last_night?.sleep_score === 84,
  'and it is the row that gets served once it arrives', `got ${fresh?.last_night?.sleep_score}`);

// The window params are user-supplied, so they get the hostile cases: a negative would
// invert generate_series into an empty series, and a fraction would reach a ::int cast.
const { body: neg } = await api('/api/coach/trends?days=-5');
ok(neg?.wellness?.length === 30, 'a negative days falls back to the default window',
  `got ${neg?.wellness?.length}`);
const { body: frac } = await api('/api/coach/trends?days=7.9');
ok(frac?.wellness?.length === 7, 'a fractional days truncates rather than rounding',
  `got ${frac?.wellness?.length}`);
const { status: junk } = await api('/api/coach/load-history?days=abc');
ok(junk === 200, 'a non-numeric days does not 500', `got ${junk}`);

await db.end();
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
