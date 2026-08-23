const express = require('express');
const router = express.Router();
const db = require('../db');
const { serverError } = require('../util/errors');
const { resolveWorkoutDate, isValidDateString } = require('../util/dates');
const { LOAD_JOINS, SET_VOLUME } = require('../util/volume');

// Only 'working' counts toward volume, 1RM estimates and personal bests. 'drop' and
// 'failure' are working sets taken past the prescribed stopping point — they still count
// as hard sets, so they're stored distinctly but not excluded anywhere.
const SET_TYPES = new Set(['working', 'warmup', 'drop', 'failure']);

// A skipped session logs nothing but still occupies its slot in the routine
// sequence, so it counts alongside completed ones everywhere position is derived.
async function countSequencedWorkouts(client, programId) {
  const { rows } = await client.query(
    "SELECT COUNT(*)::int AS n FROM workouts WHERE program_id = $1 AND status IN ('completed', 'skipped')",
    [programId]
  );
  return rows[0].n;
}

// Resolves the snapshot fields a new workout row carries: the routine name, its
// program, and which week of that program the session lands in. The routine owns
// the program link — a caller-supplied program_id can't contradict it, which would
// otherwise file the workout under a program whose sequence it isn't part of.
async function resolveRoutineContext(client, routineId) {
  const rRes = await client.query(
    'SELECT id, name, program_id FROM routines WHERE id = $1 AND deleted_at IS NULL',
    [routineId]
  );
  if (!rRes.rows.length) return null;

  const programId = rRes.rows[0].program_id;
  let programWeek = null;
  if (programId) {
    const rcRes = await client.query(
      'SELECT COUNT(*)::int AS n FROM routines WHERE program_id = $1 AND deleted_at IS NULL',
      [programId]
    );
    const perCycle = rcRes.rows[0].n || 1;
    programWeek = Math.floor((await countSequencedWorkouts(client, programId)) / perCycle) + 1;
  }
  return { routineName: rRes.rows[0].name, programId, programWeek };
}

async function maybeCompleteProgram(client, programId) {
  if (!programId) return;
  const pRes = await client.query('SELECT total_weeks, status FROM programs WHERE id = $1', [programId]);
  if (!pRes.rows.length || pRes.rows[0].status !== 'active') return;

  if (pRes.rows[0].total_weeks == null) return; // open-ended program never auto-completes

  const rRes = await client.query(
    'SELECT COUNT(*)::int AS n FROM routines WHERE program_id = $1 AND deleted_at IS NULL',
    [programId]
  );

  const routinesPerCycle = rRes.rows[0].n;
  if (!routinesPerCycle) return;
  const targetWorkouts = pRes.rows[0].total_weeks * routinesPerCycle;

  if ((await countSequencedWorkouts(client, programId)) >= targetWorkouts) {
    await client.query(
      "UPDATE programs SET status = 'completed', completed_at = NOW() WHERE id = $1",
      [programId]
    );
  }
}

// The mirror of maybeCompleteProgram: deleting a workout frees its slot, so a
// program that auto-completed on that session goes back to active. Left alone when
// another program has since taken the single active slot, or when the program was
// archived by hand — that end was deliberate, not a side effect of the count.
async function maybeReopenProgram(client, programId) {
  if (!programId) return;
  const pRes = await client.query('SELECT total_weeks, status FROM programs WHERE id = $1', [programId]);
  if (!pRes.rows.length || pRes.rows[0].status !== 'completed') return;
  if (pRes.rows[0].total_weeks == null) return;

  const rRes = await client.query(
    'SELECT COUNT(*)::int AS n FROM routines WHERE program_id = $1 AND deleted_at IS NULL',
    [programId]
  );
  const routinesPerCycle = rRes.rows[0].n;
  if (!routinesPerCycle) return;
  const targetWorkouts = pRes.rows[0].total_weeks * routinesPerCycle;
  if ((await countSequencedWorkouts(client, programId)) >= targetWorkouts) return;

  // The active-slot check rides along in the UPDATE rather than preceding it, so
  // there's no window between the two for another program to claim the slot.
  await client.query(
    `UPDATE programs SET status = 'active', completed_at = NULL
       WHERE id = $1
         AND NOT EXISTS (SELECT 1 FROM programs WHERE status = 'active' AND id <> $1)`,
    [programId]
  );
}

