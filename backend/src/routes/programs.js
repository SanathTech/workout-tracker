const express = require('express');
const router = express.Router();
const db = require('../db');

// ─── Helpers ───────────────────────────────────────────────────────

async function fetchProgramTree(client, programId) {
  const programRes = await client.query('SELECT * FROM programs WHERE id = $1', [programId]);
  if (!programRes.rows.length) return null;
  const program = programRes.rows[0];

  const routinesRes = await client.query(
    'SELECT * FROM routines WHERE program_id = $1 ORDER BY sort_order, id',
    [programId]
  );

  const routineIds = routinesRes.rows.map((r) => r.id);
  let exRows = [];
  let subRows = [];
  if (routineIds.length) {
    const exRes = await client.query(
      `SELECT re.*, e.name AS exercise_name, e.muscle_group
         FROM routine_exercises re
         JOIN exercises e ON e.id = re.exercise_id
        WHERE re.routine_id = ANY($1::int[])
        ORDER BY re.routine_id, re.sort_order, re.id`,
      [routineIds]
    );
    exRows = exRes.rows;

    const reIds = exRows.map((r) => r.id);
    if (reIds.length) {
      const subRes = await client.query(
        `SELECT s.*, e.name AS exercise_name, e.muscle_group
           FROM routine_exercise_subs s
           JOIN exercises e ON e.id = s.exercise_id
          WHERE s.routine_exercise_id = ANY($1::int[])
          ORDER BY s.sort_order, s.id`,
        [reIds]
      );
      subRows = subRes.rows;
    }
  }

  const subsByRe = {};
  for (const s of subRows) {
    (subsByRe[s.routine_exercise_id] = subsByRe[s.routine_exercise_id] || []).push({
      exercise_id: s.exercise_id,
      exercise_name: s.exercise_name,
      muscle_group: s.muscle_group,
    });
  }

  const exByRoutine = {};
  for (const e of exRows) {
    (exByRoutine[e.routine_id] = exByRoutine[e.routine_id] || []).push({
      ...e,
      substitutes: subsByRe[e.id] || [],
    });
  }

  const routines = routinesRes.rows.map((r) => ({
    ...r,
    exercises: exByRoutine[r.id] || [],
  }));

  return { ...program, routines };
}

