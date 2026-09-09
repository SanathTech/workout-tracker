import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSeries, runSessions, swimSeries, weekStart, weeklyTotals } from '../src/util/endurance.js';

const run = (date, m, t, extra = {}) => ({ date, type: 'Run', distance_m: String(m), moving_time: t, average_hr: 146, ...extra });
const swim = (date, m, t, extra = {}) => ({ date, type: 'Swim', distance_m: String(m), moving_time: t, ...extra });

test('weekStart is the Monday of the calendar week', () => {
  assert.equal(weekStart('2026-09-09'), '2026-09-07'); // Wednesday
  assert.equal(weekStart('2026-09-07'), '2026-09-07'); // Monday stays
  assert.equal(weekStart('2026-09-13'), '2026-09-07'); // Sunday belongs to the week before
});

test('weeklyTotals has one bucket per week, zeros kept, scraps dropped', () => {
  const sessions = [
    run('2026-09-08', 6782, 3185),
    run('2026-09-06', 6565, 3182),
    run('2026-08-25', 176, 129), // a scrap: not a point
    run('2026-08-21', 5601, 2486),
  ];
  const weeks = weeklyTotals(runSessions(sessions), { weeks: 4, today: '2026-09-09' });
  assert.deepEqual(weeks.map((w) => w.week), ['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07']);
  assert.deepEqual(weeks.map((w) => w.sessions), [1, 0, 1, 1]);
  assert.deepEqual(weeks.map((w) => w.km), [5.6, 0, 6.6, 6.8]);
});

test('runSeries prefers the running-only pace and reads drift', () => {
  const [a, b] = runSeries([
    run('2026-09-08', 6782, 3185, { run_pace_s: 457, decoupling_pct: '11.1' }),
    run('2026-05-05', 5394, 1888),
  ]);
  assert.equal(a.date, '2026-05-05'); // oldest first
  assert.equal(a.pace_s, 350); // whole-session fallback: 1888 / 5.394
  assert.equal(a.pace_is_run_only, false);
  assert.equal(a.drift, null);
  assert.equal(b.pace_s, 457);
  assert.equal(b.pace_is_run_only, true);
  assert.equal(b.drift, 11.1);
});

test('swimSeries uses moving pace and rest when the stream gives them', () => {
  const [s] = swimSeries([
    swim('2026-09-09', 1300, 3230, { swim_moving_pace_s: 244, swim_rest_s: 303, stride_m: '0.60' }),
    swim('2026-01-14', 50, 94), // a length, not a session
  ]);
  assert.equal(s.pace_s, 244);
  assert.equal(s.rest_s, 303);
  assert.equal(s.stride_m, 0.6);
  assert.equal(s.minutes, 54);
});
