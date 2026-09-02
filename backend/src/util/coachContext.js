const db = require('../db');
const { todayInAppTimezone, currentWeekStart } = require('./dates');
const { LOAD_JOINS, SET_VOLUME } = require('./volume');

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
  Tuesday: 'easy run 30-45min, finishing with 4-6 strides',
  Wednesday: 'swim — a fixture, plus sauna and dog walk',
  Thursday: 'gym (next in the A->B->C cycle)',
  Friday: 'recovery walk',
  Saturday: 'gym (next in the A->B->C cycle)',
  Sunday: 'longer easy run 45-60min or a ride',
};

// The same template as RHYTHM, but structured — the app renders from this, the coach
// reads the prose. `kind` drives the icon and the colour; `detail` is what he needs in
// order to prepare the day (kit, timing, the HR lid) rather than a restatement of the
// title. Gym days deliberately carry no detail here: which routine lands on Thursday
// depends on where the A->B->C cycle stands, so it is resolved per-week in weekPlan().
const PLAN = {
  Monday:    { kind: 'gym',  title: 'Gym' },
  Tuesday:   { kind: 'run',  title: 'Easy run + strides',
               detail: '30-45min at HR 145-153 (ceiling 153), then 4-6 x 20sec strides with 60-90sec walk recovery' },
  Wednesday: { kind: 'swim', title: 'Swim + sauna + walk',
               detail: '~35min continuous. Slow the freestyle down and hold it longer between breaststroke recoveries — distance is the result, not the target. Then ~15min sauna and the dog walk' },
  Thursday:  { kind: 'gym',  title: 'Gym' },
  Friday:    { kind: 'walk', title: 'Recovery walk', detail: '20-30min easy' },
  Saturday:  { kind: 'gym',  title: 'Gym' },
  Sunday:    { kind: 'run',  title: 'Long easy run or ride',
               detail: '45-60min at HR 145-153 (ceiling 153)' },
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

// The top of his Zone 2 (from intervals.icu: LTHR 172, max 190 — observed, not a
// formula). Exported so the axis label and the coach's grading cite one constant.
const HR_CEILING = 153;

// generate_series drives the row set so untracked days arrive as nulls rather than
// vanishing. A missing night has to stay visible: dropping the row would close the gap
// and draw a smooth line through a night the watch never recorded, which reads as data.
//
// The series ends YESTERDAY, deliberately. Garmin fills today's row as the day happens,
// so at 10am it holds a part-day of steps and a stress average over three waking hours.
// Ending on it put "245 steps" and "stress 14" at the head of a 30-day trend while the
// readiness card, reading the last complete night, showed 12,926 and 35 — the same two
// metrics disagreeing with themselves on one screen.
async function wellnessHistory(days = 30) {
  const { rows } = await db.query(
    `SELECT d::date AS date, w.body_battery_at_wake, w.sleep_score, w.sleep_secs,
            w.resting_hr, w.stress_avg, w.steps
       FROM generate_series($1::date - $2::int, $1::date - 1, '1 day') d
       LEFT JOIN wellness_daily w ON w.date = d::date
      ORDER BY d`,
    [today(), Math.max(days, 1)]
  );
  return rows;
}

// CTL/ATL/TSB straight from the table intervals.icu populates. No generate_series here:
// the load model is continuous by construction — every day has a row once syncing has
// started — and a null would break the chart's area fill rather than tell the truth.
//
// `days` is a lookback of that many days ending today, and the series ENDS today.
// intervals.icu publishes a row for tomorrow — where form lands if he trains nothing —
// and this used to return it on the grounds that where form is heading is worth drawing.
// It is, but not on this chart and not undifferentiated: it put fitness and fatigue
// figures against a day that had not happened, and disagreed with the legend below it
// about where the line ended. Same `date <= today` bound loadBlock() already applies.
async function loadHistory(days = 90) {
  const { rows } = await db.query(
    `SELECT date, ROUND(ctl, 1) AS ctl, ROUND(atl, 1) AS atl, ROUND(tsb, 1) AS tsb,
            ROUND(ramp_rate, 2) AS ramp_rate
       FROM training_load
      WHERE date >= $1::date - $2::int AND date <= $1::date
      ORDER BY date`,
    [today(), Math.max(days - 1, 0)]
  );
  return rows;
}

// Only runs, and only the over-ceiling minutes — the number the weekly review grades
// him on. Whole-session average HR is the misleading one: a run/walk session's walk
// reps drag it down and hide long stretches at threshold.
//
// `days` stays a plain lookback window here rather than a row count: runs are sparse,
// so the number of rows is whatever he ran, and an off-by-one on the boundary date is
// the only thing at stake.
async function runDiscipline(days = 42) {
  const { rows } = await db.query(
    `SELECT date, name, moving_time, ROUND(distance) AS distance_m, average_hr,
            (SELECT ROUND(SUM(z) / 60.0, 1)
               FROM unnest(hr_zone_times[3:]) AS z) AS minutes_over_hr_ceiling
       FROM activities
      WHERE type IN ('Run', 'VirtualRun') AND date >= $1::date - $2::int
      ORDER BY date`,
    [today(), days]
  );
  return labelRows(rows);
}

// The standing template scored against what actually happened, Monday to Sunday of the
// current week. This is the honest form of "adherence": it states the slot and what the
// day contained, and leaves days that have not arrived yet as `upcoming` rather than
// counting them as misses — a Sunday run cannot be missed at 10am on Sunday.
async function weekVsRhythm() {
  const start = currentWeekStart();
  const [acts, gym] = await Promise.all([
    db.query(
      `SELECT date, type, moving_time FROM activities
        WHERE date >= $1::date ORDER BY start_date_local`,
      [start]
    ),
    db.query(
      `SELECT date, routine_name FROM workouts
        WHERE status = 'completed' AND date >= $1::date ORDER BY date`,
      [start]
    ),
  ]);

  const iso = today();
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const date = addDaysIso(start, i);
    const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
    const did = [
      ...gym.rows.filter((r) => String(r.date).slice(0, 10) === date).map((r) => r.routine_name),
      ...acts.rows
        .filter((r) => String(r.date).slice(0, 10) === date && r.type !== 'WeightTraining')
        .map((r) => r.type),
    ];
    days.push({
      date,
      weekday,
      slot: RHYTHM[weekday],
      did,
      met: did.length > 0,
      upcoming: date > iso,
      is_today: date === iso,
    });
  }
  // Today is excluded from the score as well as the future: at 10am on Sunday the
  // Sunday run has not been missed, it has not happened yet. Counting it would open
  // every day on a miss and close it on a win, which is noise, not information.
  const scored = days.filter((d) => !d.upcoming && !d.is_today);
  return {
    week_start: start,
    days,
    slots_met: scored.filter((d) => d.met).length,
    slots_scored: scored.length,
  };
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

async function checkins(days = 14) {
  const { rows } = await db.query(
    `SELECT date, mood, energy, soreness, note FROM checkins
      WHERE date >= $1::date - $2::int ORDER BY date DESC`,
    [today(), days]
  );
  return labelRows(rows);
}

// Every note he has written, newest first, carrying the one fact the niggle rule turns
// on: how many notes came AFTER this one. The rule — "a newer note that does not mention
// an earlier niggle means it resolved" — is a date comparison, and the model kept getting
// it wrong: it carried a 13 Aug knee through two later sessions that never mention it,
// and on 17 Aug still listed shoulder clicks that the 13 Aug note had explicitly cleared
// ("No clicking in shoulders during pull ups"). It was not applying the rule at all, just
// keeping the newest three or four items and letting the rest fall off by attrition.
// Derivable, so we derive it, exactly as with every other date in the bundle.
async function noteLedger(days = 21) {
  const [sessions, exercises, checks] = await Promise.all([
    db.query(
      `SELECT date, routine_name, TRIM(notes) AS note FROM workouts
        WHERE status = 'completed' AND NULLIF(TRIM(notes), '') IS NOT NULL
          AND date >= $1::date - $2::int`,
      [today(), days]
    ),
    db.query(
      `SELECT w.date, e.name AS exercise, TRIM(we.notes) AS note
         FROM workout_exercises we
         JOIN workouts w  ON w.id = we.workout_id
         JOIN exercises e ON e.id = we.exercise_id
        WHERE w.status = 'completed' AND NULLIF(TRIM(we.notes), '') IS NOT NULL
          AND w.date >= $1::date - $2::int`,
      [today(), days]
    ),
    db.query(
      `SELECT date, TRIM(note) AS note FROM checkins
        WHERE NULLIF(TRIM(note), '') IS NOT NULL AND date >= $1::date - $2::int`,
      [today(), days]
    ),
  ]);

  const entries = [
    ...sessions.rows.map((r) => ({ date: r.date, source: `gym note (${r.routine_name})`, note: r.note })),
    ...exercises.rows.map((r) => ({ date: r.date, source: `exercise note (${r.exercise})`, note: r.note })),
    ...checks.rows.map((r) => ({ date: r.date, source: 'check-in', note: r.note })),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const days10 = entries.map((e) => String(e.date).slice(0, 10));
  return entries.map((e, i) => ({
    ...e,
    when: whenLabel(String(e.date)),
    // Strictly-later notes only. Two notes from the same session are not newer than each
    // other, so an index would wrongly settle one against the other.
    notes_since: days10.filter((d) => d > days10[i]).length,
  }));
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
  weight_trend: 'goal 93.5kg AS A WEEKLY MEAN, never a morning reading. Judge over a fortnight of weekly means; never faster than 0.4kg/week (quicker spends lean tissue); two consecutive flat weekly means is the signal to tighten a lever, and one high morning is noise.',
  watch_worn_nightly: 'sleep tracked every night — untracked nights blind the whole readiness picture',
};

const MOVEMENT_MIN_SECONDS = 25 * 60;

// The weight goal is a WEEKLY MEAN, and that is the whole point rather than a detail:
// the daily scale swung 94.79 -> 96.10 on consecutive days inside a fortnight that was,
// on average, essentially flat. Computing "distance to goal" from the latest reading
// would reproduce the exact failure the goal exists to prevent — talking him out of a
// plan that is working, on the strength of one morning's hydration.
//
// 93.5 is where he actually sat through May and June. It is deliberately NOT the 92.03
// of 16 June: the scale carried that single weigh-in forward for eight days, and my own
// notes had mistaken the repetition for a weight he held. A target he has demonstrably
// lived at also beats one derived from the BIA body-fat percentage, which wobbles a
// full point on hydration alone.
const WEIGHT_GOAL_KG = 93.5;

// Above this rate he is spending lean tissue, which costs more on the bike and run legs
// than the weight saves. It is a ceiling on loss, not a target.
const MAX_LOSS_KG_PER_WEEK = 0.4;

// A "mean" over one or two readings is not a mean, it is a reading wearing a disguise.
// Below this the week reports null and the UI says nothing rather than something wrong.
const MIN_READINGS_PER_WEEK = 3;

// Minutes past noon, so a 01:30 bedtime sorts after 23:30 instead of before it.
function bedMinutes(hm) {
  const [h, m] = hm.split(':').map(Number);
  return ((h + 12) % 24) * 60 + m;
}

function addDaysIso(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

// This week's mean against last week's, and both against the goal. Two 7-day windows
// ending today, from the same COALESCE(manual, garmin) source the weight row uses, so
// the goal line and the weight line can never disagree about what he weighs.
//
// Note the scale carries a reading forward between real weigh-ins, which drags a mean
// toward a stale value on any week he skips days. He has weighed daily since 11 Aug so
// it does not currently bite; the readings count is served alongside each mean so a
// thin week is visible rather than silently averaged.
async function weightGoal() {
  const { rows } = await db.query(
    `WITH src AS (
       SELECT d::date AS date,
              COALESCE(b.weight_kg, t.weight_kg)::numeric AS kg,
              CASE WHEN d::date > $1::date - 7 THEN 0 ELSE 1 END AS bucket
         FROM generate_series($1::date - 13, $1::date, '1 day') d
         LEFT JOIN bodyweight_logs b ON b.date = d::date
         LEFT JOIN training_load   t ON t.date = d::date
        WHERE COALESCE(b.weight_kg, t.weight_kg) IS NOT NULL
     )
     SELECT bucket, COUNT(*)::int AS n, ROUND(AVG(kg), 2)::float8 AS mean
       FROM src GROUP BY bucket`,
    [today()]
  );

  const bucket = (b) => rows.find((r) => Number(r.bucket) === b) || null;
  const meanOf = (b) => (b && b.n >= MIN_READINGS_PER_WEEK ? Number(b.mean) : null);
  const thisWeek = bucket(0);
  const prevWeek = bucket(1);
  const week_mean = meanOf(thisWeek);
  const prev_week_mean = meanOf(prevWeek);

  const change_kg = week_mean != null && prev_week_mean != null
    ? Number((week_mean - prev_week_mean).toFixed(2))
    : null;

  // Flat is a band, not a point: weekly means carry roughly +/-0.1kg of noise, so
  // anything inside that is "no move" and must not be reported as progress either way.
  let pace = null;
  if (change_kg != null) {
    if (change_kg < -MAX_LOSS_KG_PER_WEEK) pace = 'too_fast';
    else if (change_kg <= -0.1) pace = 'losing';
    else if (change_kg < 0.1) pace = 'flat';
    else pace = 'gaining';
  }

  return {
    goal_kg: WEIGHT_GOAL_KG,
    week_mean,
    week_readings: thisWeek ? thisWeek.n : 0,
    prev_week_mean,
    prev_week_readings: prevWeek ? prevWeek.n : 0,
    change_kg,
    to_goal_kg: week_mean != null ? Number((week_mean - WEIGHT_GOAL_KG).toFixed(2)) : null,
    pace,
    max_loss_kg_per_week: MAX_LOSS_KG_PER_WEEK,
  };
}

async function protocolStatus() {
  const anchor = bedMinutes(PROTOCOL_TARGETS.bedtime_anchor);
  const tol = PROTOCOL_TARGETS.bedtime_tolerance_minutes;

  const [beds, movement, endurance, gym, weight] = await Promise.all([
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
    weightGoal(),
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
    weight,
  };
}

// Runs and swims as sessions, with the fields that decide whether one went well —
// most of which were already synced and simply never read: the ingest stores the whole
// intervals.icu payload in `raw`, so cadence and elevation come out of it here rather
// than needing a schema change, an ingest change, or a re-sync.
//
// `average_cadence` is per-LEG on a run (69.3 next to a 0.91m step length and 2.07 m/s
// is 138 steps per minute, not 69) and per-minute strokes on a swim, so only runs are
// doubled. `average_stride` is likewise two different measurements wearing one name:
// step length on a run, distance per stroke on a swim — which is the swim economy
// number, and the one he was counting by hand before we found Garmin already had it.
//
// Cadence is served WITHOUT a threshold on purpose. It is a whole-session average and his
// runs follow a run/walk program, so every walked minute at ~110spm pulls it down — a low
// number means "more walk breaks" at least as often as "short turnover", and the hilliest
// session, where he walked the climbs, was the one a 145 threshold falsely flagged. The
// running-only figure needs the per-second cadence stream, which is not ingested. The
// persona already states this rule for HR; it applies here for exactly the same reason.

// A numeric cast that yields NULL instead of throwing. Inlined per query rather than
// created as a database function: this file owns no migrations, and a read path should
// not depend on server-side objects it cannot create.
// Parenthesised: ->> binds looser than ::, so raw->>'k'::numeric would cast the KEY.
const NUM = `CASE WHEN ($t$) ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN ($t$)::numeric END`;
const num = (expr) => NUM.replaceAll('$t$', expr);

async function enduranceSessions(days = 42) {
  const { rows } = await db.query(
    `SELECT date, type, name, moving_time, ROUND(distance) AS distance_m, average_hr,
            ROUND(training_load) AS training_load,
            -- The raw column is a third-party payload, so every cast is guarded: one bad
            -- value would throw and take the WHOLE Trends tab down with it — sleep,
            -- protocol and the week all share this endpoint. A bad field reads as absent.
            CASE WHEN type IN ('Run', 'VirtualRun')
                 THEN ROUND(${num("raw->>'average_cadence'")} * 2)
                 ELSE ROUND(${num("raw->>'average_cadence'")}) END AS cadence,
            ROUND(${num("raw->>'total_elevation_gain'")}) AS elevation_m,
            ROUND(${num("raw->>'average_stride'")}, 2) AS stride_m,
            -- Heart-rate recovery: bpm shed in the 60s after the session's HR peak. The
            -- cleanest aerobic-fitness marker in this list — it climbs as the base
            -- builds, well before pace-at-HR moves. Ours (from the stream) exists on
            -- every run with a real peak; intervals' is the fallback for pre-stream rows.
            COALESCE((stream_summary->>'hrr_60')::int,
                     ROUND(${num("raw->'icu_hrr'->>'hrr'")})::int) AS hrr,
            -- Aerobic decoupling: how much more heart the second half cost per metre
            -- than the first, over running samples with strides excluded. ~8-10% is
            -- normal early base; <5% is a built base. THE number that shrinks as the
            -- engine grows — and it doubles as a pacing report (a fast first km reads
            -- as high drift; the 30 Aug run was 13.2% for exactly that reason).
            (stream_summary->>'decoupling_pct')::numeric AS decoupling_pct,
            -- The per-effort figures, computed from the per-second streams at sync
            -- time (see schema_hub on stream_summary). run_cadence/run_pace describe
            -- the RUNNING, not the run/walk blend — the whole-session cadence above
            -- stays served for trend continuity with pre-stream history, but these are
            -- the honest numbers. No guards: our sync wrote this JSON, not a third party.
            (stream_summary->'run_only'->>'cadence_spm')::int AS run_cadence,
            (stream_summary->'run_only'->>'pace_s_per_km')::int AS run_pace_s,
            (stream_summary->'run_only'->>'stride_m')::numeric AS run_stride_m,
            (stream_summary->'run_only'->>'share')::numeric AS run_share,
            CASE WHEN jsonb_array_length(COALESCE(stream_summary->'efforts', '[]'::jsonb)) > 0
                 THEN stream_summary->'efforts' END AS efforts,
            (stream_summary->'rest'->>'total_s')::int AS swim_rest_s,
            (stream_summary->'moving'->>'pace_s_per_100m')::int AS swim_moving_pace_s,
            (SELECT ROUND(SUM(z) / 60.0, 1)
               FROM unnest(hr_zone_times[3:]) AS z) AS minutes_over_hr_ceiling
       FROM activities
      WHERE type IN ('Run', 'VirtualRun', 'Swim') AND date >= $1::date - $2::int
      ORDER BY date DESC`,
    [today(), days]
  );
  return labelRows(rows);
}

// The week as a plan rather than a scorecard — what is on each day, resolved far enough
// ahead that he can pack a bag on Wednesday night for Thursday. weekVsRhythm() answers
// "did I hit the template"; this answers "what am I doing", which is the question he was
// asking every morning.
//
// Everything here is computed. No model writes this: a plan he uses to prepare has to be
// right, and the gym cycle is a modulo, not a judgement call.
async function weekPlan() {
  const start = currentWeekStart();
  const iso = today();

  const [acts, gym, program] = await Promise.all([
    db.query(
      `SELECT date, type, moving_time, ROUND(distance) AS distance_m, average_hr
         FROM activities WHERE date >= $1::date AND date < $1::date + 7
        ORDER BY start_date_local`,
      [start]
    ),
    db.query(
      `SELECT w.id, w.date, w.routine_name, w.status,
              COUNT(*) FILTER (WHERE s.set_type <> 'warmup')::int AS working_sets,
              (SELECT sf.rpe FROM session_feel sf WHERE sf.workout_id = w.id) AS rpe
         FROM workouts w
         LEFT JOIN workout_exercises we ON we.workout_id = w.id
         LEFT JOIN workout_sets s ON s.workout_exercise_id = we.id
        WHERE w.status IN ('completed', 'skipped')
          AND w.date >= $1::date AND w.date < $1::date + 7
        GROUP BY w.id ORDER BY w.date`,
      [start]
    ),
    db.query(`SELECT id FROM programs WHERE status = 'active' LIMIT 1`),
  ]);

  // Where the A->B->C cycle stands right now, and the ordered ring to walk forward.
  let ring = [];
  let cursor = 0;
  if (program.rows.length) {
    const [routines, done] = await Promise.all([
      db.query(
        `SELECT id, name FROM routines WHERE program_id = $1 AND deleted_at IS NULL
          ORDER BY sort_order, id`,
        [program.rows[0].id]
      ),
      db.query(
        `SELECT COUNT(*)::int AS n FROM workouts
          WHERE program_id = $1 AND status IN ('completed', 'skipped')`,
        [program.rows[0].id]
      ),
    ]);
    ring = routines.rows;
    cursor = ring.length ? done.rows[0].n % ring.length : 0;

    // The main lifts, so a gym day says what he is actually walking in to do. This is
    // the whole point of looking at Thursday on Wednesday night.
    if (ring.length) {
      const mains = await db.query(
        `SELECT re.routine_id, e.name FROM routine_exercises re
           JOIN exercises e ON e.id = re.exercise_id
          WHERE re.routine_id = ANY($1::int[]) AND re.is_main
          ORDER BY re.routine_id, re.sort_order, re.id`,
        [ring.map((r) => r.id)]
      );
      for (const r of ring) {
        r.mains = mains.rows.filter((m) => m.routine_id === r.id).map((m) => m.name).join(' · ');
      }
    }
  }

  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const date = addDaysIso(start, i);
    const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
    const template = PLAN[weekday];
    const state = date < iso ? 'past' : date === iso ? 'today' : 'upcoming';

    const sessions = gym.rows.filter((r) => String(r.date).slice(0, 10) === date);
    const moves = acts.rows.filter(
      (r) => String(r.date).slice(0, 10) === date && r.type !== 'WeightTraining'
    );

    const actual = [
      ...sessions.map((r) => ({
        kind: 'gym',
        label: r.status === 'skipped' ? `${r.routine_name} — skipped` : r.routine_name,
        meta: r.status === 'skipped'
          ? null
          : [`${r.working_sets} sets`, r.rpe != null ? `RPE ${r.rpe}` : null].filter(Boolean).join(' · '),
        skipped: r.status === 'skipped',
      })),
      ...moves.map((r) => ({
        kind: r.type === 'Swim' ? 'swim' : r.type === 'Walk' ? 'walk' : 'run',
        label: r.type,
        meta: [
          r.distance_m ? `${(Number(r.distance_m) / 1000).toFixed(2)}km` : null,
          r.moving_time ? `${Math.round(r.moving_time / 60)}min` : null,
          r.average_hr ? `HR ${r.average_hr}` : null,
        ].filter(Boolean).join(' · '),
      })),
    ];

    // A gym slot that has already been logged shows what he did; one still ahead of him
    // takes the next routine off the ring. Today counts as ahead until it is logged —
    // at 7am on Thursday the session has not happened, so it is still the plan.
    let planned = { ...template };
    if (template.kind === 'gym') {
      // Routine names already read "Day A — Squat / Push", so they are the title on
      // their own; `kind` is what tells the UI it is a gym day.
      const named = sessions.length
        ? ring.find((r) => r.name === sessions[0].routine_name)
        : null;
      if (sessions.length) {
        planned.title = sessions[0].routine_name;
        planned.detail = named?.mains || null;
      } else if (state === 'past') {
        planned.title = 'Gym — not logged';
      } else if (ring.length) {
        const routine = ring[cursor % ring.length];
        cursor += 1;
        planned.title = routine.name;
        planned.detail = routine.mains || null;
        planned.routine_id = routine.id;
      }
    }

    days.push({
      date,
      weekday,
      when: whenLabel(date),
      state,
      planned,
      actual,
      done: actual.some((a) => !a.skipped),
    });
  }

  return { week_start: start, today: iso, days };
}

// ---------------------------------------------------------------- bundles

async function buildDailyBundle() {
  const [ready, load, acts, strength, next, weight, checks, advice, adhere, fresh, protocol, notes] =
    await Promise.all([
      readiness(10), loadBlock(14), recentActivities(14), strengthSessions(14),
      nextSession(), bodyweight(30), checkins(14), pastAdvice('daily', 3),
      buildAdherence(14), dataFreshness(), protocolStatus(), noteLedger(21),
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
    note_ledger: notes,
    recent_advice: advice,
    adherence_14d: adhere,
    protocol,
    data_freshness: fresh,
  };
}

async function buildWeeklyBundle() {
  const [ready, load, acts, strength, next, weight, checks, daily, weekly, adhere, fresh, protocol, notes] =
    await Promise.all([
      readiness(28), loadBlock(42), recentActivities(42), strengthSessions(42),
      nextSession(), bodyweight(90), checkins(28), pastAdvice('daily', 7),
      pastAdvice('weekly', 2), buildAdherence(28), dataFreshness(), protocolStatus(),
      noteLedger(42),
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
    note_ledger: notes,
    recent_daily_advice: daily,
    recent_weekly_advice: weekly,
    adherence_28d: adhere,
    protocol,
    data_freshness: fresh,
  };
}

module.exports = {
  weekPlan,
  enduranceSessions,
  noteLedger,
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
  // Series for the Trends tab.
  HR_CEILING,
  wellnessHistory,
  loadHistory,
  runDiscipline,
  weekVsRhythm,
};