// Rewrites a workout's exercise+set tree in two batched statements (a DELETE and
// a single CTE INSERT) instead of one query per exercise and one per set. This is
// what the autosave PUT hits on every keystroke, so collapsing the round-trips
// matters — especially with the DB a region away.
async function writeWorkoutExercises(client, workoutId, exercises) {
  // Only an array applies. A non-array (e.g. null) is "not provided" — never wipe
  // existing rows for it. An empty array is a valid "clear all exercises".
  if (!Array.isArray(exercises)) return;
  await client.query('DELETE FROM workout_exercises WHERE workout_id = $1', [workoutId]);
  if (!exercises.length) return;

  const exPayload = exercises.map((ex, i) => ({
    idx: i,
    exercise_id: ex.exercise_id,
    notes: ex.notes || null,
  }));
  const setPayload = [];
  exercises.forEach((ex, i) => {
    for (const s of ex.sets || []) {
      setPayload.push({
        ex_idx: i,
        set_number: s.set_number,
        reps: s.reps ?? null,
        weight_kg: s.weight_kg ?? null,
        rir: s.rir ?? null,
        // Anything unrecognised is stored as a working set: a typo must not quietly
        // remove a set from every volume total.
        set_type: SET_TYPES.has(s.set_type) ? s.set_type : 'working',
        // Client clock, validated loosely: an unparseable stamp becomes null rather
        // than failing the save — the set matters more than its timestamp.
        logged_at: Number.isFinite(Date.parse(s.logged_at)) ? new Date(s.logged_at).toISOString() : null,
      });
    }
  });

  // ins_ex is a data-modifying CTE, so it always inserts every exercise even when
  // there are no sets to join to; sets attach by matching sort_order to ex_idx.
  await client.query(
    `WITH ins_ex AS (
       INSERT INTO workout_exercises (workout_id, exercise_id, sort_order, notes)
       SELECT $1, exercise_id, idx, notes
         FROM jsonb_to_recordset($2::jsonb) AS x(idx int, exercise_id int, notes text)
       RETURNING id, sort_order
     )
     INSERT INTO workout_sets (workout_exercise_id, set_number, reps, weight_kg, rir, set_type, logged_at)
     SELECT ins_ex.id, s.set_number, s.reps, s.weight_kg, s.rir, s.set_type, s.logged_at
       FROM jsonb_to_recordset($3::jsonb)
              AS s(ex_idx int, set_number int, reps int, weight_kg numeric, rir int, set_type text, logged_at timestamptz)
       JOIN ins_ex ON ins_ex.sort_order = s.ex_idx`,
    [workoutId, JSON.stringify(exPayload), JSON.stringify(setPayload)]
  );
}

async function fetchWorkout(id) {
  // The workout row and its exercise rows both key off the id param, so fetch them
  // together; then sets and routine targets together; then substitutes.
  const [wRes, exRes] = await Promise.all([
    db.query(
      `SELECT w.*, p.name AS program_name
         FROM workouts w
         LEFT JOIN programs p ON p.id = w.program_id
        WHERE w.id = $1`,
      [id]
    ),
    db.query(
      `SELECT we.*, e.name AS exercise_name, e.muscle_group
         FROM workout_exercises we
         JOIN exercises e ON e.id = we.exercise_id
        WHERE we.workout_id = $1
        ORDER BY we.sort_order, we.id`,
      [id]
    ),
  ]);
  if (!wRes.rows.length) return null;
  const workout = wRes.rows[0];
  const exRows = exRes.rows;
  const exIds = exRows.map((r) => r.id);

  const [setRows, targetRows] = await Promise.all([
    exIds.length
      ? db.query(
          `SELECT * FROM workout_sets
            WHERE workout_exercise_id = ANY($1::int[])
            ORDER BY workout_exercise_id, set_number`,
          [exIds]
        ).then((r) => r.rows)
      : Promise.resolve([]),
    workout.routine_id
      ? db.query(
          `SELECT id, exercise_id, target_sets, rep_range_low, rep_range_high, target_rir_per_set, rest_seconds, rest_seconds_high, notes, warmup_sets_low, warmup_sets_high, is_main
             FROM routine_exercises
            WHERE routine_id = $1`,
          [workout.routine_id]
        ).then((r) => r.rows)
      : Promise.resolve([]),
  ]);

  const setsByEx = {};
  for (const s of setRows) {
    (setsByEx[s.workout_exercise_id] = setsByEx[s.workout_exercise_id] || []).push(s);
  }

  const targetsByEx = {};
  for (const t of targetRows) targetsByEx[t.exercise_id] = { ...t, substitutes: [] };
  const reIds = targetRows.map((r) => r.id);
  if (reIds.length) {
    const subRes = await db.query(
      `SELECT s.routine_exercise_id, s.exercise_id, e.name AS exercise_name, e.muscle_group
         FROM routine_exercise_subs s
         JOIN exercises e ON e.id = s.exercise_id
        WHERE s.routine_exercise_id = ANY($1::int[])
        ORDER BY s.sort_order, s.id`,
      [reIds]
    );
    const reIdToExId = Object.fromEntries(targetRows.map((r) => [r.id, r.exercise_id]));
    for (const s of subRes.rows) {
      const exId = reIdToExId[s.routine_exercise_id];
      if (targetsByEx[exId]) {
        targetsByEx[exId].substitutes.push({
          exercise_id: s.exercise_id,
          exercise_name: s.exercise_name,
          muscle_group: s.muscle_group,
        });
      }
    }
  }

  return {
    ...workout,
    exercises: exRows.map((e) => ({
      ...e,
      target: targetsByEx[e.exercise_id] || null,
      sets: (setsByEx[e.id] || []).map((s) => ({
        id: s.id,
        set_number: s.set_number,
        set_type: s.set_type,
        reps: s.reps,
        weight_kg: s.weight_kg,
        rir: s.rir,
        logged_at: s.logged_at,
      })),
    })),
  };
}

