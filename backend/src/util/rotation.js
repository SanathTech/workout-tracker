// Which routine is up next (2026-11-03): the one done longest ago. The weekday schedule
// it replaced banked every day he couldn't make as a skip, and his weeks stopped having
// fixed gym days. Picking any routine is always allowed; this only orders the offer.
//
// A routine counts as done by any completed session under its id OR its name: saving the
// program editor re-inserts routines under new ids, and a rename keeps the id. Skipped
// rows don't count. An open session counts as today's, so the routine already under way
// isn't also offered as next. Never-done routines come first, ties go to program order.

// `routines` is the active program's, in display order. Returns a map of routine id →
// { last_done: 'YYYY-MM-DD' | null, in_progress } and the suggested routine.
async function rotation(client, routines, today) {
  if (!routines.length) return { byRoutine: new Map(), next: null };
  const { rows } = await client.query(
    `SELECT routine_id, routine_name, status, MAX(date) AS last
       FROM workouts
      WHERE status IN ('completed', 'in_progress')
        AND (routine_id = ANY($1::int[]) OR routine_name = ANY($2::text[]))
      GROUP BY routine_id, routine_name, status`,
    [routines.map((r) => r.id), routines.map((r) => r.name)]
  );

  const byRoutine = new Map();
  for (const r of routines) {
    const mine = rows.filter((w) => w.routine_id === r.id || w.routine_name === r.name);
    const done = mine.filter((w) => w.status === 'completed').map((w) => w.last);
    byRoutine.set(r.id, {
      last_done: done.length ? done.sort().at(-1) : null,
      in_progress: mine.some((w) => w.status === 'in_progress'),
    });
  }

  // Sort key: '' (never done) sorts before any date; an open session reads as today.
  const key = (r) => {
    const s = byRoutine.get(r.id);
    return s.in_progress ? today : s.last_done || '';
  };
  const next = routines.reduce((best, r) => (key(r) < key(best) ? r : best));
  return { byRoutine, next };
}

module.exports = { rotation };
