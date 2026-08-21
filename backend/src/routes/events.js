const express = require('express');

const db = require('../db');
const { serverError } = require('../util/errors');

const router = express.Router();

// Telemetry ingest. Two rules shape everything here:
//
//   1. This must never cost the user anything. A batch that is malformed, oversized or
//      partially rubbish is trimmed and accepted rather than rejected — the client is
//      fire-and-forget and cannot act on a 400, so refusing one only loses the events.
//   2. It must never be a way in. Every field is length-capped and the enums are
//      whitelisted, because this is the one endpoint that writes arbitrary client input.
const KINDS = new Set(['nav', 'tap', 'save', 'error', 'lifecycle']);
const MAX_EVENTS = 200;          // one batch; the client flushes far more often than this
const MAX_DETAIL_BYTES = 2000;
const RETENTION_DAYS = 30;

const str = (v, max) => (typeof v === 'string' && v.length ? v.slice(0, max) : null);

// A timestamp the client can't use to rewrite history. Clock skew is real on a phone, so
// anything implausible falls back to now rather than being dropped — the ordering within
// a session is what matters, and `received_at` is the trustworthy clock.
function clientTime(v) {
  const t = typeof v === 'number' ? v : Date.parse(v);
  if (!Number.isFinite(t)) return new Date();
  const d = new Date(t);
  const now = Date.now();
  if (t > now + 60_000 || t < now - 7 * 24 * 3600_000) return new Date();
  return d;
}

function clean(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = str(raw.kind, 24);
  const name = str(raw.name, 60);
  if (!kind || !name || !KINDS.has(kind)) return null;
  const sessionId = str(raw.session_id, 40);
  if (!sessionId) return null;

  let detail = null;
  if (raw.detail && typeof raw.detail === 'object') {
    const json = JSON.stringify(raw.detail);
    // Oversized detail is dropped, not the event — the fact that it happened is worth
    // more than whatever made the payload fat.
    if (json.length <= MAX_DETAIL_BYTES) detail = raw.detail;
  }

  const workoutId = Number(raw.workout_id);
  return {
    ts: clientTime(raw.ts),
    session_id: sessionId,
    kind,
    name,
    route: str(raw.route, 200),
    workout_id: Number.isInteger(workoutId) && workoutId > 0 ? workoutId : null,
    detail,
  };
}

// Pruning rides along with writes instead of running on a timer: there is no scheduler in
// a serverless backend, and the only moment this table is guaranteed to be growing is the
// moment something is being written to it. Sampled so it costs nothing per request.
let sinceLastPrune = 0;
async function maybePrune() {
  sinceLastPrune += 1;
  if (sinceLastPrune < 50) return;
  sinceLastPrune = 0;
  try {
    await db.query(`DELETE FROM app_events WHERE ts < NOW() - INTERVAL '${RETENTION_DAYS} days'`);
  } catch {
    // Housekeeping is never worth failing an ingest over.
  }
}

// POST /api/events — a batch of client events. Returns how many were stored so a
// mismatch is visible when debugging, but the client ignores the response entirely.
router.post('/', async (req, res) => {
  try {
    const batch = Array.isArray(req.body?.events) ? req.body.events : [];
    const rows = batch.slice(0, MAX_EVENTS).map(clean).filter(Boolean);
    if (!rows.length) return res.json({ stored: 0 });

    // One statement, not one per event: this runs on gym wifi behind a save that
    // actually matters, and each round trip is a chance to be slow.
    await db.query(
      `INSERT INTO app_events (ts, session_id, kind, name, route, workout_id, detail)
       SELECT * FROM UNNEST(
         $1::timestamptz[], $2::varchar[], $3::varchar[], $4::varchar[],
         $5::text[], $6::int[], $7::jsonb[]
       )`,
      [
        rows.map((r) => r.ts),
        rows.map((r) => r.session_id),
        rows.map((r) => r.kind),
        rows.map((r) => r.name),
        rows.map((r) => r.route),
        rows.map((r) => r.workout_id),
        rows.map((r) => (r.detail == null ? null : JSON.stringify(r.detail))),
      ]
    );
    await maybePrune();
    res.json({ stored: rows.length });
  } catch (err) {
    serverError(res, err);
  }
});

module.exports = router;
