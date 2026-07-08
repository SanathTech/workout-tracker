const express = require('express');
const router = express.Router();
const db = require('../db');
const { serverError } = require('../util/errors');

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
         COUNT(*)::int AS set_count
       FROM workout_sets ws
       JOIN workout_exercises we ON we.id = ws.workout_exercise_id
       JOIN workouts w ON w.id = we.workout_id
       WHERE we.exercise_id = $1
         AND w.status = 'completed'
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
          WHERE w.status = 'completed'`
      ),
      db.query(
        `SELECT COUNT(*)::int AS count
           FROM workout_sets ws
           JOIN workout_exercises we ON we.id = ws.workout_exercise_id
           JOIN workouts w ON w.id = we.workout_id
          WHERE w.status = 'completed'`
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
    const { rows } = await db.query(
      `SELECT DISTINCT ON (we.exercise_id)
         we.exercise_id, e.name AS exercise_name, e.muscle_group,
         ws.weight_kg AS best_weight, ws.reps, w.date
       FROM workout_sets ws
       JOIN workout_exercises we ON we.id = ws.workout_exercise_id
       JOIN workouts w ON w.id = we.workout_id
       JOIN exercises e ON e.id = we.exercise_id
       WHERE ws.weight_kg IS NOT NULL AND w.status = 'completed'
       ORDER BY we.exercise_id, ws.weight_kg DESC, ws.reps DESC`
    );
    res.json(rows);
  } catch (err) {
    serverError(res, err);
  }
});

module.exports = router;
