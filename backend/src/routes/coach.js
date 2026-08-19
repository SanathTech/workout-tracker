const express = require('express');
const router = express.Router();
const db = require('../db');
const { serverError } = require('../util/errors');
const { resolveWorkoutDate, todayInAppTimezone } = require('../util/dates');
const {
  buildAdherence, protocolStatus, weekVsRhythm, wellnessHistory, loadHistory,
  runDiscipline, bodyweight, weekPlan, noteLedger, enduranceSessions,
  HR_CEILING,
} = require('../util/coachContext');

// The hub tables (coach_advice, checkins, session_feel, wellness_daily, training_load)
// come from schema_hub.sql, not schema.sql. They're written by the nas-laptop timers;
// this router is the read surface plus the two things only the phone can supply —
// the daily check-in and how a session actually felt.

const RATING = (v) => Number.isInteger(v) && v >= 1 && v <= 5;

// Neon runs in UTC, so `CURRENT_DATE` is a day behind for most of a Melbourne morning
// and every window anchored to it silently shifts. Anchor to the app's calendar day
// instead — the same rule util/dates.js already enforces for workouts.date.
const anchor = () => todayInAppTimezone();

// Nullable text distinguishes "not provided" from "cleared", per the pattern in
// workouts.notes: COALESCE would read a cleared note as absent and restore the old one,
// so the caller could never erase it. Returns `undefined` when the key is absent.
function readNote(body) {
  if (!Object.prototype.hasOwnProperty.call(body, 'note')) return undefined;
  return typeof body.note === 'string' ? body.note.trim() || null : null;
}

