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
                2400, 6000, 148, ARRAY[600, 1560, 180, 60],
                '{"average_cadence": 76.5, "total_elevation_gain": 41.2, "average_stride": 0.94, "icu_hrr": {"hrr": 22, "start_bpm": 174, "end_bpm": 152}}'::jsonb)
   ON CONFLICT (id) DO NOTHING`,
  [shift(today, -2)]
);
// The per-effort figures the sync computes from the streams. The junk run below has
// none, which is every pre-stream row — the fallback the UI labels "spm session".
await db.query(
  `UPDATE activities SET stream_summary = '{"kind":"run",
      "run_only": {"cadence_spm": 158, "pace_s_per_km": 400, "stride_m": 0.95, "share": 0.9},
      "efforts": [{"dur_s": 20, "peak_pace_s": 217, "avg_pace_s": 258, "cad_avg": 180, "cad_max": 186, "stride_m": 1.29, "hr_max": 169},
                  {"dur_s": 18, "peak_pace_s": 290, "avg_pace_s": 312, "cad_avg": 170, "cad_max": 178, "stride_m": 1.13, "hr_max": 165}],
      "hrr_60": 24, "decoupling_pct": 7.5}'::jsonb
    WHERE id = 'test-run-1'`
);

// A swim alongside it. The endurance list carries both sports, and the two fields that
// mean different things per sport (cadence per-leg vs per-stroke, stride as step length
// vs distance per stroke) are only testable with one of each present.
await db.query(
  `INSERT INTO activities (id, start_date_local, date, type, name, moving_time,
                           distance, average_hr, hr_zone_times, raw)
        VALUES ('test-swim-1', $1::date + TIME '08:00', $1, 'Swim', 'Test Swim',
                2100, 1000, 132, ARRAY[1800, 300, 0, 0],
                '{"average_cadence": 22.0, "average_stride": 0.68}'::jsonb)
   ON CONFLICT (id) DO NOTHING`,
  [shift(today, -3)]
);

// A run whose cadence is a non-numeric string. intervals.icu is third-party and the
// query casts these fields with ::numeric — an empty string would throw and 500 the
// whole Trends tab, taking sleep, protocol and the week down with it.
await db.query(
  `INSERT INTO activities (id, start_date_local, date, type, name, moving_time,
                           distance, average_hr, hr_zone_times, raw)
        VALUES ('test-run-junk', $1::date + TIME '07:00', $1, 'Run', 'Junk Cadence Run',
                1800, 5000, 140, ARRAY[900, 900, 0, 0],
                '{"average_cadence": "", "total_elevation_gain": "n/a", "icu_hrr": {"hrr": "junk"}}'::jsonb)
   ON CONFLICT (id) DO NOTHING`,
  [shift(today, -4)]
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
const run = t?.endurance?.find((r) => r.name === 'Test Run');
ok(run != null, 'endurance includes the seeded run');
ok(Number(run?.minutes_over_hr_ceiling) === 4,
  'over-ceiling minutes sum zones 3+', `got ${run?.minutes_over_hr_ceiling}`);
ok(run?.when != null, 'session rows carry a when label');
// No cadence threshold is served: the session average includes walk breaks, so a
// number below any target says as much about the walking as the running.
ok(t?.low_cadence_spm === undefined, 'no cadence threshold is served');

// Cadence is per-LEG on a run and per-minute strokes on a swim, so only runs double.
ok(Number(run?.cadence) === 153, 'run cadence is doubled to steps per minute', `got ${run?.cadence}`);
ok(Number(run?.elevation_m) === 41, 'elevation gain is read out of raw', `got ${run?.elevation_m}`);
ok(Number(run?.hrr) === 24, 'the stream-computed HRR beats the icu fallback', `got ${run?.hrr}`);
ok(Number(run?.run_cadence) === 158, 'running-only cadence is served from the stream summary', `got ${run?.run_cadence}`);
ok(Array.isArray(run?.efforts) && run.efforts.length === 2, 'detected efforts ride along', JSON.stringify(run?.efforts)?.slice(0, 80));
ok(Number(run?.decoupling_pct) === 7.5, 'aerobic decoupling is served', `got ${run?.decoupling_pct}`);

const swim = t?.endurance?.find((r) => r.name === 'Test Swim');
ok(swim != null, 'endurance includes swims, not just runs');
ok(Number(swim?.cadence) === 22, 'swim cadence is NOT doubled', `got ${swim?.cadence}`);
ok(Number(swim?.stride_m) === 0.68, 'distance per stroke is served for swims', `got ${swim?.stride_m}`);

// The whole tab shares one endpoint, so a single unparseable field must not take
// sleep, protocol and the week down with it.
const junkRow = t?.endurance?.find((r) => r.name === 'Junk Cadence Run');
ok(junkRow != null, 'a session with unparseable raw fields still returns');
ok(junkRow?.cadence == null, 'an unparseable cadence comes back null rather than throwing');
ok(junkRow?.elevation_m == null, 'an unparseable elevation comes back null rather than throwing');
ok(junkRow?.hrr == null, 'an unparseable hrr comes back null rather than throwing');
ok(junkRow?.run_cadence == null, 'a pre-stream row has no running-only cadence — the UI falls back', `got ${junkRow?.run_cadence}`);
ok(junkRow?.efforts == null, 'and no efforts array', `got ${junkRow?.efforts}`);

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

// intervals.icu publishes a row for TOMORROW — its forecast of where form lands if he
// trains nothing today. Every "current form" reader takes the newest row, so the
// forecast was being served as today's (2026-08-16: -1.8 shown, -3.4 actual).
await db.query(
  `INSERT INTO training_load (date, ctl, atl, raw) VALUES ($1, 10.7, 14.1, '{}'::jsonb),
                                                        ($2, 10.4, 12.2, '{}'::jsonb)
   ON CONFLICT (date) DO UPDATE SET ctl = EXCLUDED.ctl, atl = EXCLUDED.atl`,
  [today, shift(today, 1)]
);
const { body: r2 } = await api('/api/coach/readiness');
ok(r2?.training_load?.date?.startsWith(today),
  "current form is today's row, not tomorrow's forecast", `got ${r2?.training_load?.date}`);
ok(Number(r2?.training_load?.tsb) === -3.4,
  'and it carries the value for today', `got ${r2?.training_load?.tsb}`);

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

// The events ingest is the one endpoint that writes arbitrary client input, so its
// cleaning rules are the security surface: whitelisted kinds, capped lengths, junk
// timestamps clamped, and partial acceptance — a batch with rubbish in it stores the
// good rows rather than 400ing, because the client is fire-and-forget.
console.log('\nEvents ingest');
{
  const now = Date.now();
  const res = await fetch(BASE + '/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events: [
      { ts: now, session_id: 's-test', kind: 'nav', name: 'enter', route: '/week' },
      { ts: now, session_id: 's-test', kind: 'BOGUS', name: 'x' },                       // bad kind
      { ts: now, session_id: 's-test', kind: 'tap', name: '' },                          // empty name
      { ts: 123, session_id: 's-test', kind: 'tap', name: 'prev-fill', workout_id: 4 },  // ancient ts
      { ts: now, session_id: 's-test', kind: 'save', name: 'x'.repeat(500) },            // oversized name
    ] }),
  });
  const eb = await res.json();
  ok(res.status === 200, 'a partly-invalid batch is accepted, not 400d', `got ${res.status}`);
  ok(eb?.stored === 3, 'only the cleanable events store', `got ${eb?.stored}`);

  const { rows } = await db.query(
    `SELECT kind, name, LENGTH(name) name_len,
            (ts > NOW() - INTERVAL '2 minutes') AS ts_clamped
       FROM app_events WHERE session_id = 's-test' ORDER BY id`
  );
  ok(rows.length === 3, 'three rows landed', `got ${rows.length}`);
  ok(!rows.some((r) => r.kind === 'BOGUS'), 'unknown kinds are rejected');
  ok(rows.every((r) => r.name_len <= 60), 'names are capped at 60');
  ok(rows.find((r) => r.name === 'prev-fill')?.ts_clamped === true,
    'an implausible client timestamp is clamped to now');
  await db.query(`DELETE FROM app_events WHERE session_id = 's-test'`);
}

// Coach notes: active rows served, resolved rows not.
console.log('\nCoach notes');
{
  await db.query(`INSERT INTO coach_notes (exercise_id, note) VALUES (NULL, 'active note')`);
  await db.query(`INSERT INTO coach_notes (exercise_id, note, resolved_at) VALUES (NULL, 'resolved note', NOW())`);
  const { status: ns, body: notes } = await api('/api/coach/notes');
  ok(ns === 200, 'GET /api/coach/notes returns 200', `got ${ns}`);
  ok(notes.some((n) => n.note === 'active note'), 'active notes are served');
  ok(!notes.some((n) => n.note === 'resolved note'), 'resolved notes are not');
  await db.query(`DELETE FROM coach_notes WHERE note IN ('active note','resolved note')`);
}

await db.end();
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
