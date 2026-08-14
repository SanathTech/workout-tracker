const db = require('../db');
const { todayInAppTimezone, currentWeekStart } = require('./dates');

// Every context bundle the coach reasons over — daily, weekly, and chat — is built
// here, from one set of query helpers. This file replaced coach_context.py on
// nas-laptop; if a bundle needs a new field, this is the only place to add it.
//
// Every window anchors to the app's calendar day rather than Postgres CURRENT_DATE:
// Neon is UTC, which puts a Melbourne morning a day behind. Same rule as util/dates.js.
//
// ⛔ No HRV anywhere. The vívosmart 5 does not record it (design doc → "No HRV, ever").
// Readiness is Body Battery at wake + sleep score/stages + RHR trend + stress + TSB.

const today = () => todayInAppTimezone();

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// The standing weekly template, keyed by weekday. The bundle names today's slot so the
// coach never has to infer the day of week from a bare ISO date — it got that wrong and
// deferred a Saturday gym day to "Monday" (2026-08-15).
const RHYTHM = {
  Monday: 'gym (next in the A->B->C cycle)',
  Tuesday: 'easy run 30-45min',
  Wednesday: 'swim — a fixture, plus sauna and dog walk',
  Thursday: 'gym (next in the A->B->C cycle)',
  Friday: 'recovery walk',
  Saturday: 'gym (next in the A->B->C cycle)',
  Sunday: 'longer easy run 45-60min or a ride',
};

// Every date the coach sees is labelled here rather than left as a bare ISO string.
// Date arithmetic is the single biggest source of confidently wrong claims it has made
// — calling a Thursday session "yesterday" on a Saturday, and pushing a session to a
// day that had already arrived.
function whenLabel(iso) {
  const d = Date.UTC(...iso.slice(0, 10).split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));
  const t = Date.UTC(...today().split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));
  const daysAgo = Math.round((t - d) / 86400000);
  const weekday = WEEKDAYS[new Date(d).getUTCDay()];
  const rel = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday'
    : daysAgo > 0 ? `${daysAgo} days ago` : `in ${-daysAgo} days`;
  return `${rel} (${weekday})`;
}

// Stamps `when` onto each row, so the model copies a label instead of computing one.
// The date column is named per caller (coach_advice keys on for_date); a row without
// one is passed through unlabelled rather than stamped "in NaN days (undefined)".
const labelRows = (rows, key = 'date') =>
  rows.map((r) => (r[key] ? { ...r, when: whenLabel(String(r[key])) } : r));

function todayBlock() {
  const iso = today();
  const weekday = WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
  return { date: iso, weekday, rhythm_slot_today: RHYTHM[weekday] };
}

// ---------------------------------------------------------------- shared blocks

// Last measured night plus the trailing window it has to be read against. A single
// night's Body Battery means nothing without the baseline — 61 is a bad morning for
// someone who wakes at 85 and a good one for someone who wakes at 40. The newest row
// is skipped when it's a stub: Garmin fills today's row as the day happens, so before
// the watch syncs it has stress and steps but no night.
async function readiness(days = 10) {
  const [latest, baseline] = await Promise.all([
    db.query(
      `SELECT date, body_battery_at_wake, body_battery_high, body_battery_low,
              sleep_score, sleep_secs, sleep_deep_secs, sleep_rem_secs, sleep_awake_secs,
              resting_hr, stress_avg, steps, respiration_avg
         FROM wellness_daily
        WHERE sleep_score IS NOT NULL OR body_battery_at_wake IS NOT NULL
        ORDER BY date DESC LIMIT 1`
    ),
    db.query(
      `SELECT ROUND(AVG(body_battery_at_wake)) AS body_battery_at_wake,
              ROUND(AVG(sleep_score))          AS sleep_score,
              ROUND(AVG(sleep_secs))           AS sleep_secs,
              ROUND(AVG(resting_hr))           AS resting_hr,
              ROUND(AVG(stress_avg))           AS stress_avg,
              COUNT(*)::int                    AS days
         FROM wellness_daily WHERE date >= $1::date - $2::int`,
      [today(), days]
    ),
  ]);
  return {
    last_night: latest.rows[0] || null,
    [`${days}d_average`]: baseline.rows[0] || null,
  };
}

async function loadBlock(days = 14) {
  const { rows } = await db.query(
    `SELECT date, ROUND(ctl, 1) AS ctl, ROUND(atl, 1) AS atl, ROUND(tsb, 1) AS tsb,
            ROUND(ramp_rate, 2) AS ramp_rate
       FROM training_load WHERE date >= $1::date - $2::int ORDER BY date DESC`,
    [today(), days]
  );
  return rows;
}

