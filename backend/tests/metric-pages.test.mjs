// The metric pages (2026-09-16 rethink, PR 3): one number, at the range he picks.
// "Only 30 days or 90 days with minimal stats. Not very fine grained, not useful if I
// just want to see how its been going today or the last week."
import pg from 'pg';

const BASE = process.env.TEST_API_URL || 'http://localhost:3997';
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, label, detail = '') => {
  if (c) { console.log(`  PASS  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ''}`); fail++; }
};
const api = async (path) => {
  const res = await fetch(BASE + path);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, body };
};

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: process.env.APP_TIMEZONE || 'Australia/Melbourne',
  year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const shift = (iso, d) => {
  const [y, m, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day + d)).toISOString().slice(0, 10);
};

// Four nights, one of them skipped, so a gap has to survive the series.
for (const [back, score, rhr] of [[1, 83, 53], [2, 67, 54], [4, 48, 57], [40, 90, 50]]) {
  await db.query(
    `INSERT INTO wellness_daily (date, sleep_score, resting_hr, sleep_secs, sleep_deep_secs,
                                 sleep_rem_secs, sleep_light_secs, sleep_awake_secs, sleep_start, sleep_end, raw)
          VALUES ($1::date, $2, $3, 36300, 3840, 10800, 21660, 1500,
                  $1::date - INTERVAL '1 day' + TIME '23:14', $1::date + TIME '09:44', '{}'::jsonb)`,
    [shift(today, -back), score, rhr]
  );
}

console.log('\n─── the window is the caller’s ───');
{
  const week = await api('/api/coach/metric/sleep_score?days=7');
  ok(week.status === 200 && week.body.series.length === 8, 'a week is eight dated points', String(week.body?.series?.length));
  ok(week.body.stats.tracked === 3, 'only the nights inside the window count', String(week.body.stats.tracked));
  ok(week.body.series.some((p) => p.value === null), 'an untracked night stays a gap');
  ok(week.body.stats.best === 83 && week.body.stats.worst === 48, 'best and worst read the window', JSON.stringify(week.body.stats));

  const year = await api('/api/coach/metric/sleep_score?days=365');
  ok(year.body.stats.tracked === 4, 'a year reaches the older night too', String(year.body.stats.tracked));
  ok(year.body.stats.best === 90, 'and it is the best of the year', String(year.body.stats.best));
}

console.log('\n─── direction, usual, and what each metric means ───');
{
  const rhr = await api('/api/coach/metric/resting_hr?days=365');
  ok(rhr.body.good === 'down', 'a lower resting HR is better');
  ok(rhr.body.stats.best === 50 && rhr.body.stats.worst === 57, 'so best is the lowest reading', JSON.stringify(rhr.body.stats));
  const month = await api('/api/coach/metric/resting_hr?days=30');
  ok(month.body.stats.best === 53, 'and the month knows nothing of a night outside it', JSON.stringify(month.body.stats));
  ok(rhr.body.unit === 'bpm', 'and it carries its unit');

  const weight = await api('/api/coach/metric/weight_kg?days=30');
  ok(weight.status === 200 && weight.body.weight_goal_kg === 93.5, 'weight carries the goal line', JSON.stringify(weight.body?.weight_goal_kg));
  ok(weight.body.precision === 1, 'and a decimal place, because it moves in tenths');
}

console.log('\n─── sleep carries its stages and the week’s bedtimes ───');
{
  const { body } = await api('/api/coach/metric/sleep_score?days=30');
  ok(body.sleep?.last_night?.sleep_deep_secs === 3840, 'last night has its stages', JSON.stringify(body.sleep?.last_night?.sleep_deep_secs));
  ok(body.sleep?.last_night?.bed === '23:14', 'and the time he went to bed', body.sleep?.last_night?.bed);
  ok(body.sleep?.anchor === '22:30' && body.sleep?.tolerance_minutes === 30, 'the anchor comes from the protocol, not the page');
  ok(body.sleep.nights.every((n) => n.within_anchor === false), '23:14 is outside 22:30 ±30');
  const rhr = await api('/api/coach/metric/resting_hr?days=30');
  ok(rhr.body.sleep === null, 'other metrics carry no sleep block');
}

console.log('\n─── an unknown field never reaches SQL ───');
{
  ok((await api('/api/coach/metric/sleep_score;DROP')).status === 404, 'an injected field is a 404');
  ok((await api('/api/coach/metric/hrv_last_night')).status === 404, 'a real column that is not a listed metric is a 404 too');
}

await db.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