router.get('/', async (req, res) => {
  const { status } = req.query;
  const rawLimit = parseInt(req.query.limit, 10);
  const limit = Number.isNaN(rawLimit) ? 50 : Math.min(Math.max(rawLimit, 1), 200);
  const rawOffset = parseInt(req.query.offset, 10);
  const offset = Number.isNaN(rawOffset) ? 0 : Math.min(Math.max(rawOffset, 0), 100000);
  const params = [limit, offset];
  let where = '';
  if (status) {
    params.push(status);
    where = `WHERE w.status = $${params.length}`;
  }
  try {
    const { rows } = await db.query(
      `SELECT w.*, p.name AS program_name,
              COUNT(DISTINCT we.id)::int AS exercise_count,
              COALESCE(SUM(${SET_VOLUME()}), 0) AS total_volume
         FROM workouts w
         LEFT JOIN programs p ON p.id = w.program_id
         LEFT JOIN workout_exercises we ON we.workout_id = w.id
         LEFT JOIN workout_sets ws ON ws.workout_exercise_id = we.id
         ${LOAD_JOINS()}
         ${where}
        GROUP BY w.id, p.name
        ORDER BY w.date DESC, w.created_at DESC
        LIMIT $1 OFFSET $2`,
      params
    );
    res.json(rows);
  } catch (err) {
    serverError(res, err);
  }
});

router.get('/recent', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT w.*, p.name AS program_name,
              COUNT(DISTINCT we.id)::int AS exercise_count
         FROM workouts w
         LEFT JOIN programs p ON p.id = w.program_id
         LEFT JOIN workout_exercises we ON we.workout_id = w.id
        WHERE w.status IN ('completed', 'skipped')
        GROUP BY w.id, p.name
        ORDER BY w.date DESC, w.created_at DESC
        LIMIT 5`
    );
    res.json(rows);
  } catch (err) {
    serverError(res, err);
  }
});

router.get('/in-progress', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT w.*, p.name AS program_name
         FROM workouts w
         LEFT JOIN programs p ON p.id = w.program_id
        WHERE w.status = 'in_progress'
        ORDER BY w.created_at DESC
        LIMIT 1`
    );
    res.json(rows[0] || null);
  } catch (err) {
    serverError(res, err);
  }
});

router.get('/last-by-exercise/:exerciseId', async (req, res) => {
  const exerciseId = parseInt(req.params.exerciseId);
  const { exclude } = req.query;
  try {
    const wRes = await db.query(
      `SELECT w.id, w.date
         FROM workouts w
         JOIN workout_exercises we ON we.workout_id = w.id
        WHERE we.exercise_id = $1
          AND w.status = 'completed'
          ${exclude ? 'AND w.id <> $2' : ''}
        ORDER BY w.date DESC, w.created_at DESC
        LIMIT 1`,
      exclude ? [exerciseId, exclude] : [exerciseId]
    );
    if (!wRes.rows.length) return res.json(null);

    const sRes = await db.query(
      `SELECT ws.set_number, ws.weight_kg, ws.reps, ws.rir, ws.set_type
         FROM workout_sets ws
         JOIN workout_exercises we ON we.id = ws.workout_exercise_id
        WHERE we.workout_id = $1 AND we.exercise_id = $2
        ORDER BY ws.set_number`,
      [wRes.rows[0].id, exerciseId]
    );
    res.json({ date: wRes.rows[0].date, sets: sRes.rows });
  } catch (err) {
    serverError(res, err);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const workout = await fetchWorkout(req.params.id);
    if (!workout) return res.status(404).json({ error: 'Workout not found' });
    res.json(workout);
  } catch (err) {
    serverError(res, err);
  }
});