// GET /api/coach/latest — the most recent call of each kind, for the Coach tab header.
router.get('/latest', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT DISTINCT ON (kind) kind, id, for_date, advice, markdown, model, created_at
         FROM coach_advice
        ORDER BY kind, for_date DESC, id DESC`
    );
    const byKind = Object.fromEntries(rows.map((r) => [r.kind, r]));
    res.json({ daily: byKind.daily || null, weekly: byKind.weekly || null });
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/coach/history — past calls, newest first.
router.get('/history', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const kind = req.query.kind === 'weekly' ? 'weekly' : req.query.kind === 'daily' ? 'daily' : null;
  try {
    const { rows } = await db.query(
      `SELECT id, kind, for_date, advice, markdown, model, created_at
         FROM coach_advice
        WHERE ($1::text IS NULL OR kind = $1)
        ORDER BY for_date DESC, id DESC
        LIMIT $2`,
      [kind, limit]
    );
    res.json(rows);
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/coach/readiness — the numbers behind today's call.
//
// The 10-day average travels with the reading because a single night is unreadable
// without it: Body Battery 61 is a bad morning at a baseline of 85 and a good one at 40.
// `stale_hours` is the age of the *sync*, not the data — the UI says so rather than
// rendering week-old numbers as if they were this morning's.
router.get('/readiness', async (req, res) => {
  try {
    const [latest, baseline, lastFullDay, load, freshness] = await Promise.all([
      // Garmin fills today's row as the day happens, so the newest row is a half-empty
      // stub until the watch syncs the night — no sleep, no wake battery. Rendering that
      // shows an empty "Last night" card on a morning where the data simply hasn't
      // arrived. Take the most recent row that actually contains a night; its `date` is
      // displayed, so a stale one reads as stale rather than as an outage.
      db.query(
        `SELECT date, body_battery_at_wake, body_battery_high, body_battery_low,
                sleep_score, sleep_secs, sleep_deep_secs, sleep_rem_secs, sleep_awake_secs,
                resting_hr, stress_avg, steps
           FROM wellness_daily
          WHERE sleep_score IS NOT NULL OR body_battery_at_wake IS NOT NULL
          ORDER BY date DESC LIMIT 1`
      ),
      // Baseline ends YESTERDAY. Today's row is a part-day, and averaging it into the
      // window it is about to be compared against drags the average toward the part-day.
      db.query(
        `SELECT ROUND(AVG(body_battery_at_wake)) AS body_battery_at_wake,
                ROUND(AVG(sleep_score))          AS sleep_score,
                ROUND(AVG(resting_hr))           AS resting_hr,
                ROUND(AVG(stress_avg))           AS stress_avg,
                COUNT(*)::int                    AS days
           FROM wellness_daily WHERE date >= $1::date - 10 AND date < $1::date`,
        [anchor()]
      ),
      // The most recent stress average covering a WHOLE day. Body Battery at wake, sleep
      // and resting HR are settled by the time he wakes; stress and steps are not —
      // Garmin fills today's row as the day happens, so at 06:00 stress_avg averages a
      // night of sleeping. Reading it against a baseline of complete days is how the
      // coach came to report "stress 19" on a day that finished at 44.
      db.query(
        `SELECT date, stress_avg FROM wellness_daily
          WHERE date < $1::date AND stress_avg IS NOT NULL
          ORDER BY date DESC LIMIT 1`,
        [anchor()]
      ),
      // Not simply the newest row: intervals.icu publishes tomorrow's forecast, so
      // `ORDER BY date DESC LIMIT 1` returned a projection and the card showed it as
      // today's form (2026-08-16: -1.8 displayed, -3.4 actual).
      db.query(
        `SELECT date, ROUND(ctl, 1) AS ctl, ROUND(atl, 1) AS atl, ROUND(tsb, 1) AS tsb
           FROM training_load WHERE date <= $1::date ORDER BY date DESC LIMIT 1`,
        [anchor()]
      ),
      db.query(
        `SELECT MIN(ROUND(EXTRACT(EPOCH FROM (NOW() - last_success)) / 3600))::int AS stale_hours
           FROM sync_state WHERE last_success IS NOT NULL`
      ),
    ]);
    // Whether this row is actually LAST night is decided here, not in the browser.
    // wellness_daily keys a night by the day he woke, so a row dated today is last
    // night and anything older is not — and the Garmin sync only carries a night once
    // the watch has uploaded it, so on a late wake-up the freshest row is the night
    // before. The card used to head that "Last night" regardless (2026-08-16: it
    // showed a 75 from Friday while Saturday's night was an 84).
    const night = latest.rows[0] || null;
    const nightIsToday = night != null && String(night.date).slice(0, 10) === anchor();
    const fullDay = lastFullDay.rows[0] || null;
    res.json({
      last_night: night
        ? { ...night,
            stress_avg: nightIsToday ? null : night.stress_avg,
            steps: nightIsToday ? null : night.steps }
        : null,
      is_last_night: nightIsToday,
      stress_last_full_day: fullDay,
      // Steps so far TODAY, as its own field rather than on the night object. It is a
      // part-day figure like stress, but unlike stress it is useful mid-day — it is how
      // he sees whether the 8,000-step movement target is met yet — so it is kept and
      // labelled rather than dropped.
      steps_today: nightIsToday ? night.steps : null,
      baseline_10d: baseline.rows[0] || null,
      training_load: load.rows[0] || null,
      stale_hours: freshness.rows[0]?.stale_hours ?? null,
    });
  } catch (err) {
    serverError(res, err);
  }
});

// A window length from the query string, floored at 1 and forced to a whole number.
// `Number(x) || fallback` alone lets a negative through, which inverts generate_series
// into an empty result, and a fractional one reaches a ::int cast that silently rounds.
const windowDays = (raw, fallback, max) => {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
};

// GET /api/coach/trends — one round trip for everything the Trends tab draws except
// the fitness chart.
//
// Bundled rather than split into five endpoints because the tab renders it all at once
// and it is often opened on gym wifi: five sequential round trips is five chances to
// hang. The fitness chart is the deliberate exception below — its data ships with the
// chart library, which is lazy-loaded.
router.get('/trends', async (req, res) => {
  const days = windowDays(req.query.days, 30, 180);
  try {
    const [protocol, week, wellness, weight, endurance] = await Promise.all([
      protocolStatus(),
      weekVsRhythm(),
      wellnessHistory(days),
      bodyweight(Math.max(days, 90)),
      // Replaces the runs-only over-ceiling series: same number, now one line inside a
      // session row that also carries cadence, elevation and the swim alongside it.
      enduranceSessions(42),
    ]);
    res.json({
      protocol, week, wellness, bodyweight: weight, endurance,
      hr_ceiling: HR_CEILING,
    });
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/coach/week — the standing template resolved into an actual week: what is on
// each day, which routine the A->B->C cycle puts on each gym slot, and what has already
// been logged against it. Nothing here is model-written. He was asking every morning what
// today was, and an answer he plans around has to be right rather than fluent.
//
// `latest_notes` carries only what he wrote most recently about his body — the entries
// nothing newer has superseded. Deliberately not a curated niggle list: deciding whether
// a later note settles an earlier one is the judgement that kept going wrong in the daily
// brief, so the app shows the newest thing he said and leaves the reading to him.
router.get('/week', async (req, res) => {
  try {
    const [plan, notes] = await Promise.all([weekPlan(), noteLedger(21)]);
    res.json({ ...plan, latest_notes: notes.filter((n) => n.notes_since === 0) });
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/coach/load-history — the CTL/ATL/TSB series behind the fitness chart.
// Separate from /trends so it is fetched alongside the lazy Recharts bundle rather
// than blocking the numbers above it.
router.get('/load-history', async (req, res) => {
  const days = windowDays(req.query.days, 90, 365);
  try {
    res.json(await loadHistory(days));
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/coach/checkin — today's check-in, or null if it hasn't been done.
router.get('/checkin', async (req, res) => {
  const date = resolveWorkoutDate(req.query.date);
  try {
    const { rows } = await db.query(
      `SELECT date, mood, energy, soreness, note FROM checkins WHERE date = $1`,
      [date]
    );
    res.json(rows[0] || null);
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/coach/checkins — recent check-ins, for the trend strip.
router.get('/checkins', async (req, res) => {
  const days = Math.min(Number(req.query.days) || 14, 120);
  try {
    const { rows } = await db.query(
      `SELECT date, mood, energy, soreness, note FROM checkins
        WHERE date >= $2::date - $1::int ORDER BY date DESC`,
      [days, anchor()]
    );
    res.json(rows);
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/coach/checkin — upsert today's check-in.
//
// Every field is optional on its own: the form is three taps and a note, and tapping
// only "energy" is a legitimate check-in. But an entirely empty body is a mistake,
// not an entry — reject it rather than writing a row of nulls the coach will read as
// "he checked in and felt nothing".
router.post('/checkin', async (req, res) => {
  const { mood, energy, soreness } = req.body;
  const note = readNote(req.body);
  const noteProvided = note !== undefined;
  const date = resolveWorkoutDate(req.body.date);

  for (const [name, value] of Object.entries({ mood, energy, soreness })) {
    if (value != null && !RATING(value)) {
      return res.status(400).json({ error: `${name} must be an integer from 1 to 5` });
    }
  }
  if (mood == null && energy == null && soreness == null && !noteProvided) {
    return res.status(400).json({ error: 'Nothing to save' });
  }

  try {
    const { rows } = await db.query(
      // The ratings COALESCE on purpose — each one is saved by its own tap, so an
      // absent field means "not tapped this time", never "cleared". The note can't work
      // that way: it's the one field the user can deliberately empty.
      `INSERT INTO checkins (date, mood, energy, soreness, note)
            VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (date) DO UPDATE SET
             mood     = COALESCE(EXCLUDED.mood, checkins.mood),
             energy   = COALESCE(EXCLUDED.energy, checkins.energy),
             soreness = COALESCE(EXCLUDED.soreness, checkins.soreness),
             note     = CASE WHEN $6::boolean THEN EXCLUDED.note ELSE checkins.note END,
             updated_at = NOW()
        RETURNING date, mood, energy, soreness, note`,
      [date, mood ?? null, energy ?? null, soreness ?? null, note ?? null, noteProvided]
    );
    res.json(rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/coach/session-feel/:workoutId
router.get('/session-feel/:workoutId', async (req, res) => {
  // Validated rather than handed to Postgres: a non-numeric param would fail the
  // integer cast and surface as a 500, which reads as an outage rather than a bad URL.
  const workoutId = Number(req.params.workoutId);
  if (!Number.isInteger(workoutId)) {
    return res.status(400).json({ error: 'workoutId must be an integer' });
  }
  try {
    const { rows } = await db.query(
      `SELECT workout_id, date, rpe, note FROM session_feel WHERE workout_id = $1`,
      [workoutId]
    );
    res.json(rows[0] || null);
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/coach/session-feel — how the session that just finished actually felt.
//
// `date` is read off the workout rather than taken from the client: the prompt appears
// right after Finish, but a session logged late at night and rated after midnight still
// belongs to the day it was trained.
router.post('/session-feel', async (req, res) => {
  const { workout_id: workoutId, rpe } = req.body;
  const note = readNote(req.body);
  const noteProvided = note !== undefined;

  if (!Number.isInteger(workoutId)) {
    return res.status(400).json({ error: 'workout_id is required' });
  }
  if (rpe != null && !(Number.isInteger(rpe) && rpe >= 1 && rpe <= 10)) {
    return res.status(400).json({ error: 'rpe must be an integer from 1 to 10' });
  }
  if (rpe == null && !noteProvided) {
    return res.status(400).json({ error: 'Nothing to save' });
  }

  try {
    const workout = await db.query(`SELECT date FROM workouts WHERE id = $1`, [workoutId]);
    if (!workout.rows.length) return res.status(404).json({ error: 'Workout not found' });

    const { rows } = await db.query(
      `INSERT INTO session_feel (workout_id, date, rpe, note)
            VALUES ($1, $2, $3, $4)
       ON CONFLICT (workout_id) DO UPDATE SET
             rpe  = COALESCE(EXCLUDED.rpe, session_feel.rpe),
             note = CASE WHEN $5::boolean THEN EXCLUDED.note ELSE session_feel.note END
        RETURNING workout_id, date, rpe, note`,
      [workoutId, workout.rows[0].date, rpe ?? null, note ?? null, noteProvided]
    );
    res.json(rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/coach/adherence — did the calls land?
router.get('/adherence', async (req, res) => {
  const days = Math.min(Number(req.query.days) || 28, 120);
  try {
    res.json(await buildAdherence(days));
  } catch (err) {
    serverError(res, err);
  }
});


module.exports = router;
