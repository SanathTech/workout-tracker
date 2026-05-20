const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/plans
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT wp.*, COUNT(pe.id)::int AS exercise_count
       FROM workout_plans wp
       LEFT JOIN plan_exercises pe ON pe.plan_id = wp.id
       GROUP BY wp.id ORDER BY wp.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/plans/:id — plan with its exercises
router.get('/:id', async (req, res) => {
  try {
    const planRes = await db.query('SELECT * FROM workout_plans WHERE id = $1', [req.params.id]);
    if (!planRes.rows.length) return res.status(404).json({ error: 'Plan not found' });

    const exercisesRes = await db.query(
      `SELECT pe.*, e.name AS exercise_name, e.muscle_group
       FROM plan_exercises pe
       JOIN exercises e ON e.id = pe.exercise_id
       WHERE pe.plan_id = $1
       ORDER BY pe.sort_order`,
      [req.params.id]
    );

    res.json({ ...planRes.rows[0], exercises: exercisesRes.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/plans
router.post('/', async (req, res) => {
  const { name, description, exercises } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'INSERT INTO workout_plans (name, description) VALUES ($1, $2) RETURNING *',
      [name, description || null]
    );
    const plan = rows[0];

    if (exercises && exercises.length) {
      for (let i = 0; i < exercises.length; i++) {
        const ex = exercises[i];
        await client.query(
          `INSERT INTO plan_exercises (plan_id, exercise_id, sort_order, target_sets, target_reps, notes)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [plan.id, ex.exercise_id, i, ex.target_sets || null, ex.target_reps || null, ex.notes || null]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json(plan);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/plans/:id
router.put('/:id', async (req, res) => {
  const { name, description, exercises } = req.body;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE workout_plans SET name = COALESCE($1, name), description = COALESCE($2, description)
       WHERE id = $3 RETURNING *`,
      [name, description, req.params.id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Plan not found' });
    }

    if (exercises !== undefined) {
      await client.query('DELETE FROM plan_exercises WHERE plan_id = $1', [req.params.id]);
      for (let i = 0; i < exercises.length; i++) {
        const ex = exercises[i];
        await client.query(
          `INSERT INTO plan_exercises (plan_id, exercise_id, sort_order, target_sets, target_reps, notes)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [req.params.id, ex.exercise_id, i, ex.target_sets || null, ex.target_reps || null, ex.notes || null]
        );
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

// DELETE /api/plans/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await db.query('DELETE FROM workout_plans WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Plan not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
