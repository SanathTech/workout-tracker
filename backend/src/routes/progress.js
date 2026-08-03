const express = require('express');
const router = express.Router();
const db = require('../db');
const { serverError } = require('../util/errors');
const { LANDMARKS } = require('../db/muscles');
const { resolveWorkoutDate, currentWeekStart } = require('../util/dates');

// GET /api/progress/exercise/:exerciseId — per-date max weight and volume
router.get('/exercise/:exerciseId', async (req, res) => {
  const { weeks = 12 } = req.query;
  try {
    const { rows } = await db.query(
      `SELECT
         w.date,
         MAX(ws.weight_kg) AS max_weight,
         SUM(ws.weight_kg * ws.reps) AS volume,
         SUM(ws.reps) AS total_reps,
         ROUND(AVG(ws.rir), 1) AS avg_rir,
         COUNT(*)::int AS set_count
       FROM workout_sets ws
       JOIN workout_exercises we ON we.id = ws.workout_exercise_id
       JOIN workouts w ON w.id = we.workout_id
       WHERE we.exercise_id = $1
         AND w.status = 'completed'
         AND ws.set_type <> 'warmup'
         AND w.date >= CURRENT_DATE - ($2 || ' weeks')::INTERVAL
       GROUP BY w.date
       ORDER BY w.date ASC`,
      [req.params.exerciseId, weeks]
    );
    res.json(rows);
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/progress/volume — weekly total volume
router.get('/volume', async (req, res) => {
  const { weeks = 12 } = req.query;
  try {
    const { rows } = await db.query(
      `SELECT
         DATE_TRUNC('week', w.date)::date AS week_start,
         SUM(ws.weight_kg * ws.reps) AS total_volume,
         COUNT(DISTINCT w.id)::int AS workout_count
       FROM workout_sets ws
       JOIN workout_exercises we ON we.id = ws.workout_exercise_id
       JOIN workouts w ON w.id = we.workout_id
       WHERE w.status = 'completed'
         AND ws.set_type <> 'warmup'
         AND w.date >= CURRENT_DATE - ($1 || ' weeks')::INTERVAL
       GROUP BY week_start
       ORDER BY week_start ASC`,
      [weeks]
    );
    res.json(rows);
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/progress/stats — dashboard counters
router.get('/stats', async (req, res) => {
  try {
    const [workoutCount, totalVolume, totalSets, thisWeek] = await Promise.all([
      db.query("SELECT COUNT(*)::int AS count FROM workouts WHERE status = 'completed'"),
      db.query(
        `SELECT COALESCE(SUM(ws.weight_kg * ws.reps), 0) AS total
           FROM workout_sets ws
           JOIN workout_exercises we ON we.id = ws.workout_exercise_id
           JOIN workouts w ON w.id = we.workout_id
          WHERE w.status = 'completed' AND ws.set_type <> 'warmup'`
      ),
      db.query(
        `SELECT COUNT(*)::int AS count
           FROM workout_sets ws
           JOIN workout_exercises we ON we.id = ws.workout_exercise_id
           JOIN workouts w ON w.id = we.workout_id
          WHERE w.status = 'completed' AND ws.set_type <> 'warmup'`
      ),
      db.query(
        `SELECT COUNT(DISTINCT id)::int AS count FROM workouts
          WHERE status = 'completed' AND date >= DATE_TRUNC('week', CURRENT_DATE)`
      ),
    ]);

    res.json({
      total_workouts: workoutCount.rows[0].count,
      total_volume_kg: parseFloat(totalVolume.rows[0].total),
      total_sets: totalSets.rows[0].count,
      workouts_this_week: thisWeek.rows[0].count,
    });
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/progress/personal-bests — heaviest set per exercise
router.get('/personal-bests', async (req, res) => {
  try {
    // One row per exercise: prefer the weighted set with the best estimated 1RM
    // (Epley); for exercises only ever done at bodyweight, fall back to most reps.
    //
    // Ranked on load, then reps — this endpoint means "the heaviest set you've done",
    // and ranking on estimated 1RM instead let a lighter high-rep set outrank a heavier
    // one. The estimate is shown but never used to order.
    //
    // Epley is only meaningful up to ~12 reps; past that it inflates badly (a 25-rep set
    // of 40kg reported as a 73kg "one-rep max"). Above 12 reps the estimate is omitted
    // rather than guessed.
    const { rows } = await db.query(
      `SELECT DISTINCT ON (we.exercise_id)
         we.exercise_id, e.name AS exercise_name, e.muscle_group,
         ws.weight_kg AS best_weight, ws.reps, w.date,
         CASE WHEN ws.weight_kg IS NOT NULL AND ws.reps <= 12
           THEN ROUND(ws.weight_kg * (1 + ws.reps::numeric / 30), 1)
         END AS est_1rm
       FROM workout_sets ws
       JOIN workout_exercises we ON we.id = ws.workout_exercise_id
       JOIN workouts w ON w.id = we.workout_id
       JOIN exercises e ON e.id = we.exercise_id
       WHERE w.status = 'completed' AND ws.reps IS NOT NULL
         AND ws.set_type <> 'warmup'
       ORDER BY we.exercise_id,
         ws.weight_kg DESC NULLS LAST,
         ws.reps DESC`
    );
    res.json(rows);
  } catch (err) {
    serverError(res, err);
  }
});


// A "hard set" is a logged set that was actually worked: it has reps, and it isn't a
// warm-up. Drop and failure sets stay in — they're working sets taken past the prescribed
// stopping point, not preparation.
const HARD_SET = "ws.reps IS NOT NULL AND ws.reps > 0 AND ws.set_type <> 'warmup'";

// GET /api/progress/muscle-volume?weeks=8 — weekly hard sets per muscle vs landmarks.
// Fractional: a set counts 1.0 for what it primarily trains, 0.5 for what it assists.
router.get('/muscle-volume', async (req, res) => {
  const weeks = Math.min(Math.max(parseInt(req.query.weeks, 10) || 8, 1), 52);
  // The week boundary is a local-time question, same as `workouts.date` itself — see
  // currentWeekStart(). CURRENT_DATE here would be the UTC server's idea of the week.
  const currentWeek = currentWeekStart();
  try {
    const { rows } = await db.query(
      `SELECT
         DATE_TRUNC('week', w.date)::date AS week_start,
         em.muscle,
         SUM(em.contribution)::float AS sets
       FROM workout_sets ws
       JOIN workout_exercises we ON we.id = ws.workout_exercise_id
       JOIN workouts w ON w.id = we.workout_id
       JOIN exercise_muscles em ON em.exercise_id = we.exercise_id
       WHERE w.status = 'completed'
         AND ${HARD_SET}
         AND w.date >= $2::date - ($1 || ' weeks')::INTERVAL
       GROUP BY week_start, em.muscle
       ORDER BY week_start ASC`,
      [weeks, currentWeek]
    );

    // Pivot into one row per week with every muscle present, so the client doesn't have to
    // reason about gaps — a muscle you trained zero times still needs to read as zero.
    const muscles = Object.keys(LANDMARKS);
    const byWeek = new Map();
    for (const r of rows) {
      if (!byWeek.has(r.week_start)) {
        byWeek.set(r.week_start, Object.fromEntries(muscles.map((m) => [m, 0])));
      }
      byWeek.get(r.week_start)[r.muscle] = Math.round(r.sets * 10) / 10;
    }

    const series = [...byWeek.entries()].map(([week_start, counts]) => ({ week_start, ...counts }));

    // The week in progress, not "the most recent week with data" — those are the same
    // thing only while you're training. After a lay-off the latter reports a fortnight-old
    // week as your current volume, which is the one thing this card must not do.
    const current = series.find((s) => s.week_start === currentWeek) || null;

    // Averaged over the N whole weeks before this one, counting weeks you didn't train as
    // zero — that's what makes the window selector mean something. The current week is
    // excluded because it's still in progress and would drag every average down.
    const priorWeeks = series.filter((s) => s.week_start !== currentWeek);
    const avgOf = (m) =>
      Math.round((priorWeeks.reduce((n, wk) => n + (wk[m] || 0), 0) / weeks) * 10) / 10;

    const summary = muscles.map((m) => {
      const sets = current ? current[m] : 0;
      const { mev, mav, mrv, label } = LANDMARKS[m];
      let status = 'below_mev';
      if (sets > mrv) status = 'above_mrv';
      else if (sets >= mev && sets <= mav) status = 'productive';
      else if (sets > mav) status = 'high';
      return { muscle: m, label, sets, avg_sets: avgOf(m), mev, mav, mrv, status };
    }).sort((a, b) => b.sets - a.sets || b.avg_sets - a.avg_sets);

    res.json({ weeks, week_start: currentWeek, landmarks: LANDMARKS, series, summary });
  } catch (err) {
    serverError(res, err);
  }
});

// Epley. Above ~12 reps every 1RM formula drifts badly, so don't pretend otherwise —
// the caller gets null rather than a confident wrong number.
const epley = (weight, reps) => (reps > 0 && reps <= 12 ? weight * (1 + reps / 30) : null);

// GET /api/progress/one-rm/:exerciseId?weeks=26 — best estimated 1RM per session.
router.get('/one-rm/:exerciseId', async (req, res) => {
  const weeks = Math.min(Math.max(parseInt(req.query.weeks, 10) || 26, 1), 260);
  try {
    const { rows } = await db.query(
      `SELECT w.date, ws.weight_kg::float AS weight_kg, ws.reps
         FROM workout_sets ws
         JOIN workout_exercises we ON we.id = ws.workout_exercise_id
         JOIN workouts w ON w.id = we.workout_id
        WHERE we.exercise_id = $1
          AND w.status = 'completed'
          AND ws.weight_kg IS NOT NULL AND ${HARD_SET}
          AND w.date >= CURRENT_DATE - ($2 || ' weeks')::INTERVAL
        ORDER BY w.date ASC`,
      [req.params.exerciseId, weeks]
    );

    const byDate = new Map();
    for (const r of rows) {
      const e = epley(r.weight_kg, r.reps);
      if (e == null) continue;
      const best = byDate.get(r.date);
      if (!best || e > best.estimated_1rm) {
        byDate.set(r.date, {
          date: r.date,
          estimated_1rm: Math.round(e * 10) / 10,
          from: `${r.weight_kg}kg × ${r.reps}`,
        });
      }
    }
    res.json([...byDate.values()]);
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/progress/suggestions — double progression, per exercise in the active program.
//
// The rule: every working set at the top of the prescribed rep range means the load is no
// longer the limiter, so add weight and drop back down the range. Anything short of that
// means there are still reps to win at the current weight. Increment is deliberately
// smaller for isolation work — 2.5kg on a lateral raise is a different ask than on a squat.
router.get('/suggestions', async (req, res) => {
  try {
    const { rows } = await db.query(
      `WITH active AS (
         SELECT id FROM programs WHERE status = 'active' LIMIT 1
       ),
       prescribed AS (
         SELECT DISTINCT ON (re.exercise_id)
                re.exercise_id, re.rep_range_low, re.rep_range_high, re.target_sets,
                e.name AS exercise_name, e.is_bodyweight,
                COALESCE(pm.muscle, 'other') AS primary_muscle
           FROM routine_exercises re
           JOIN routines r ON r.id = re.routine_id AND r.deleted_at IS NULL
           JOIN active a ON a.id = r.program_id
           JOIN exercises e ON e.id = re.exercise_id
           LEFT JOIN LATERAL (
             SELECT muscle FROM exercise_muscles
              WHERE exercise_id = re.exercise_id AND contribution >= 1
              ORDER BY muscle LIMIT 1
           ) pm ON TRUE
          ORDER BY re.exercise_id, re.id
       ),
       last_session AS (
         SELECT DISTINCT ON (we.exercise_id)
                we.exercise_id, w.id AS workout_id, w.date
           FROM workout_exercises we
           JOIN workouts w ON w.id = we.workout_id
          WHERE w.status = 'completed'
          ORDER BY we.exercise_id, w.date DESC, w.id DESC
       )
       SELECT p.*, ls.date AS last_date,
              COALESCE(
                json_agg(json_build_object('reps', ws.reps, 'weight_kg', ws.weight_kg::float, 'rir', ws.rir)
                         ORDER BY ws.set_number)
                FILTER (WHERE ws.id IS NOT NULL),
                '[]'
              ) AS last_sets
         FROM prescribed p
         LEFT JOIN last_session ls ON ls.exercise_id = p.exercise_id
         LEFT JOIN workout_exercises we2
                ON we2.workout_id = ls.workout_id AND we2.exercise_id = p.exercise_id
         LEFT JOIN workout_sets ws
                ON ws.workout_exercise_id = we2.id AND ws.reps IS NOT NULL AND ws.reps > 0
               AND ws.set_type <> 'warmup'
        GROUP BY p.exercise_id, p.rep_range_low, p.rep_range_high, p.target_sets,
                 p.exercise_name, p.is_bodyweight, p.primary_muscle, ls.date
        ORDER BY p.exercise_name`
    );

    // Compound lifts move in bigger jumps than isolation — the smallest plate pair is
    // 2.5kg total on a bar, but a 2.5kg jump on a cable curl is a ~10% step.
    const COMPOUND = new Set(['quads', 'hamstrings', 'glutes', 'chest', 'lats', 'upper_back', 'lower_back']);

    const suggestions = rows.map((r) => {
      const sets = r.last_sets || [];
      const top = r.rep_range_high;
      const low = r.rep_range_low;
      const base = {
        exercise_id: r.exercise_id,
        exercise_name: r.exercise_name,
        rep_range_low: low,
        rep_range_high: top,
        last_date: r.last_date || null,
        last_sets: sets,
      };

      if (!sets.length) {
        return { ...base, action: 'no_history', reason: 'No logged sets yet — set your starting weight.' };
      }
      if (top == null) {
        return { ...base, action: 'no_target', reason: 'No rep range prescribed, so there is nothing to progress against.' };
      }

      const weights = sets.map((s) => s.weight_kg).filter((w) => w != null);
      const workingWeight = weights.length ? Math.max(...weights) : null;
      const atTop = sets.every((s) => s.reps >= top);
      const step = COMPOUND.has(r.primary_muscle) ? 2.5 : 1.25;

      if (atTop && workingWeight != null) {
        return {
          ...base,
          action: 'increase',
          suggested_weight_kg: Math.round((workingWeight + step) * 100) / 100,
          suggested_reps_low: low,
          suggested_reps_high: top,
          reason: `Hit ${top} on every set at ${workingWeight}kg — add ${step}kg and work back up the range.`,
        };
      }
      if (atTop) {
        return { ...base, action: 'increase', reason: `Hit ${top} on every set — add load next session.` };
      }
      const shortfall = sets.filter((s) => s.reps < top).length;
      return {
        ...base,
        action: 'hold',
        suggested_weight_kg: workingWeight,
        suggested_reps_low: low,
        suggested_reps_high: top,
        reason: workingWeight != null
          ? `${shortfall} of ${sets.length} sets below ${top} reps — stay at ${workingWeight}kg and add reps.`
          : `Not all sets at ${top} reps yet — add reps before load.`,
      };
    });

    res.json(suggestions);
  } catch (err) {
    serverError(res, err);
  }
});

// ── Bodyweight ────────────────────────────────────────────────
router.get('/bodyweight', async (req, res) => {
  const weeks = Math.min(Math.max(parseInt(req.query.weeks, 10) || 26, 1), 260);
  try {
    const { rows } = await db.query(
      `SELECT id, date, weight_kg::float AS weight_kg, notes
         FROM bodyweight_logs
        WHERE date >= CURRENT_DATE - ($1 || ' weeks')::INTERVAL
        ORDER BY date ASC`,
      [weeks]
    );
    res.json(rows);
  } catch (err) {
    serverError(res, err);
  }
});

router.post('/bodyweight', async (req, res) => {
  const { date, weight_kg, notes } = req.body;
  const day = resolveWorkoutDate(date);
  const weight = Number(weight_kg);
  if (!Number.isFinite(weight) || weight <= 0 || weight > 500) {
    return res.status(400).json({ error: 'weight_kg must be a number between 0 and 500' });
  }
  try {
    // One weigh-in per day: logging twice corrects the day rather than duplicating it.
    const { rows } = await db.query(
      `INSERT INTO bodyweight_logs (date, weight_kg, notes)
       VALUES ($1, $2, $3)
       ON CONFLICT (date) DO UPDATE SET weight_kg = EXCLUDED.weight_kg, notes = EXCLUDED.notes
       RETURNING id, date, weight_kg::float AS weight_kg, notes`,
      [day, weight, notes || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

router.delete('/bodyweight/:id', async (req, res) => {
  try {
    const { rowCount } = await db.query('DELETE FROM bodyweight_logs WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Entry not found' });
    res.json({ success: true });
  } catch (err) {
    serverError(res, err);
  }
});

module.exports = router;
