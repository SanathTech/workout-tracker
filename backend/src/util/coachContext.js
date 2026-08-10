const db = require('../db');
const { todayInAppTimezone } = require('./dates');

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
  const { rows } = await db.query(
    `SELECT date, type, name, moving_time, ROUND(distance) AS distance_m,
            average_hr, ROUND(training_load) AS training_load
       FROM activities WHERE date >= $1::date - $2::int ORDER BY start_date_local DESC`,
    [today(), days]
  );
  return rows;
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
            (SELECT sf.rpe FROM session_feel sf WHERE sf.workout_id = w.id) AS rpe
       FROM workouts w
       JOIN workout_exercises we ON we.workout_id = w.id
       JOIN workout_sets s ON s.workout_exercise_id = we.id
      WHERE w.status = 'completed' AND w.date >= $1::date - $2::int
      GROUP BY w.id, w.date, w.routine_name, w.duration_minutes
      ORDER BY w.date DESC`,
    [today(), days]
  );
  return rows;
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
  return rows;
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
  return rows;
}

// ---------------------------------------------------------------- bundles

async function buildDailyBundle() {
  const [ready, load, acts, strength, next, weight, checks, advice, adhere, fresh] =
    await Promise.all([
      readiness(10), loadBlock(14), recentActivities(14), strengthSessions(14),
      nextSession(), bodyweight(30), checkins(14), pastAdvice('daily', 3),
      buildAdherence(14), dataFreshness(),
    ]);
  const now = new Date();
  return {
    generated_for: today(),
    weekday: now.toLocaleDateString('en-AU', { weekday: 'long', timeZone: 'Australia/Melbourne' }),
    readiness: ready,
    training_load: load,
    activities_14d: acts,
    strength_14d: strength,
    next_session: next,
    bodyweight_30d: weight,
    checkins_14d: checks,
    recent_advice: advice,
    adherence_14d: adhere,
    data_freshness: fresh,
  };
}

async function buildWeeklyBundle() {
  const [ready, load, acts, strength, next, weight, checks, daily, weekly, adhere, fresh] =
    await Promise.all([
      readiness(28), loadBlock(42), recentActivities(42), strengthSessions(42),
      nextSession(), bodyweight(90), checkins(28), pastAdvice('daily', 7),
      pastAdvice('weekly', 2), buildAdherence(28), dataFreshness(),
    ]);
  return {
    generated_for: today(),
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
    data_freshness: fresh,
  };
}

// The chat's bundle: deliberately smaller than the scheduled ones. A daily readiness
// call has to weigh everything; a chat turn answers one question and pays for its
// context on every message. Questions needing six weeks of history are what the
// weekly review is for.
async function buildChatContext() {
  const [ready, load, acts, strength, checks, advice, fresh] = await Promise.all([
    readiness(10), loadBlock(14), recentActivities(14), strengthSessions(14),
    checkins(14), pastAdvice('daily', 2).then(async (d) => [
      ...d, ...(await pastAdvice('weekly', 1)),
    ]),
    dataFreshness(),
  ]);
  return {
    today: today(),
    readiness: ready,
    training_load_14d: load,
    activities_14d: acts,
    strength_14d: strength,
    checkins_14d: checks,
    recent_advice: advice,
    data_freshness: fresh.map(({ source, hours_ago }) => ({ source, hours_ago })),
  };
}

module.exports = {
  buildDailyBundle,
  buildWeeklyBundle,
  buildChatContext,
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
