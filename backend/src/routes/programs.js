const express = require('express');
const router = express.Router();
const db = require('../db');
const { serverError } = require('../util/errors');

// ─── Helpers ───────────────────────────────────────────────────────

async function fetchProgramTree(client, programId) {
  const programRes = await client.query('SELECT * FROM programs WHERE id = $1', [programId]);
  if (!programRes.rows.length) return null;
  const program = programRes.rows[0];

  const routinesRes = await client.query(
    'SELECT * FROM routines WHERE program_id = $1 AND deleted_at IS NULL ORDER BY sort_order, id',
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
  // Rewrites the routine tree for this program. Used by POST and PUT.
  // Each of the three levels (routines → exercises → substitutes) is written in a
  // single batched INSERT rather than a query per row, so saving a full program is
  // a handful of round-trips instead of dozens.
  //
  // The old rows are RETIRED, not deleted. workouts.routine_id is ON DELETE SET NULL
  // and routine_exercises cascades from routines — so deleting here would strip the
  // prescribed sets/reps/RIR/rest off every workout already logged against this
  // program. Retired rows are excluded from every read but keep that history intact.
  await client.query(
    'UPDATE routines SET deleted_at = NOW() WHERE program_id = $1 AND deleted_at IS NULL',
    [programId]
  );
  if (!routines || !routines.length) return;

  // 1) Routines.
  const routinePayload = routines.map((r, i) => ({ idx: i, name: r.name }));
  const rRes = await client.query(
    `INSERT INTO routines (program_id, name, sort_order)
     SELECT $1, name, idx FROM jsonb_to_recordset($2::jsonb) AS x(idx int, name text)
     RETURNING id, sort_order`,
    [programId, JSON.stringify(routinePayload)]
  );
  const routineIdByIdx = {};
  for (const row of rRes.rows) routineIdByIdx[row.sort_order] = row.id;

  // 2) Exercises across all routines, flattened. sort_order carries the per-routine
  //    index so substitutes can be reattached by (routine_id, sort_order).
  const rePayload = [];
  routines.forEach((r, ri) => {
    (r.exercises || []).forEach((ex, ei) => {
      const targetSets = ex.target_sets ?? 3;
      const rirArr = Array.isArray(ex.target_rir_per_set) ? ex.target_rir_per_set : [];
      const normalizedRir = Array.from({ length: targetSets }, (_, k) => {
        const n = Number(rirArr[k]);
        return Number.isFinite(n) ? n : null;
      });
      // Keep rest consistent with the "low is the minimum" model: a lone upper
      // bound becomes the minimum, and an upper bound not above the minimum is dropped.
      let restLow = ex.rest_seconds ?? null;
      let restHigh = ex.rest_seconds_high ?? null;
      if (restHigh != null && restLow == null) { restLow = restHigh; restHigh = null; }
      if (restHigh != null && restLow != null && restHigh <= restLow) restHigh = null;
      rePayload.push({
        routine_id: routineIdByIdx[ri],
        sort_order: ei,
        exercise_id: ex.exercise_id,
        target_sets: targetSets,
        rep_range_low: ex.rep_range_low ?? null,
        rep_range_high: ex.rep_range_high ?? null,
        target_rir_per_set: normalizedRir,
        rest_seconds: restLow,
        rest_seconds_high: restHigh,
        notes: ex.notes ?? null,
        warmup_sets_low: ex.warmup_sets_low ?? null,
        warmup_sets_high: ex.warmup_sets_high ?? null,
        is_main: ex.is_main === true,
      });
    });
  });
  if (!rePayload.length) return;

  const reRes = await client.query(
    `INSERT INTO routine_exercises
       (routine_id, exercise_id, sort_order, target_sets, rep_range_low, rep_range_high, target_rir_per_set, rest_seconds, rest_seconds_high, notes, warmup_sets_low, warmup_sets_high, is_main)
     SELECT x.routine_id, x.exercise_id, x.sort_order, x.target_sets, x.rep_range_low, x.rep_range_high,
            COALESCE((
              SELECT array_agg(elem::int ORDER BY ord)
                FROM jsonb_array_elements_text(x.target_rir_per_set) WITH ORDINALITY AS a(elem, ord)
            ), ARRAY[]::int[]),
            x.rest_seconds, x.rest_seconds_high, x.notes, x.warmup_sets_low, x.warmup_sets_high, x.is_main
       FROM jsonb_to_recordset($1::jsonb) AS x(
         routine_id int, exercise_id int, sort_order int, target_sets int,
         rep_range_low int, rep_range_high int, target_rir_per_set jsonb,
         rest_seconds int, rest_seconds_high int, notes text, warmup_sets_low int, warmup_sets_high int, is_main boolean)
     RETURNING id, routine_id, sort_order`,
    [JSON.stringify(rePayload)]
  );
  const reIdByKey = {};
  for (const row of reRes.rows) reIdByKey[`${row.routine_id}:${row.sort_order}`] = row.id;

  // 3) Preset substitutes.
  const subPayload = [];
  routines.forEach((r, ri) => {
    (r.exercises || []).forEach((ex, ei) => {
      const reId = reIdByKey[`${routineIdByIdx[ri]}:${ei}`];
      (ex.substitutes || []).forEach((sub, si) => {
        const subExId = typeof sub === 'object' ? sub.exercise_id : sub;
        subPayload.push({ routine_exercise_id: reId, exercise_id: subExId, sort_order: si });
      });
    });
  });
  if (subPayload.length) {
    await client.query(
      `INSERT INTO routine_exercise_subs (routine_exercise_id, exercise_id, sort_order)
       SELECT routine_exercise_id, exercise_id, sort_order
         FROM jsonb_to_recordset($1::jsonb) AS x(routine_exercise_id int, exercise_id int, sort_order int)`,
      [JSON.stringify(subPayload)]
    );
  }
}

// Skipped sessions fill their slot in the sequence just like completed ones, so
// position/week/next-routine run off the combined count while the completed count
// stays a separate figure for display.
function computeProgress(program, { completed, skipped }) {
  const sequenced = completed + skipped;
  const routinesPerCycle = program.routines.length;
  if (!routinesPerCycle) {
    return {
      completed_workouts: completed,
      skipped_workouts: skipped,
      week: null,
      position_in_cycle: null,
      next_routine: null,
      total_workouts: program.total_weeks,
    };
  }
  const openEnded = program.total_weeks == null;
  const totalWorkouts = openEnded ? null : program.total_weeks * routinesPerCycle;
  const week = Math.floor(sequenced / routinesPerCycle) + 1;
  const positionInCycle = (sequenced % routinesPerCycle) + 1;
  const finished = !openEnded && sequenced >= totalWorkouts;
  const nextRoutine = finished ? null : program.routines[sequenced % routinesPerCycle];
  return {
    completed_workouts: completed,
    skipped_workouts: skipped,
    total_workouts: totalWorkouts,
    week,
    position_in_cycle: positionInCycle,
    next_routine: nextRoutine,
  };
}

// Normalizes a request body's total_weeks. Distinguishes absent (caller decides
// the default) from null/'' (open-ended) from a fixed length (integer >= 1),
// and flags anything else invalid so the route can 400.
function normalizeTotalWeeks(body) {
  if (!('total_weeks' in body)) return { present: false };
  const raw = body.total_weeks;
  if (raw === null || raw === '') return { present: true, valid: true, value: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return { present: true, valid: false };
  return { present: true, valid: true, value: n };
}

const TOTAL_WEEKS_ERROR = 'total_weeks must be an integer >= 1, or null for an open-ended program';

// ─── Routes ────────────────────────────────────────────────────────

// GET /api/programs — list all programs (summary)
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT p.*,
              COUNT(DISTINCT r.id)::int AS routine_count,
              COUNT(DISTINCT w.id) FILTER (WHERE w.status = 'completed')::int AS completed_workouts,
              COUNT(DISTINCT w.id) FILTER (WHERE w.status = 'skipped')::int AS skipped_workouts
         FROM programs p
         LEFT JOIN routines r ON r.program_id = p.id AND r.deleted_at IS NULL
         LEFT JOIN workouts w ON w.program_id = p.id
        GROUP BY p.id
        ORDER BY (p.status = 'active') DESC, p.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    serverError(res, err);
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
      `SELECT COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
              COUNT(*) FILTER (WHERE status = 'skipped')::int AS skipped
         FROM workouts WHERE program_id = $1`,
      [program.id]
    );
    res.json({ ...program, progress: computeProgress(program, countRes.rows[0]) });
  } catch (err) {
    serverError(res, err);
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
    serverError(res, err);
  } finally {
    client.release();
  }
});

