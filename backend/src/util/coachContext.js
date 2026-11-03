const db = require('../db');
const { todayInAppTimezone } = require('./dates');
const { LOAD_JOINS, SET_VOLUME } = require('./volume');
const { rotation } = require('./rotation');

// The read-only training data behind the claude.ai MCP connector (routes/mcp.js). The
// scheduled coach, its prompts and bundles went in the 2026-11-03 strip-back; the
// connector stays, so he can still ask Claude about his training.
//
// Every window anchors to the app's calendar day rather than Postgres CURRENT_DATE:
// Neon is UTC, which puts a Melbourne morning a day behind. Same rule as util/dates.js.
//
// ⛔ No HRV anywhere. The vívosmart 5 does not record it.
// Readiness is Body Battery at wake + sleep score/stages + RHR trend + stress + TSB.

const today = () => todayInAppTimezone();

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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

// Last measured night plus the trailing window it has to be read against. A single
// night's Body Battery means nothing without the baseline — 61 is a bad morning for
// someone who wakes at 85 and a good one for someone who wakes at 40. The newest row
// is skipped when it's a stub: Garmin fills today's row as the day happens, so before
// the watch syncs it has stress and steps but no night.
async function readiness(days = 10) {
  const [latest, baseline, lastFullDay] = await Promise.all([
    db.query(
      `SELECT date, body_battery_at_wake, body_battery_high, body_battery_low,
              sleep_score, sleep_secs, sleep_deep_secs, sleep_rem_secs, sleep_awake_secs,
              resting_hr, stress_avg, steps, respiration_avg
         FROM wellness_daily
        WHERE sleep_score IS NOT NULL OR body_battery_at_wake IS NOT NULL
        ORDER BY date DESC LIMIT 1`
    ),
    // The baseline ends YESTERDAY. Today's row is a part-day, and averaging it into the
    // window it is about to be compared against both drags the average toward the
    // part-day and makes the comparison partly self-referential.
    db.query(
      `SELECT ROUND(AVG(body_battery_at_wake)) AS body_battery_at_wake,
              ROUND(AVG(sleep_score))          AS sleep_score,
              ROUND(AVG(sleep_secs))           AS sleep_secs,
              ROUND(AVG(resting_hr))           AS resting_hr,
              ROUND(AVG(stress_avg))           AS stress_avg,
              COUNT(*)::int                    AS days
         FROM wellness_daily
        WHERE date >= $1::date - $2::int AND date < $1::date`,
      [today(), days]
    ),
    db.query(
      `SELECT date, stress_avg FROM wellness_daily
        WHERE date < $1::date AND stress_avg IS NOT NULL
        ORDER BY date DESC LIMIT 1`,
      [today()]
    ),
  ]);
  // The newest recorded night is not always LAST night. wellness_daily keys a night by
  // the day he woke, and the Garmin sync can only carry a night once the watch has
  // uploaded it — on a late wake-up the freshest row is the night before. Labelled here
  // rather than left for the model to infer from a bare date, per the same rule as every
  // other date in the bundle: it is a fact we can compute, so we compute it.
  const night = latest.rows[0] || null;
  const nightIsToday = night != null && String(night.date).slice(0, 10) === today();
  // Body Battery at wake, sleep score/stages and resting HR are all settled by the time
  // he wakes. stress_avg and steps are NOT: Garmin fills today's row as the day happens,
  // so at 06:00 stress_avg averages a night of sleeping. Quoting it against a baseline
  // built from COMPLETE days reported "stress 19" on a day that finished at 44, and
  // "stress 9" on one that finished at 38 — wrong every morning, and always in the
  // reassuring direction. Same part-day hazard as the trend series below.
  const fullDay = lastFullDay.rows[0] || null;
  return {
    last_night: night
      ? { ...night,
          stress_avg: nightIsToday ? null : night.stress_avg,
          steps: nightIsToday ? null : night.steps,
          when: whenLabel(String(night.date)),
          is_last_night: nightIsToday }
      : null,
    // The most recent stress figure that covers a whole day, so it is comparable to the
    // baseline. Carries its own date label — it is usually yesterday, never "last night".
    stress_last_full_day: fullDay
      ? { date: fullDay.date, stress_avg: fullDay.stress_avg, when: whenLabel(String(fullDay.date)) }
      : null,
    [`${days}d_average`]: baseline.rows[0] || null,
  };
}