async function recentActivities(days = 14) {
  // minutes_over_hr_ceiling: time above his Z2 top (153) — zones 3+ of the stored
  // per-zone seconds. This is the honest run-discipline number: a walk-flattered or
  // merely-average HR can hide long stretches at threshold, and his history did
  // exactly that (runs averaging 157-176 carried 28-35 min over the ceiling).
  const { rows } = await db.query(
    `SELECT date, type, name, moving_time, ROUND(distance) AS distance_m,
            average_hr, ROUND(training_load) AS training_load,
            (SELECT ROUND(SUM(z) / 60.0, 1)
               FROM unnest(hr_zone_times[3:]) AS z) AS minutes_over_hr_ceiling
       FROM activities WHERE date >= $1::date - $2::int ORDER BY start_date_local DESC`,
    [today(), days]
  );
  return labelRows(rows);
}

// Working sets only — warm-ups would inflate every volume number. Joined to
// `activities` on the calendar day so the coach sees the gym session's HR load next to
// its set volume; that pairing is the point of running both sources.
async function strengthSessions(days = 14) {
  const { rows } = await db.query(
    `SELECT w.date, w.routine_name, w.duration_minutes, w.notes,
            COUNT(*) FILTER (WHERE s.set_type <> 'warmup')::int AS working_sets,
            ROUND(SUM(s.weight_kg * s.reps) FILTER (WHERE s.set_type <> 'warmup')) AS volume_kg,
            (SELECT ROUND(a.training_load) FROM activities a
              WHERE a.type = 'WeightTraining' AND a.date = w.date LIMIT 1) AS garmin_load,
            (SELECT a.average_hr FROM activities a
              WHERE a.type = 'WeightTraining' AND a.date = w.date LIMIT 1) AS garmin_avg_hr,
            (SELECT sf.rpe FROM session_feel sf WHERE sf.workout_id = w.id) AS rpe,
            -- HIS per-exercise notes (workout_exercises.notes), never the program's
            -- coaching cues (routine_exercises.notes) — those are prescription, not
            -- observation, and are deliberately not copied into a workout. These carry
            -- the specifics the session note cannot ("left shoulder clicked on
            -- pull-ups"); the niggle rules in the persona apply to them as to the rest.
            (SELECT json_agg(json_build_object('exercise', e2.name, 'note', we2.notes)
                               ORDER BY we2.sort_order)
               FROM workout_exercises we2
               JOIN exercises e2 ON e2.id = we2.exercise_id
              WHERE we2.workout_id = w.id AND NULLIF(TRIM(we2.notes), '') IS NOT NULL
            ) AS exercise_notes
       FROM workouts w
       JOIN workout_exercises we ON we.workout_id = w.id
       JOIN workout_sets s ON s.workout_exercise_id = we.id
      WHERE w.status = 'completed' AND w.date >= $1::date - $2::int
      GROUP BY w.id, w.date, w.routine_name, w.duration_minutes
      ORDER BY w.date DESC`,
    [today(), days]
  );
  return labelRows(rows);
}

// Mirror of the app's sequence rule: routines[(completed + skipped) % cycle_length].
// Duplicated from GET /api/programs/active rather than importing it, because that
// route returns a hydrated payload; this needs four fields.
async function nextSession() {
  const program = await db.query(
    `SELECT id, name, total_weeks FROM programs WHERE status = 'active' LIMIT 1`
  );
  if (!program.rows.length) return null;
  const p = program.rows[0];

  const routines = await db.query(
    `SELECT id, name FROM routines
      WHERE program_id = $1 AND deleted_at IS NULL ORDER BY sort_order, id`,
    [p.id]
  );
  if (!routines.rows.length) return { program: p.name, next_routine: null };

  const done = await db.query(
    `SELECT COUNT(*)::int AS n FROM workouts
      WHERE program_id = $1 AND status IN ('completed', 'skipped')`,
    [p.id]
  );
  const nxt = routines.rows[done.rows[0].n % routines.rows.length];

  const exercises = await db.query(
    `SELECT e.name, re.target_sets, re.rep_range_low, re.rep_range_high, re.is_main
       FROM routine_exercises re JOIN exercises e ON e.id = re.exercise_id
      WHERE re.routine_id = $1 ORDER BY re.sort_order, re.id`,
    [nxt.id]
  );

  return {
    program: p.name,
    total_weeks: p.total_weeks,
    next_routine: nxt.name,
    sessions_logged: done.rows[0].n,
    cycle_length: routines.rows.length,
    exercises: exercises.rows,
  };
}

