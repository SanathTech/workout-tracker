const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/exercises — list all, optionally filter by muscle_group
router.get('/', async (req, res) => {
  const { muscle_group, search } = req.query;
  let text = 'SELECT * FROM exercises';
  const params = [];

  if (muscle_group && search) {
    text += ' WHERE muscle_group = $1 AND name ILIKE $2 ORDER BY name';
    params.push(muscle_group, `%${search}%`);
  } else if (muscle_group) {
    text += ' WHERE muscle_group = $1 ORDER BY name';
    params.push(muscle_group);
  } else if (search) {
    text += ' WHERE name ILIKE $1 ORDER BY name';
    params.push(`%${search}%`);
  } else {
    text += ' ORDER BY muscle_group, name';
  }

  try {
    const { rows } = await db.query(text, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/exercises/groups — list distinct muscle groups
router.get('/groups', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT DISTINCT muscle_group FROM exercises ORDER BY muscle_group'
    );
    res.json(rows.map((r) => r.muscle_group));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/exercises/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM exercises WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Exercise not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/exercises
router.post('/', async (req, res) => {
  const { name, muscle_group, description } = req.body;
  if (!name || !muscle_group) return res.status(400).json({ error: 'name and muscle_group required' });
  try {
    const { rows } = await db.query(
      'INSERT INTO exercises (name, muscle_group, description) VALUES ($1, $2, $3) RETURNING *',
      [name, muscle_group, description || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/exercises/:id
router.put('/:id', async (req, res) => {
  const { name, muscle_group, description } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE exercises SET name = COALESCE($1, name), muscle_group = COALESCE($2, muscle_group),
       description = COALESCE($3, description) WHERE id = $4 RETURNING *`,
      [name, muscle_group, description, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Exercise not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/exercises/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await db.query('DELETE FROM exercises WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Exercise not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