// Ordered newest-first, and `date <= today` is load-bearing: intervals.icu publishes a
// row for TOMORROW (its forecast of where form lands if he does nothing), so the newest
// row is not today's. Every caller takes rows[0] as "now" — the MCP literally returns it
// as `training_load_today` — and was reading the forecast. On 2026-08-16 that reported
// form as -1.8 when today's was -3.4.
async function loadBlock(days = 14) {
  const { rows } = await db.query(
    `SELECT date, ROUND(ctl, 1) AS ctl, ROUND(atl, 1) AS atl, ROUND(tsb, 1) AS tsb,
            ROUND(ramp_rate, 2) AS ramp_rate
       FROM training_load
      WHERE date >= $1::date - $2::int AND date <= $1::date
      ORDER BY date DESC`,
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
               FROM unnest(hr_zone_times[3:]) AS z) AS minutes_over_hr_ceiling,
            -- Per-effort figures from the streams, so the model can obey "judge the
            -- reps, not the average" with data instead of discipline. Null on
            -- pre-stream rows and non-run/swim types.
            --
            -- Efforts are CAPPED at six, plus the true count. Full arrays fed every
            -- surge of every run into the weekly prompt — a fortnight with one uneven
            -- run (14 surges) fattened the input enough to push the generation past
            -- the function's maxDuration, and the 30 Aug weekly 502'd. Six is enough
            -- to grade a stride set; the count says what was trimmed (no silent caps).
            stream_summary->'run_only' AS run_only,
            jsonb_array_length(COALESCE(stream_summary->'efforts', '[]'::jsonb)) AS efforts_count,
            CASE WHEN jsonb_array_length(COALESCE(stream_summary->'efforts', '[]'::jsonb)) > 0
                 THEN (SELECT jsonb_agg(e.val ORDER BY e.ord)
                         FROM jsonb_array_elements(stream_summary->'efforts')
                              WITH ORDINALITY AS e(val, ord)
                        WHERE e.ord <= 6) END AS efforts,
            (stream_summary->>'hrr_60')::int AS hrr_60,
            (stream_summary->>'decoupling_pct')::numeric AS decoupling_pct,
            stream_summary->'rest' AS swim_rest
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
            ROUND(SUM(${SET_VOLUME('s')}) FILTER (WHERE s.set_type <> 'warmup')) AS volume_kg,
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
            (SELECT json_agg(json_build_object('exercise', e2.name, 'note', TRIM(we2.notes))
                               ORDER BY we2.sort_order)
               FROM workout_exercises we2
               JOIN exercises e2 ON e2.id = we2.exercise_id
              WHERE we2.workout_id = w.id AND NULLIF(TRIM(we2.notes), '') IS NOT NULL
            ) AS exercise_notes
       FROM workouts w
       JOIN workout_exercises we ON we.workout_id = w.id
       JOIN workout_sets s ON s.workout_exercise_id = we.id
       ${LOAD_JOINS()}
      WHERE w.status = 'completed' AND w.date >= $1::date - $2::int
      GROUP BY w.id, w.date, w.routine_name, w.duration_minutes
      ORDER BY w.date DESC`,
    [today(), days]
  );
  return labelRows(rows);
}

// ------------------------------------------------------- series, for the Trends tab
//
// These are the only helpers here built for a screen rather than for the model. The
// difference is shape, not source: the coach gets a compact snapshot it can reason
// over in one pass, the dashboard gets one row per day so it can draw a line. Both
// read the same tables through the same date anchor, so a number can never disagree
// with itself between the tab and the morning brief.

// The same rotation GET /api/programs/active offers: the routine done longest ago.
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
    `SELECT COUNT(*)::int AS n FROM workouts WHERE program_id = $1 AND status = 'completed'`,
    [p.id]
  );
  const { byRoutine, next: nxt } = await rotation(db, p.id, routines.rows, today());

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
    next_last_done: byRoutine.get(nxt.id).last_done,
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
            CASE WHEN b.weight_kg IS NOT NULL THEN 'manual' ELSE 'garmin' END AS source,
            -- The scale's BIA estimate, reported since 2026-08-10. Guarded like every
            -- third-party field, and served as-is: it is hydration-skewed and noisy
            -- day to day, so it is a TREND instrument — the weekly drift arbitrates
            -- fat vs muscle vs water in a way the weight number alone cannot.
            ROUND(${num("t.raw->>'bodyFat'")}, 1) AS body_fat_pct
       FROM generate_series($1::date - $2::int, $1::date, '1 day') d
       LEFT JOIN bodyweight_logs b ON b.date = d::date
       LEFT JOIN training_load   t ON t.date = d::date
      WHERE COALESCE(b.weight_kg, t.weight_kg) IS NOT NULL
      ORDER BY d DESC`,
    [today(), days]
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

// A numeric cast that yields NULL instead of throwing. Inlined per query rather than
// created as a database function: this file owns no migrations, and a read path should
// not depend on server-side objects it cannot create.
// Parenthesised: ->> binds looser than ::, so raw->>'k'::numeric would cast the KEY.
const NUM = `CASE WHEN ($t$) ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN ($t$)::numeric END`;

const num = (expr) => NUM.replaceAll('$t$', expr);

module.exports = {
  readiness,
  loadBlock,
  recentActivities,
  strengthSessions,
  nextSession,
  bodyweight,
  dataFreshness,
};