router.post('/', async (req, res) => {
  const { routine_id, program_id, date, notes, exercises } = req.body;
  const client = await db.pool.connect();
  let workoutId;
  try {
    await client.query('BEGIN');

    let routineName = null;
    let programId = program_id || null;
    let programWeek = null;
    let templateExercises = exercises;

    if (routine_id) {
      const ctx = await resolveRoutineContext(client, routine_id);
      if (!ctx) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Routine not found' });
      }
      routineName = ctx.routineName;
      programId = ctx.programId;
      programWeek = ctx.programWeek;

      if (!templateExercises) {
        const teRes = await client.query(
          `SELECT exercise_id, target_sets, sort_order
             FROM routine_exercises
            WHERE routine_id = $1
            ORDER BY sort_order, id`,
          [routine_id]
        );
        templateExercises = teRes.rows.map((t) => ({
          exercise_id: t.exercise_id,
          sets: Array.from({ length: t.target_sets || 3 }, (_, i) => ({
            set_number: i + 1,
            reps: null,
            weight_kg: null,
          })),
        }));
      }
    }

    const { rows } = await client.query(
      `INSERT INTO workouts (program_id, routine_id, routine_name, program_week, date, notes, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'in_progress') RETURNING *`,
      [
        programId,
        routine_id || null,
        routineName,
        programWeek,
        resolveWorkoutDate(date),
        notes || null,
      ]
    );
    const workout = rows[0];

    await writeWorkoutExercises(client, workout.id, templateExercises);

    await client.query('COMMIT');
    workoutId = workout.id;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return serverError(res, err);
  } finally {
    client.release();
  }
  try {
    const full = await fetchWorkout(workoutId);
    res.status(201).json(full);
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/workouts/skip — bank a session as skipped without ever starting it.
// It's a real workout row (with no exercises) because rows are what move the
// routine sequence along, so the next session becomes the one after this routine.
router.post('/skip', async (req, res) => {
  const { routine_id, date, notes } = req.body;
  if (!routine_id) return res.status(400).json({ error: 'routine_id is required' });

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const ctx = await resolveRoutineContext(client, routine_id);
    if (!ctx) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Routine not found' });
    }
    const { rows } = await client.query(
      `INSERT INTO workouts (program_id, routine_id, routine_name, program_week, date, notes, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'skipped') RETURNING *`,
      [
        ctx.programId,
        routine_id,
        ctx.routineName,
        ctx.programWeek,
        resolveWorkoutDate(date),
        notes || null,
      ]
    );
    await maybeCompleteProgram(client, ctx.programId);
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    serverError(res, err);
  } finally {
    client.release();
  }
});

router.put('/:id', async (req, res) => {
  const { date, duration_minutes, notes, exercises } = req.body;
  if (date !== undefined && date !== null && !isValidDateString(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }
  // Autosave always sends `notes`, and sends null when you've cleared the field.
  // COALESCE read that as "not provided" and restored the old text, so a deleted
  // note came back on the next load. Key present means set it — including to null.
  const notesPresent = 'notes' in req.body;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE workouts SET
         date = COALESCE($1, date),
         duration_minutes = COALESCE($2, duration_minutes),
         notes = CASE WHEN $3::boolean THEN $4 ELSE notes END
       WHERE id = $5 RETURNING *`,
      [date, duration_minutes, notesPresent, notesPresent ? (notes || null) : null, req.params.id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Workout not found' });
    }

    if (exercises !== undefined) {
      await writeWorkoutExercises(client, req.params.id, exercises);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return serverError(res, err);
  } finally {
    client.release();
  }
  try {
    const full = await fetchWorkout(req.params.id);
    res.json(full);
  } catch (err) {
    serverError(res, err);
  }
});

router.post('/:id/complete', async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // Derive the session length from start to finish. Capped at 6 hours because the
    // common failure is forgetting to hit Finish until the next day — better to record
    // nothing than a 19-hour "workout". An explicit duration set via PUT always wins.
    const { rows } = await client.query(
      `UPDATE workouts
          SET status = 'completed',
              completed_at = NOW(),
              duration_minutes = COALESCE(
                duration_minutes,
                CASE WHEN NOW() - created_at <= INTERVAL '6 hours'
                     THEN GREATEST(1, ROUND(EXTRACT(EPOCH FROM (NOW() - created_at)) / 60))::int
                END
              )
        WHERE id = $1 AND status = 'in_progress' RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Workout not found or already completed' });
    }
    await maybeCompleteProgram(client, rows[0].program_id);
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    serverError(res, err);
  } finally {
    client.release();
  }
});

// POST /api/workouts/:id/skip — bail out of a session already under way. Anything
// logged on it stays on the row but stops counting, since stats read completed only.
router.post('/:id/skip', async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE workouts SET status = 'skipped'
         WHERE id = $1 AND status = 'in_progress' RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Workout not found or already finished' });
    }
    await maybeCompleteProgram(client, rows[0].program_id);
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    serverError(res, err);
  } finally {
    client.release();
  }
});

router.delete('/:id', async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'DELETE FROM workouts WHERE id = $1 RETURNING program_id',
      [req.params.id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Workout not found' });
    }
    await maybeReopenProgram(client, rows[0].program_id);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    serverError(res, err);
  } finally {
    client.release();
  }
});

module.exports = router;
