const express = require('express');
const router = express.Router();
const db = require('../db');
const { serverError } = require('../util/errors');
const { todayInAppTimezone } = require('../util/dates');
const { machineAuthorized } = require('../util/machineAuth');
const { notify } = require('../util/ntfy');

// The check-in nudges (2026-09-16 rethink, PR 4). His words: "I struggle to adhere to
// this. Unless I go out of my way to do it and remember it, it wont get done. It needs to
// be part of my daily flow, it needs to insert itself at a natural point."
//
// So neither push is on a fixed morning clock. The morning one is triggered by the Garmin
// sync and only goes out once a night has actually landed — a 06:30 "how did you sleep"
// on a morning where the watch hasn't uploaded is exactly the nag that gets ignored. The
// evening one is at 21:15, fifteen minutes before the screens-down cue it asks about.
//
// Both are decided HERE rather than on nas-laptop: the timers stay dumb triggers, and
// "is it already answered" is a question about data this repo owns.

const APP_URL = process.env.APP_BASE_URL || 'https://workout.sanathtech.com';

function hm(secs) {
  const mins = Math.round(secs / 60);
  return `${Math.floor(mins / 60)} h ${mins % 60} m`;
}

async function morning(date) {
  const [checkin, night] = await Promise.all([
    db.query('SELECT mood, energy, soreness FROM checkins WHERE date = $1', [date]),
    // The night Garmin filed under today. Its absence is why this endpoint is polled
    // rather than scheduled: nothing to rate yet, so nothing to ask.
    db.query(
      `SELECT sleep_secs, sleep_score, body_battery_at_wake FROM wellness_daily
        WHERE date = $1 AND sleep_secs IS NOT NULL`,
      [date]
    ),
  ]);
  const c = checkin.rows[0];
  if (c && c.mood != null && c.energy != null && c.soreness != null) {
    return { skip: 'already answered' };
  }
  const n = night.rows[0];
  if (!n) return { skip: 'no night synced yet' };

  const facts = [
    n.sleep_secs ? `Slept ${hm(n.sleep_secs)}` : null,
    n.sleep_score != null ? `score ${n.sleep_score}` : null,
    n.body_battery_at_wake != null ? `battery ${n.body_battery_at_wake}` : null,
  ].filter(Boolean).join(' · ');
  return {
    title: 'How did you wake up?',
    message: `${facts}. Mood, energy, soreness — three taps.`,
    click: `${APP_URL}/dashboard?checkin=morning`,
    tags: 'sleeping',
  };
}

async function evening(date) {
  const { rows } = await db.query(
    'SELECT no_caffeine_pm, food_by_cutoff, screens_by_cutoff FROM checkins WHERE date = $1',
    [date]
  );
  const c = rows[0];
  if (c && c.no_caffeine_pm != null && c.food_by_cutoff != null && c.screens_by_cutoff != null) {
    return { skip: 'already answered' };
  }
  return {
    title: 'Screens down in 15',
    message: 'Caffeine by noon, food by 19:30, screens now — how did today go?',
    click: `${APP_URL}/dashboard?checkin=evening`,
    tags: 'crescent_moon',
  };
}

// POST /api/coach/nudge?kind=morning|evening — called by the nas-laptop timers. Decides
// whether the nudge is due, sends it, and records that it went so the morning trigger
// (which fires every half hour while he wakes up) can only push once a day.
router.post('/', async (req, res) => {
  if (!machineAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });
  const kind = req.query.kind === 'morning' ? 'morning' : req.query.kind === 'evening' ? 'evening' : null;
  if (!kind) return res.status(400).json({ error: 'kind must be morning or evening' });

  const date = todayInAppTimezone();
  try {
    const plan = kind === 'morning' ? await morning(date) : await evening(date);
    if (plan.skip) return res.json({ sent: false, reason: plan.skip });

    // Claim the slot BEFORE pushing. Two triggers overlapping (a slow sync and the next
    // one) would otherwise both pass the checks and both buzz him.
    const claim = await db.query(
      `INSERT INTO checkin_nudges (for_date, kind) VALUES ($1, $2)
       ON CONFLICT (for_date, kind) DO NOTHING RETURNING for_date`,
      [date, kind]
    );
    if (!claim.rows.length) return res.json({ sent: false, reason: 'already sent today' });

    const delivered = await notify(plan.title, plan.message, {
      click: plan.click, tags: plan.tags, priority: 'default',
    });
    await db.query(
      'UPDATE checkin_nudges SET delivered = $3 WHERE for_date = $1 AND kind = $2',
      [date, kind, delivered]
    );
    res.json({ sent: true, delivered });
  } catch (err) {
    serverError(res, err);
  }
});

module.exports = router;
