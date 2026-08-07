const db = require('../db');
const { todayInAppTimezone } = require('./dates');

// The chat's context bundle.
//
// Deliberately smaller than the one coach_context.py builds for the scheduled runs.
// That bundle is ~4.4k tokens because a daily readiness call has to weigh everything;
// a chat turn is answering one question and is paid for on every message, so it gets
// the recent picture only. If a question genuinely needs six weeks of history, the
// weekly review is where that lives.
//
// Every window anchors to the app's calendar day rather than Postgres CURRENT_DATE:
// Neon is UTC, which puts a Melbourne morning a day behind. Same rule as util/dates.js.
async function buildChatContext() {
  const today = todayInAppTimezone();

  const [night, baseline, load, activities, strength, checkins, advice, freshness] =
    await Promise.all([
      // The most recent row that actually holds a night — the newest row is a stub
      // until the watch syncs. Same reasoning as GET /coach/readiness.
      db.query(
        `SELECT date, body_battery_at_wake, sleep_score, sleep_secs, sleep_deep_secs,
                sleep_rem_secs, resting_hr, stress_avg, steps
           FROM wellness_daily
          WHERE sleep_score IS NOT NULL OR body_battery_at_wake IS NOT NULL
          ORDER BY date DESC LIMIT 1`
      ),
      db.query(
        `SELECT ROUND(AVG(body_battery_at_wake)) AS body_battery_at_wake,
                ROUND(AVG(sleep_score))          AS sleep_score,
                ROUND(AVG(resting_hr))           AS resting_hr,
                ROUND(AVG(stress_avg))           AS stress_avg
           FROM wellness_daily WHERE date >= $1::date - 10`,
        [today]
      ),
      db.query(
        `SELECT date, ROUND(ctl, 1) AS ctl, ROUND(atl, 1) AS atl, ROUND(tsb, 1) AS tsb
           FROM training_load WHERE date >= $1::date - 14 ORDER BY date DESC`,
        [today]
      ),
      db.query(
        `SELECT date, type, moving_time, ROUND(distance) AS distance_m, average_hr,
                ROUND(training_load) AS training_load
           FROM activities WHERE date >= $1::date - 14 ORDER BY start_date_local DESC`,
        [today]
      ),
      db.query(
        `SELECT w.date, w.routine_name, w.duration_minutes,
                COUNT(*) FILTER (WHERE s.set_type <> 'warmup')::int AS working_sets,
                ROUND(SUM(s.weight_kg * s.reps) FILTER (WHERE s.set_type <> 'warmup')) AS volume_kg,
                (SELECT sf.rpe FROM session_feel sf WHERE sf.workout_id = w.id) AS rpe
           FROM workouts w
           JOIN workout_exercises we ON we.workout_id = w.id
           JOIN workout_sets s ON s.workout_exercise_id = we.id
          WHERE w.status = 'completed' AND w.date >= $1::date - 14
          GROUP BY w.id, w.date, w.routine_name, w.duration_minutes
          ORDER BY w.date DESC`,
        [today]
      ),
      db.query(
        `SELECT date, mood, energy, soreness, note FROM checkins
          WHERE date >= $1::date - 14 ORDER BY date DESC`,
        [today]
      ),
      db.query(
        `SELECT kind, for_date, advice FROM coach_advice
          ORDER BY for_date DESC, id DESC LIMIT 4`
      ),
      db.query(
        `SELECT source,
                ROUND(EXTRACT(EPOCH FROM (NOW() - last_success)) / 3600)::int AS hours_ago
           FROM sync_state ORDER BY source`
      ),
    ]);

  return {
    today,
    last_night: night.rows[0] || null,
    baseline_10d: baseline.rows[0] || null,
    training_load_14d: load.rows,
    activities_14d: activities.rows,
    strength_14d: strength.rows,
    checkins_14d: checkins.rows,
    recent_advice: advice.rows,
    data_freshness: freshness.rows,
  };
}

// Did the advice land? Each past daily call paired with what actually happened that day.
// This is the join that makes the coach answerable for its own calls — without it, an
// assistant that says "go easy" every day looks exactly like one that reads the data.
async function buildAdherence(days = 28) {
  const { rows } = await db.query(
    `SELECT ca.for_date,
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
      ORDER BY ca.for_date DESC`,
    [days, todayInAppTimezone()]
  );
  return rows;
}

module.exports = { buildChatContext, buildAdherence };
