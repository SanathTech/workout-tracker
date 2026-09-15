// The activity page (2026-09-15 rethink, PR 2): "clicking on the run stats does nothing —
// I want to see a breakdown. I want to analyse my run."
//
// Two halves. The shaping of intervals.icu streams is pure and tested directly with a
// synthetic run/walk file. The route is tested without an API key, which is the state CI
// and a fresh deploy are both in: the page must still get its stored figures, and a
// cached stream must be served without touching intervals.icu at all.
import pg from 'pg';
import streamsUtil from '../src/util/activityStreams.js';

const { shape, RUN_MS } = streamsUtil;
const BASE = process.env.TEST_API_URL || 'http://localhost:3997';
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, label, detail = '') => {
  if (c) { console.log(`  PASS  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ''}`); fail++; }
};
async function api(method, path) {
  const res = await fetch(BASE + path, { method });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, body: json };
}

console.log('\n─── shape(): a run with one walk break ───');
{
  // 20 min at 2.5 m/s (6:40/km) with a 60 s walk at 1.3 m/s from minute 5, one sample a second.
  const time = [], velocity_smooth = [], distance = [], heartrate = [];
  let d = 0;
  for (let t = 0; t <= 1200; t += 1) {
    const walking = t >= 300 && t < 360;
    const v = walking ? 1.3 : 2.5;
    time.push(t); velocity_smooth.push(v); distance.push(d); heartrate.push(walking ? 130 : 150);
    d += v;
  }
  const out = shape('Run', { time, velocity_smooth, distance, heartrate });
  ok(out.kind === 'run', 'a Run shapes as a run');
  ok(out.walks.length === 1 && out.walks[0][0] === 300 && out.walks[0][1] === 359, 'the walk break is found where it happened', JSON.stringify(out.walks));
  ok(RUN_MS === 1.75, 'the running cut matches streams.py on nas-laptop');
  ok(out.series.length === Math.ceil(1201 / 15), 'series is bucketed to 15 s', String(out.series.length));
  ok(out.series[0][1] === 150 && out.series[0][2] === 2.5, 'buckets carry average HR and speed', JSON.stringify(out.series[0]));
  const full = out.splits.filter((s) => !s.partial);
  ok(full.length === 2, 'two whole kilometres', JSON.stringify(out.splits.map((s) => s.dist_m)));
  ok(full[0].pace_s === 429, 'the km with the walk in it reads slower (7:09)', String(full[0].pace_s));
  ok(full[1].pace_s === 400, 'a clean km at 6:40/km', String(full[1].pace_s));
  ok(full[0].avg_hr < 150, "the walk pulls that km's HR down", String(full[0].avg_hr));
  ok(out.splits.at(-1).partial && out.splits.at(-1).dist_m >= 200, 'the tail is kept as a partial split');
}

console.log('\n─── shape(): short files and swims ───');
{
  ok(shape('Run', { time: [0, 1, 2] }) === null, 'a file under 30 samples shapes to null');
  const time = [], velocity_smooth = [], distance = [];
  let d = 0;
  for (let t = 0; t <= 600; t += 1) {
    const resting = t % 150 >= 140;
    const v = resting ? 0 : 0.5;
    time.push(t); velocity_smooth.push(v); distance.push(d);
    d += v;
  }
  const swim = shape('Swim', { time, velocity_smooth, distance, heartrate: time.map(() => 140) });
  ok(swim.kind === 'swim' && swim.splits.length >= 2, 'a swim splits by 100 m', JSON.stringify(swim.splits.map((s) => s.dist_m)));
  ok(swim.splits.every((s) => s.avg_hr === null), 'swim splits carry no wrist HR');
  ok(swim.series.every((row) => row[1] === null), 'swim series carries no wrist HR');
}

console.log('\n─── GET /coach/activity/:id ───');
await db.query(
  `INSERT INTO activities (id, start_date_local, date, type, name, moving_time, elapsed_time,
                          distance, average_hr, max_hr, hr_zone_times, stream_summary, raw, synced_at)
        VALUES ('act-run-1', '2026-09-15 12:45', '2026-09-15', 'Run', 'Melbourne Running',
                4127, 4129, 8941.22, 147, 169, ARRAY[960, 2546, 489, 103],
                '{"kind":"run","decoupling_pct":15.5,"hrr_60":24,"efforts":[{"dur_s":22,"avg_pace_s":304}]}'::jsonb,
                '{}'::jsonb, NOW() - INTERVAL '1 hour')`
);
{
  const { status, body } = await api('GET', '/api/coach/activity/act-run-1');
  ok(status === 200, 'known activity → 200', String(status));
  ok(body?.activity?.distance_m === '8941' || Number(body?.activity?.distance_m) === 8941, 'distance comes back in metres');
  ok(body?.activity?.over_ceiling_min === 9.9, 'minutes over the ceiling from zones 3+', String(body?.activity?.over_ceiling_min));
  ok(body?.activity?.stream_summary?.decoupling_pct === 15.5, 'stored stream_summary rides along');
  ok(body?.hr_ceiling === 153, 'carries the HR ceiling');
  ok(body?.activity?.date === '2026-09-15', 'date is a calendar day');
  ok(!('synced_at' in (body?.activity || {})), 'internal sync stamp is not exposed');
  if (!process.env.INTERVALS_API_KEY) {
    ok(body?.streams === null && body?.streams_error === 'not_configured', 'no key → stored figures only, with the reason', JSON.stringify({ s: body?.streams, e: body?.streams_error }));
  }
}
{
  const cached = { kind: 'run', duration_s: 4129, series: [[0, 120, 2.1]], walks: [], splits: [] };
  await db.query(`INSERT INTO activity_streams (activity_id, data, fetched_at) VALUES ('act-run-1', $1, NOW())`, [cached]);
  const { body } = await api('GET', '/api/coach/activity/act-run-1');
  ok(body?.streams?.series?.[0]?.[1] === 120 && body?.streams_error === null, 'a fresh cache row is served without fetching', JSON.stringify(body?.streams));

  // A re-sync after the cache was written (a GPS or phantom-length correction) makes it stale.
  await db.query(`UPDATE activities SET synced_at = NOW() + INTERVAL '1 minute' WHERE id = 'act-run-1'`);
  const { body: stale } = await api('GET', '/api/coach/activity/act-run-1');
  ok(stale?.streams?.series?.[0]?.[1] !== 120, 'a cache row older than the last sync is not served', JSON.stringify(stale?.streams));
}
{
  ok((await api('GET', '/api/coach/activity/nope-404')).status === 404, 'unknown activity → 404');
  ok((await api('GET', '/api/coach/activity/bad%20id')).status === 400, 'malformed id → 400');
}

console.log('\n─── endurance rows carry the id the page links by ───');
await db.query(`UPDATE activities SET date = $1 WHERE id = 'act-run-1'`, [
  new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Australia/Melbourne' }).format(new Date()),
]);
{
  const { body } = await api('GET', '/api/coach/endurance?days=30');
  ok(body?.sessions?.some((s) => s.id === 'act-run-1'), 'endurance session has its activity id', JSON.stringify(body?.sessions?.map((s) => s.id)));
}

await db.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
