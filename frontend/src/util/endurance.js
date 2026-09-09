// The run and swim sessions turned into the series the Health tab's endurance charts
// draw (2026-09-09). Pure functions over the /coach/endurance rows so the shaping is
// testable without a browser and the chart component only draws.
//
// Two rules the log list doesn't apply:
//   - Scraps are dropped. A 176 m "run" is a watch left recording on the walk to the
//     car, a 1.2 km one is a stride set (4:45/km at the far right of a 7:40 pace line),
//     a 50 m swim is a length between sets; all real activities that belong in the
//     log, none of them a data point on a pace line.
//   - Weeks are calendar weeks starting Monday, the same week the backend plans and
//     reviews, and an empty week is a zero bar, not a missing one — a gap in training
//     is the finding, and a chart that quietly closes the gap hides it.

import { localDate, parseDay } from './format.js';

export const isRun = (type) => type === 'Run' || type === 'VirtualRun';
export const isSwim = (type) => type === 'Swim';

export const MIN_RUN_M = 2000;
export const MIN_SWIM_M = 200;

const iso = (d) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Monday of the week that holds `day`, as YYYY-MM-DD.
// Clone before shifting: parseDay hands back the same object when given a Date.
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

export function weekStart(day) {
  const d = new Date(parseDay(day));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return iso(d);
}

const num = (v) => (v == null || v === '' ? null : Number(v));

// Sessions worth a point, oldest first.
export function runSessions(sessions) {
  return (sessions || [])
    .filter((s) => isRun(s.type) && num(s.distance_m) >= MIN_RUN_M && s.moving_time > 0)
    .sort(byDate);
}

export function swimSessions(sessions) {
  return (sessions || [])
    .filter((s) => isSwim(s.type) && num(s.distance_m) >= MIN_SWIM_M && s.moving_time > 0)
    .sort(byDate);
}

// One bucket per calendar week over the last `weeks` weeks (ending on the week that
// holds `today`), each with the discipline's dose: km for runs, minutes for swims.
export function weeklyTotals(sessions, { weeks, today = localDate() }) {
  const end = weekStart(today);
  const endDate = parseDay(end);
  const buckets = new Map();
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(endDate);
    d.setDate(d.getDate() - i * 7);
    buckets.set(iso(d), { week: iso(d), km: 0, minutes: 0, sessions: 0 });
  }
  for (const s of sessions) {
    const b = buckets.get(weekStart(s.date));
    if (!b) continue;
    b.km += (num(s.distance_m) || 0) / 1000;
    b.minutes += (s.moving_time || 0) / 60;
    b.sessions += 1;
  }
  return [...buckets.values()].map((b) => ({
    ...b,
    km: Math.round(b.km * 10) / 10,
    minutes: Math.round(b.minutes),
  }));
}

// Per-run points. Pace is the running-only figure from the stream where it exists
// (walk breaks excluded — the honest number on an HR-governed run), else the whole
// session's. Drift is aerobic decoupling, present only on stream-summarised rows.
export function runSeries(sessions) {
  return runSessions(sessions).map((s) => {
    const metres = num(s.distance_m);
    return {
      date: String(s.date).slice(0, 10),
      pace_s: s.run_pace_s != null ? Number(s.run_pace_s) : Math.round(s.moving_time / (metres / 1000)),
      pace_is_run_only: s.run_pace_s != null,
      hr: num(s.average_hr),
      drift: num(s.decoupling_pct),
      km: Math.round(metres / 100) / 10,
    };
  });
}

// Per-swim points. Pace is the moving pace where the stream gives one (wall rests
// out), else the whole session's; rest is the wall time those rests add up to.
export function swimSeries(sessions) {
  return swimSessions(sessions).map((s) => {
    const metres = num(s.distance_m);
    return {
      date: String(s.date).slice(0, 10),
      pace_s: s.swim_moving_pace_s != null ? Number(s.swim_moving_pace_s) : Math.round(s.moving_time / (metres / 100)),
      rest_s: s.swim_rest_s != null ? Number(s.swim_rest_s) : null,
      stride_m: num(s.stride_m),
      minutes: Math.round(s.moving_time / 60),
      metres,
    };
  });
}