// POST /api/programs — create draft program with routines tree
router.post('/', async (req, res) => {
  const { name, description, routines } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  // Absent → default 12 weeks; null/'' → open-ended; number → validated >= 1.
  const tw = normalizeTotalWeeks(req.body);
  if (tw.present && !tw.valid) return res.status(400).json({ error: TOTAL_WEEKS_ERROR });
  const totalWeeks = tw.present ? tw.value : 12;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO programs (name, description, total_weeks)
       VALUES ($1, $2, $3) RETURNING *`,
      [name, description || null, totalWeeks]
    );
    await writeRoutines(client, rows[0].id, routines);
    await client.query('COMMIT');
    const full = await fetchProgramTree(client, rows[0].id);
    res.status(201).json(full);
  } catch (err) {
    await client.query('ROLLBACK');
    serverError(res, err);
  } finally {
    client.release();
  }
});

// PUT /api/programs/:id — replace metadata + full routine tree
router.put('/:id', async (req, res) => {
  const { name, description, routines } = req.body;
  // total_weeks is set exactly when the key is present (so it can be cleared to
  // null for an open-ended program); otherwise it's left untouched.
  const tw = normalizeTotalWeeks(req.body);
  if (tw.present && !tw.valid) return res.status(400).json({ error: TOTAL_WEEKS_ERROR });
  // Same present-vs-absent distinction for description: COALESCE would read a
  // cleared field as "not provided" and silently restore the old text.
  const descPresent = 'description' in req.body;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE programs SET
         name = COALESCE($1, name),
         description = CASE WHEN $2::boolean THEN $3 ELSE description END,
         total_weeks = CASE WHEN $4::boolean THEN $5 ELSE total_weeks END
       WHERE id = $6 RETURNING *`,
      [name, descPresent, descPresent ? (description || null) : null, tw.present, tw.present ? tw.value : null, req.params.id]
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
    serverError(res, err);
  } finally {
    client.release();
  }
});

// DELETE /api/programs/:id
router.delete('/:id', async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "DELETE FROM workouts WHERE program_id = $1 AND status = 'in_progress'",
      [req.params.id]
    );
    const { rowCount } = await client.query('DELETE FROM programs WHERE id = $1', [req.params.id]);
    if (!rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Program not found' });
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    serverError(res, err);
  } finally {
    client.release();
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
    serverError(res, err);
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
    serverError(res, err);
  }
});

module.exports = router;
