// Shared by every path that banks a session — the workout routes and the weekday
// schedule's auto-skip — so a finite program completes however its last slot is filled.

// A skipped session logs nothing but still occupies its slot in the routine
// sequence, so it counts alongside completed ones everywhere position is derived.
async function countSequencedWorkouts(client, programId) {
  const { rows } = await client.query(
    "SELECT COUNT(*)::int AS n FROM workouts WHERE program_id = $1 AND status IN ('completed', 'skipped')",
    [programId]
  );
  return rows[0].n;
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

module.exports = { countSequencedWorkouts, maybeCompleteProgram };
