const express = require('express');
const router = express.Router();
const db = require('../db');
const { serverError } = require('../util/errors');
const { resolveWorkoutDate, todayInAppTimezone } = require('../util/dates');
const { buildChatContext, buildAdherence } = require('../util/coachContext');
const { chatSystemPrompt } = require('../util/coachPrompt');

// Chat runs on Haiku: it is answering one question against a compact bundle, it is paid
// for on every message, and it shares a monthly cap with the scheduled runs. Sonnet is a
// one-line change if the answers ever feel thin.
const CHAT_MODEL = 'claude-haiku-4-5';
const CHAT_PRICING = { in: 1.0, out: 5.0 }; // USD per million tokens
const MONTHLY_BUDGET_USD = 5.0; // must match MONTHLY_BUDGET_USD in /srv/fitness/coach.py
const MAX_HISTORY_TURNS = 20;

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
    const [latest, baseline, load, freshness] = await Promise.all([
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
      db.query(
        `SELECT ROUND(AVG(body_battery_at_wake)) AS body_battery_at_wake,
                ROUND(AVG(sleep_score))          AS sleep_score,
                ROUND(AVG(resting_hr))           AS resting_hr,
                ROUND(AVG(stress_avg))           AS stress_avg,
                COUNT(*)::int                    AS days
           FROM wellness_daily WHERE date >= $1::date - 10`,
        [anchor()]
      ),
      db.query(
        `SELECT date, ROUND(ctl, 1) AS ctl, ROUND(atl, 1) AS atl, ROUND(tsb, 1) AS tsb
           FROM training_load ORDER BY date DESC LIMIT 1`
      ),
      db.query(
        `SELECT MIN(ROUND(EXTRACT(EPOCH FROM (NOW() - last_success)) / 3600))::int AS stale_hours
           FROM sync_state WHERE last_success IS NOT NULL`
      ),
    ]);
    res.json({
      last_night: latest.rows[0] || null,
      baseline_10d: baseline.rows[0] || null,
      training_load: load.rows[0] || null,
      stale_hours: freshness.rows[0]?.stale_hours ?? null,
    });
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

// GET /api/coach/messages — the chat thread, oldest first so the UI can render directly.
router.get('/messages', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  try {
    const { rows } = await db.query(
      `SELECT id, role, content, model, created_at FROM (
         SELECT id, role, content, model, created_at FROM coach_messages
          ORDER BY id DESC LIMIT $1
       ) t ORDER BY id ASC`,
      [limit]
    );
    res.json(rows);
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/coach/chat — ask the coach something.
//
// The thread is shared with the scheduled calls: recent `coach_advice` goes into the
// context, so the chat can be held to what it said this morning. Both turns are stored
// before the response returns, so a reply is never shown that isn't also persisted.
router.post('/chat', async (req, res) => {
  const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
  if (!message) return res.status(400).json({ error: 'message is required' });
  if (message.length > 4000) return res.status(400).json({ error: 'message is too long' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'Coach chat is not configured on this server' });
  }

  try {
    // Chat and the scheduled runs spend from the same pocket, so the cap has to see
    // both — summing only one of the two tables would enforce half a budget.
    const { rows: spend } = await db.query(
      `SELECT COALESCE(
                (SELECT SUM(cost_usd) FROM coach_advice
                  WHERE created_at >= date_trunc('month', NOW())), 0)
            + COALESCE(
                (SELECT SUM(cost_usd) FROM coach_messages
                  WHERE created_at >= date_trunc('month', NOW())), 0) AS usd`
    );
    const spent = Number(spend[0].usd);
    if (spent >= MONTHLY_BUDGET_USD) {
      return res.status(429).json({
        error: `Monthly coach budget reached ($${spent.toFixed(2)} of $${MONTHLY_BUDGET_USD.toFixed(2)}). Resets next month.`,
      });
    }

    const [context, history] = await Promise.all([
      buildChatContext(),
      db.query(
        `SELECT role, content FROM (
           SELECT id, role, content FROM coach_messages ORDER BY id DESC LIMIT $1
         ) t ORDER BY id ASC`,
        [MAX_HISTORY_TURNS]
      ),
    ]);

    // Required lazily: the module reads ANTHROPIC_API_KEY at construction, and the
    // route is the only thing in the app that needs it.
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic();

    const response = await client.messages.create({
      model: CHAT_MODEL,
      max_tokens: 1200,
      system: chatSystemPrompt(context),
      messages: [
        ...history.rows.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: message },
      ],
    });

    if (response.stop_reason === 'refusal') {
      return res.status(422).json({ error: 'The coach declined to answer that.' });
    }

    const reply = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!reply) return res.status(502).json({ error: 'Empty reply from the coach.' });

    const usage = response.usage;
    const cost =
      (usage.input_tokens * CHAT_PRICING.in + usage.output_tokens * CHAT_PRICING.out) /
      1_000_000;

    // Both turns in one transaction: a stored question with no answer would replay as
    // an unanswered turn in the next request's history and skew the conversation.
    const client_db = await db.pool.connect();
    try {
      await client_db.query('BEGIN');
      await client_db.query(
        `INSERT INTO coach_messages (role, content) VALUES ('user', $1)`,
        [message]
      );
      const { rows } = await client_db.query(
        `INSERT INTO coach_messages (role, content, model, input_tokens, output_tokens, cost_usd)
              VALUES ('assistant', $1, $2, $3, $4, $5)
           RETURNING id, role, content, model, created_at`,
        [reply, CHAT_MODEL, usage.input_tokens, usage.output_tokens, cost.toFixed(5)]
      );
      await client_db.query('COMMIT');
      res.json({ reply: rows[0], spent_this_month: Number((spent + cost).toFixed(4)) });
    } catch (err) {
      await client_db.query('ROLLBACK');
      throw err;
    } finally {
      client_db.release();
    }
  } catch (err) {
    serverError(res, err);
  }
});

module.exports = router;
