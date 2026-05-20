const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/workouts — list all workouts (summary)
router.get('/', async (req, res) => {
  const { limit = 20, offset = 0 } = req.query;
  try {
    const { rows } = await db.query(
      `SELECT w.*, wp.name AS plan_name,
        COUNT(DISTINCT ws.exercise_id)::int AS exercise_count,
        SUM(ws.weight_kg * ws.reps) AS total_volume
       FROM workouts w
       LEFT JOIN workout_plans wp ON wp.id = w.plan_id
       LEFT JOIN workout_sets ws ON ws.workout_id = w.id
       GROUP BY w.id, wp.name
       ORDER BY w.date DESC, w.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/workouts/recent — last 5 workouts for dashboard
router.get('/recent', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT w.*, wp.name AS plan_name,
        COUNT(DISTINCT ws.exercise_id)::int AS exercise_count
       FROM workouts w
       LEFT JOIN workout_plans wp ON wp.id = w.plan_id
       LEFT JOIN workout_sets ws ON ws.workout_id = w.id
       GROUP BY w.id, wp.name
       ORDER BY w.date DESC, w.created_at DESC
       LIMIT 5`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/workouts/:id — full workout with all sets
router.get('/:id', async (req, res) => {
  try {
    const workoutRes = await db.query(
      `SELECT w.*, wp.name AS plan_name FROM workouts w
       LEFT JOIN workout_plans wp ON wp.id = w.plan_id
       WHERE w.id = $1`,
      [req.params.id]
    );
    if (!workoutRes.rows.length) return res.status(404).json({ error: 'Workout not found' });

    const setsRes = await db.query(
      `SELECT ws.*, e.name AS exercise_name, e.muscle_group
       FROM workout_sets ws
       JOIN exercises e ON e.id = ws.exercise_id
       WHERE ws.workout_id = $1
       ORDER BY ws.exercise_id, ws.set_number`,
      [req.params.id]
    );

    // Group sets by exercise
    const exercisesMap = {};
    for (const s of setsRes.rows) {
      if (!exercisesMap[s.exercise_id]) {
        exercisesMap[s.exercise_id] = {
          exercise_id: s.exercise_id,
          exercise_name: s.exercise_name,
          muscle_group: s.muscle_group,
          sets: [],
        };
      }
      exercisesMap[s.exercise_id].sets.push({
        id: s.id,
        set_number: s.set_number,
        reps: s.reps,
        weight_kg: s.weight_kg,
      });
    }

    res.json({
      ...workoutRes.rows[0],
      exercises: Object.values(exercisesMap),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/workouts
router.post('/', async (req, res) => {
  const { name, date, duration_minutes, notes, plan_id, exercises } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO workouts (name, date, duration_minutes, notes, plan_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, date || new Date().toISOString().slice(0, 10), duration_minutes || null, notes || null, plan_id || null]
    );
    const workout = rows[0];

    if (exercises && exercises.length) {
      for (const ex of exercises) {
        for (const set of ex.sets) {
          await client.query(
            `INSERT INTO workout_sets (workout_id, exercise_id, set_number, reps, weight_kg)
             VALUES ($1, $2, $3, $4, $5)`,
            [workout.id, ex.exercise_id, set.set_number, set.reps || null, set.weight_kg || null]
          );
        }
      }
    }

    await client.query('COMMIT');
    res.status(201).json(workout);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/workouts/:id
router.put('/:id', async (req, res) => {
  const { name, date, duration_minutes, notes, exercises } = req.body;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE workouts SET
        name = COALESCE($1, name),
        date = COALESCE($2, date),
        duration_minutes = COALESCE($3, duration_minutes),
        notes = COALESCE($4, notes)
       WHERE id = $5 RETURNING *`,
      [name, date, duration_minutes, notes, req.params.id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Workout not found' });
    }

    if (exercises !== undefined) {
      await client.query('DELETE FROM workout_sets WHERE workout_id = $1', [req.params.id]);
      for (const ex of exercises) {
        for (const set of ex.sets) {
          await client.query(
            `INSERT INTO workout_sets (workout_id, exercise_id, set_number, reps, weight_kg)
             VALUES ($1, $2, $3, $4, $5)`,
            [req.params.id, ex.exercise_id, set.set_number, set.reps || null, set.weight_kg || null]
          );
        }
      }
    }

    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE /api/workouts/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await db.query('DELETE FROM workouts WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Workout not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
