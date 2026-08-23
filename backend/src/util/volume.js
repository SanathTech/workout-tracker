// The kg a set actually moved.
//
// `weight_kg` is what was hanging off him, and on the movements where his own body is
// the load that is the wrong number twice over: a bodyweight dip logs 0 and reads as no
// work at all, and an assisted pull-up logs the ASSISTANCE as a negative and reads as
// work destroyed. Day A on 20 Aug 2026 totalled -21kg — 600kg of squats, three sets of
// dips at "0", and three sets of pull-ups at -23kg — and the weekly review wrote the
// session off as a data entry glitch. It wasn't. It was a completed workout the
// arithmetic could not describe.
//
// So a bodyweight exercise carries his weight that day plus whatever was added (or minus
// what the machine took), floored at zero: an over-assisted set is weightless, never a
// subtraction from the rest of the session.
//
// Deliberately confined to VOLUME. Progression, personal bests and estimated 1RM still
// rank on weight_kg alone — -23kg to -20.5kg is the axis he actually moves along on an
// assisted lift, and folding bodyweight in would score a heavier morning as progress.

// Both joins are LEFT: `workouts` history counts sessions with no exercises logged yet,
// and an inner join would silently drop them from the list.
const LOAD_JOINS = (we = 'we', w = 'w') => `
    LEFT JOIN exercises bw_ex ON bw_ex.id = ${we}.exercise_id
    LEFT JOIN LATERAL (
      SELECT src.weight_kg
        FROM (SELECT date, weight_kg FROM bodyweight_logs WHERE weight_kg IS NOT NULL
              UNION ALL
              SELECT date, weight_kg FROM training_load WHERE weight_kg IS NOT NULL) src
       WHERE src.date <= ${w}.date
       ORDER BY src.date DESC
       LIMIT 1
    ) bw_at ON TRUE`;

// Sessions logged before the scale has any reading fall back to the bar alone, which is
// wrong but bounded — the floor stops it going negative, and every session in the log is
// covered by the Garmin series.
const LOAD_KG = (set = 'ws') => `GREATEST(COALESCE(${set}.weight_kg, 0)
      + CASE WHEN bw_ex.is_bodyweight THEN COALESCE(bw_at.weight_kg, 0) ELSE 0 END, 0)`;

const SET_VOLUME = (set = 'ws') => `${LOAD_KG(set)} * ${set}.reps`;

module.exports = { LOAD_JOINS, LOAD_KG, SET_VOLUME };