// bodyweight_logs wins where a manual entry exists; Garmin's carried-forward figure is
// the fallback. See the note in schema_hub.sql.
async function bodyweight(days = 30) {
  const { rows } = await db.query(
    `SELECT d::date AS date,
            COALESCE(b.weight_kg, t.weight_kg) AS weight_kg,
            CASE WHEN b.weight_kg IS NOT NULL THEN 'manual' ELSE 'garmin' END AS source
       FROM generate_series($1::date - $2::int, $1::date, '1 day') d
       LEFT JOIN bodyweight_logs b ON b.date = d::date
       LEFT JOIN training_load   t ON t.date = d::date
      WHERE COALESCE(b.weight_kg, t.weight_kg) IS NOT NULL
      ORDER BY d DESC`,
    [today(), days]
  );
  return rows;
}

async function checkins(days = 14) {
  const { rows } = await db.query(
    `SELECT date, mood, energy, soreness, note FROM checkins
      WHERE date >= $1::date - $2::int ORDER BY date DESC`,
    [today(), days]
  );
  return labelRows(rows);
}

async function pastAdvice(kind, limit) {
  const { rows } = await db.query(
    `SELECT for_date, advice, model FROM coach_advice
      WHERE kind = $1 ORDER BY for_date DESC, id DESC LIMIT $2`,
    [kind, limit]
  );
  return rows;
}

// Never let the coach speak confidently off stale data — it gets told how old each
// feed is and the prompt instructs it to say so.
async function dataFreshness() {
  const { rows } = await db.query(
    `SELECT source, last_success,
            ROUND(EXTRACT(EPOCH FROM (NOW() - last_success)) / 3600)::int AS hours_ago,
            last_error
       FROM sync_state ORDER BY source`
  );
  return rows;
}

