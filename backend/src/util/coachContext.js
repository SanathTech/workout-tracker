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
               detail: '1km steady, freestyle/breaststroke alternating every 50m. Then ~15min sauna and the dog walk' },
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
            (SELECT json_agg(json_build_object('exercise', e2.name, 'note', TRIM(we2.notes))
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