async function writeRoutines(client, programId, routines) {
  // Wipes and rewrites the routine tree for this program. Used by POST and PUT.
  await client.query('DELETE FROM routines WHERE program_id = $1', [programId]);
  if (!routines || !routines.length) return;

  for (let i = 0; i < routines.length; i++) {
    const r = routines[i];
    const { rows } = await client.query(
      'INSERT INTO routines (program_id, name, sort_order) VALUES ($1, $2, $3) RETURNING id',
      [programId, r.name, i]
    );
    const routineId = rows[0].id;

    const exs = r.exercises || [];
    for (let j = 0; j < exs.length; j++) {
      const ex = exs[j];
      const reRes = await client.query(
        `INSERT INTO routine_exercises
          (routine_id, exercise_id, sort_order, target_sets, rep_range_low, rep_range_high, target_rir, rest_seconds, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          routineId,
          ex.exercise_id,
          j,
          ex.target_sets ?? 3,
          ex.rep_range_low ?? null,
          ex.rep_range_high ?? null,
          ex.target_rir ?? null,
          ex.rest_seconds ?? null,
          ex.notes ?? null,
        ]
      );
      const reId = reRes.rows[0].id;

      const subs = ex.substitutes || [];
      for (let k = 0; k < subs.length; k++) {
        const subExId = typeof subs[k] === 'object' ? subs[k].exercise_id : subs[k];
        await client.query(
          'INSERT INTO routine_exercise_subs (routine_exercise_id, exercise_id, sort_order) VALUES ($1, $2, $3)',
          [reId, subExId, k]
        );
      }
    }
  }
}

function computeProgress(program, completedCount) {
  const routinesPerCycle = program.routines.length;
  if (!routinesPerCycle) {
    return { completed_workouts: completedCount, week: null, position_in_cycle: null, next_routine: null, total_workouts: program.total_weeks };
  }
  const totalWorkouts = program.total_weeks * routinesPerCycle;
  const week = Math.floor(completedCount / routinesPerCycle) + 1;
  const positionInCycle = (completedCount % routinesPerCycle) + 1;
  const nextRoutine = completedCount < totalWorkouts ? program.routines[completedCount % routinesPerCycle] : null;
  return {
    completed_workouts: completedCount,
    total_workouts: totalWorkouts,
    week,
    position_in_cycle: positionInCycle,
    next_routine: nextRoutine,
  };
}

// ─── Routes ────────────────────────────────────────────────────────

// GET /api/programs — list all programs (summary)
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT p.*,
              COUNT(DISTINCT r.id)::int AS routine_count,
              COUNT(DISTINCT w.id) FILTER (WHERE w.status = 'completed')::int AS completed_workouts
         FROM programs p
         LEFT JOIN routines r ON r.program_id = p.id
         LEFT JOIN workouts w ON w.program_id = p.id
        GROUP BY p.id
        ORDER BY (p.status = 'active') DESC, p.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/programs/active — active program with full tree + next-routine info
router.get('/active', async (req, res) => {
  const client = await db.pool.connect();
  try {
    const activeRes = await client.query("SELECT id FROM programs WHERE status = 'active' LIMIT 1");
    if (!activeRes.rows.length) return res.json(null);

    const program = await fetchProgramTree(client, activeRes.rows[0].id);
    const countRes = await client.query(
      "SELECT COUNT(*)::int AS n FROM workouts WHERE program_id = $1 AND status = 'completed'",
      [program.id]
    );
    res.json({ ...program, progress: computeProgress(program, countRes.rows[0].n) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/programs/:id — full program tree
router.get('/:id', async (req, res) => {
  const client = await db.pool.connect();
  try {
    const program = await fetchProgramTree(client, req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });
    res.json(program);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/programs — create draft program with routines tree
router.post('/', async (req, res) => {
  const { name, description, total_weeks, routines } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO programs (name, description, total_weeks)
       VALUES ($1, $2, $3) RETURNING *`,
      [name, description || null, total_weeks || 12]
    );
    await writeRoutines(client, rows[0].id, routines);
    await client.query('COMMIT');
    const full = await fetchProgramTree(client, rows[0].id);
    res.status(201).json(full);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/programs/:id — replace metadata + full routine tree
router.put('/:id', async (req, res) => {
  const { name, description, total_weeks, routines } = req.body;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE programs SET
         name = COALESCE($1, name),
         description = COALESCE($2, description),
         total_weeks = COALESCE($3, total_weeks)
       WHERE id = $4 RETURNING *`,
      [name, description, total_weeks, req.params.id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Program not found' });
    }

    if (routines !== undefined) {
      await writeRoutines(client, req.params.id, routines);
    }

    await client.query('COMMIT');
    const full = await fetchProgramTree(client, req.params.id);
    res.json(full);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE /api/programs/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await db.query('DELETE FROM programs WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Program not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/programs/:id/start — activate (archives any other active program first)
router.post('/:id/start', async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // Archive any currently-active program.
    await client.query(
      "UPDATE programs SET status = 'archived' WHERE status = 'active' AND id <> $1",
      [req.params.id]
    );
    const { rows } = await client.query(
      `UPDATE programs SET status = 'active', started_at = COALESCE(started_at, NOW())
         WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Program not found' });
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

// POST /api/programs/:id/end — manually archive an in-progress program
router.post('/:id/end', async (req, res) => {
  try {
    const { rows } = await db.query(
      `UPDATE programs SET status = 'archived', completed_at = NOW()
         WHERE id = $1 AND status = 'active' RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'No active program with that id' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