// Did the advice land? Each past daily call paired with what actually happened that
// day. This join is what makes the coach answerable for its own calls.
//
// DISTINCT ON collapses a date to its latest call — nothing stops two daily rows
// sharing a for_date (a manual re-run does exactly that), and the last call of the day
// is the operative one. `id` comes back so UI callers have a stable key.
async function buildAdherence(days = 28) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (ca.for_date)
            ca.id,
            ca.for_date,
            ca.advice->>'call'     AS call,
            ca.advice->>'headline' AS headline,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'type', a.type, 'load', ROUND(a.training_load)))
                FROM activities a WHERE a.date = ca.for_date
            ), '[]'::json) AS activities,
            (SELECT w.routine_name FROM workouts w
              WHERE w.date = ca.for_date AND w.status = 'completed' LIMIT 1) AS strength_session,
            (SELECT sf.rpe FROM session_feel sf WHERE sf.date = ca.for_date LIMIT 1) AS rpe
       FROM coach_advice ca
      WHERE ca.kind = 'daily' AND ca.for_date >= $2::date - $1::int
      ORDER BY ca.for_date DESC, ca.id DESC`,
    [days, today()]
  );
  return labelRows(rows, 'for_date');
}

// The protocol — Blueprint-derived, Sanath's numbers, agreed 2026-08-10. Targets
// live here (not in prose) so the coach reasons over the same constants the status
// is computed from. The last-meal cutoff has no data source yet: it is stated as a
// commitment for the coach to reference, never to claim measurement of.
const PROTOCOL_TARGETS = {
  bedtime_anchor: '22:30',
  bedtime_tolerance_minutes: 30,
  last_meal_cutoff: '19:30 (3h before anchor; unmeasured — a commitment, not a metric)',
  daily_movement: '>=30 min deliberate movement every day; an evening walk counts; 8000+ steps also satisfies it (measured as >=25 recorded moving minutes — see MOVEMENT_MIN_SECONDS)',
  weekly_gym_cycle: 'complete Day A, Day B and Day C each week',
  weekly_endurance: '2 endurance sessions (swim/run/ride)',
  weight_trend: 'flat or down (92 -> 95kg drift since late June is the thing being reversed)',
  watch_worn_nightly: 'sleep tracked every night — untracked nights blind the whole readiness picture',
};

const MOVEMENT_MIN_SECONDS = 25 * 60;

// Minutes past noon, so a 01:30 bedtime sorts after 23:30 instead of before it.
function bedMinutes(hm) {
  const [h, m] = hm.split(':').map(Number);
  return ((h + 12) % 24) * 60 + m;
}

function addDaysIso(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

async function protocolStatus() {
  const anchor = bedMinutes(PROTOCOL_TARGETS.bedtime_anchor);
  const tol = PROTOCOL_TARGETS.bedtime_tolerance_minutes;

  const [beds, movement, endurance, gym] = await Promise.all([
    db.query(
      `SELECT date, to_char(sleep_start, 'HH24:MI') AS bed, to_char(sleep_end, 'HH24:MI') AS wake
         FROM wellness_daily
        WHERE sleep_start IS NOT NULL AND date >= $1::date - 14
        ORDER BY date DESC`,
      [today()]
    ),
    // A movement day is: a recorded activity that evidences the 30-minute target, OR
    // a completed app workout (covers the forgotten watch), OR 8000+ steps. Walks
    // count by construction. The activity bar sits at 25 recorded moving minutes on
    // purpose: Garmin's moving_time trims kerb-waits and pauses, so an honest 30-min
    // walk routinely logs 26–28 — demanding 1800s would fail the exact behaviour the
    // target asks for. The tolerance is one-way slack on measurement, not a lower
    // target.
    db.query(
      `SELECT d::date AS date,
              EXISTS(SELECT 1 FROM activities a WHERE a.date = d::date AND a.moving_time >= ${MOVEMENT_MIN_SECONDS}) AS activity,
              EXISTS(SELECT 1 FROM workouts w WHERE w.date = d::date AND w.status = 'completed') AS gym,
              (SELECT wd.steps FROM wellness_daily wd WHERE wd.date = d::date) AS steps
         FROM generate_series($1::date - 13, $1::date, '1 day') d
        ORDER BY d DESC`,
      [today()]
    ),
    db.query(
      `SELECT COUNT(*)::int AS n FROM activities
        WHERE date >= $1::date AND type IN ('Swim','Run','Ride','VirtualRun','VirtualRide')`,
      [currentWeekStart()]
    ),
    db.query(
      `SELECT routine_name FROM workouts
        WHERE status = 'completed' AND date >= $1::date ORDER BY date`,
      [currentWeekStart()]
    ),
  ]);

  const nights = beds.rows.map((r) => {
    const delta = bedMinutes(r.bed) - anchor;
    return { date: r.date, when: whenLabel(String(r.date)), bed: r.bed, wake: r.wake,
             minutes_vs_anchor: delta, within_anchor: Math.abs(delta) <= tol };
  });
  const last7 = nights.filter((n) => n.date >= addDaysIso(today(), -7));

  const days = movement.rows.map((r) => ({
    date: r.date,
    met: r.activity || r.gym || (r.steps != null && Number(r.steps) >= 8000),
  }));
  // Streak counts back from yesterday — today isn't a miss while it's still in progress.
  let streak = 0;
  for (const d of days.filter((x) => x.date < today())) {
    if (d.met) streak += 1;
    else break;
  }

  return {
    targets: PROTOCOL_TARGETS,
    bedtime: {
      last_night: nights[0] || null,
      nights_tracked_last7: last7.length,
      nights_within_anchor_last7: last7.filter((n) => n.within_anchor).length,
      last_14_nights: nights,
    },
    movement: {
      today_met_so_far: days[0]?.met ?? false,
      current_streak_days: streak,
      last_14_days: days,
    },
    this_week: {
      endurance_sessions: endurance.rows[0].n,
      gym_sessions: gym.rows.map((r) => r.routine_name),
    },
  };
}

// ---------------------------------------------------------------- bundles

async function buildDailyBundle() {
  const [ready, load, acts, strength, next, weight, checks, advice, adhere, fresh, protocol] =
    await Promise.all([
      readiness(10), loadBlock(14), recentActivities(14), strengthSessions(14),
      nextSession(), bodyweight(30), checkins(14), pastAdvice('daily', 3),
      buildAdherence(14), dataFreshness(), protocolStatus(),
    ]);
  return {
    generated_for: today(),
    today: todayBlock(),
    readiness: ready,
    training_load: load,
    activities_14d: acts,
    strength_14d: strength,
    next_session: next,
    bodyweight_30d: weight,
    checkins_14d: checks,
    recent_advice: advice,
    adherence_14d: adhere,
    protocol,
    data_freshness: fresh,
  };
}

async function buildWeeklyBundle() {
  const [ready, load, acts, strength, next, weight, checks, daily, weekly, adhere, fresh, protocol] =
    await Promise.all([
      readiness(28), loadBlock(42), recentActivities(42), strengthSessions(42),
      nextSession(), bodyweight(90), checkins(28), pastAdvice('daily', 7),
      pastAdvice('weekly', 2), buildAdherence(28), dataFreshness(), protocolStatus(),
    ]);
  return {
    generated_for: today(),
    today: todayBlock(),
    week_ending: today(),
    readiness: ready,
    training_load: load,
    activities_42d: acts,
    strength_42d: strength,
    next_session: next,
    bodyweight_90d: weight,
    checkins_28d: checks,
    recent_daily_advice: daily,
    recent_weekly_advice: weekly,
    adherence_28d: adhere,
    protocol,
    data_freshness: fresh,
  };
}

module.exports = {
  protocolStatus,
  buildDailyBundle,
  buildWeeklyBundle,
  buildAdherence,
  // Individual blocks, exported for the MCP server — its tools must serve the same
  // numbers the coach reasons over, so they call these rather than re-querying.
  readiness,
  loadBlock,
  recentActivities,
  strengthSessions,
  nextSession,
  bodyweight,
  checkins,
  pastAdvice,
  dataFreshness,
};
