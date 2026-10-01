// Weekday-bound programs (2026-10-01). A routine with `weekday` set (0 = Sunday … 6 =
// Saturday) owns that day: the next session is whichever day comes up next, not the next
// step of a rotation, and a day that passes with nothing logged becomes a skipped row.
// The rotation drifted the routines off their days every time a session moved — Day C
// on a Monday pushed Day B onto an office Thursday — and the fix by hand was a skip in
// the app each time. A program with no weekdays set keeps the plain rotation.
const db = require('../db');
const { todayInAppTimezone, dayInAppTimezone } = require('./dates');

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const weekdayOf = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

function isScheduled(routines) {
  return routines.some((r) => r.weekday != null);
}

function routineOn(routines, iso) {
  const wd = weekdayOf(iso);
  return routines.find((r) => r.weekday === wd) || null;
}

function previousSlot(routines, iso) {
  for (let i = 1; i <= 7; i += 1) {
    const d = addDays(iso, -i);
    if (routineOn(routines, d)) return d;
  }
  return null;
}

// A slot is covered by any session logged since the slot before it, not just one on the
// day: Saturday's routine done on the Friday is Saturday done early, and must not leave
// Saturday to be auto-skipped. Matching by date rather than routine id matters too —
// editing a program re-inserts its routines under new ids.
function covered(routines, slotDate, workoutDates) {
  const prev = previousSlot(routines, slotDate);
  return workoutDates.some((d) => (prev == null || d > prev) && d <= slotDate);
}

function nextSlot(routines, fromIso, workoutDates) {
  for (let i = 0; i < 14; i += 1) {
    const date = addDays(fromIso, i);
    const routine = routineOn(routines, date);
    if (routine && !covered(routines, date, workoutDates)) return { routine, date };
  }
  return null;
}

async function workoutDates(client, programId) {
  const { rows } = await client.query(
    'SELECT DISTINCT date FROM workouts WHERE program_id = $1 ORDER BY date',
    [programId]
  );
  return rows.map((r) => String(r.date).slice(0, 10));
}

// Banks every missed slot as a skipped workout, from the day after the program's last
// session (or its start) up to yesterday. Today is never auto-skipped: the day isn't
// over. Called on read by everything that names the next session, so there is no timer
// to drift out of step with the app. The advisory lock stops two concurrent reads from
// skipping the same day twice. A caller already holding a client must pass it: the
// serverless pool is `max: 1`, so a second connect would wait on itself forever.
async function reconcileMissed(programId, held = null) {
  const client = held || await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(4207, $1)', [programId]);
    const [routinesRes, programRes] = await Promise.all([
      client.query(
        'SELECT id, name, weekday FROM routines WHERE program_id = $1 AND deleted_at IS NULL',
        [programId]
      ),
      client.query('SELECT started_at FROM programs WHERE id = $1', [programId]),
    ]);
    const routines = routinesRes.rows;
    if (!isScheduled(routines) || !programRes.rows[0]?.started_at) {
      await client.query('COMMIT');
      return 0;
    }

    const dates = await workoutDates(client, programId);
    const started = dayInAppTimezone(programRes.rows[0].started_at);
    const last = dates[dates.length - 1];
    let day = last && last >= started ? addDays(last, 1) : started;
    const yesterday = addDays(todayInAppTimezone(), -1);

    const countRes = await client.query(
      "SELECT COUNT(*)::int AS n FROM workouts WHERE program_id = $1 AND status IN ('completed', 'skipped')",
      [programId]
    );
    let sequenced = countRes.rows[0].n;
    let inserted = 0;
    for (; day <= yesterday; day = addDays(day, 1)) {
      const routine = routineOn(routines, day);
      if (!routine || covered(routines, day, dates)) continue;
      await client.query(
        `INSERT INTO workouts (program_id, routine_id, routine_name, program_week, date, notes, status)
         VALUES ($1, $2, $3, $4, $5, 'Missed its day — skipped automatically', 'skipped')`,
        [programId, routine.id, routine.name, Math.floor(sequenced / routines.length) + 1, day]
      );
      dates.push(day);
      sequenced += 1;
      inserted += 1;
    }
    await client.query('COMMIT');
    return inserted;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    if (!held) client.release();
  }
}

module.exports = {
  addDays,
  isScheduled,
  routineOn,
  covered,
  nextSlot,
  workoutDates,
  reconcileMissed,
};
