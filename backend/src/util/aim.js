// The one instruction per exercise. The session used to show the engine's chip, its
// ghost placeholders, its expandable reason AND an amber coach note that was meant to
// override all of them but didn't look like it — four voices, and on 2026-09-07 the
// pull-up card contradicted itself in one screen. Precedence is decided here, once, and
// the client only renders what it is handed.
//
// Rule: a coach note that makes a load call (any of aim_weight_kg / aim_reps / aim_rir)
// IS the aim, and the engine's number is suppressed — the engine is note-blind, so when
// they disagree it is always the note that knows something. A note with no numbers is a
// cue ("chalk the hands", "use the cable version") and rides under whichever aim shows.
// Newest aim-carrying note wins if there are several.
//
// `rir` falls back to the routine's first-set target, so "Aim 52.5 kg × 6 · RIR 1" reads
// the same whether the coach said the RIR or the program did.

function pickReps(engine) {
  if (engine.action === 'increase') return engine.suggested_reps_low ?? null;
  if (engine.action === 'hold') return engine.suggested_reps_next ?? engine.suggested_reps_low ?? null;
  return null;
}

// notes: the exercise's active notes, already routine-filtered, oldest first.
function resolveAim(engine, notes, targetRirPerSet) {
  const defaultRir = Array.isArray(targetRirPerSet) ? targetRirPerSet.find((r) => r != null) ?? null : null;
  const hasCall = (n) => n.aim_weight_kg != null || n.aim_reps != null || n.aim_rir != null;
  const call = [...notes].reverse().find(hasCall) || null;
  // Only number-free notes are cues. An older load call the newest one superseded is
  // dropped, not demoted — "back off to 95" under an aim of 100 is a contradiction, and
  // the coach resolves the stale note rather than the phone explaining it away.
  const cues = notes.filter((n) => !hasCall(n)).map((n) => ({ id: n.id, note: n.note }));

  if (call) {
    const weight = call.aim_weight_kg != null ? Number(call.aim_weight_kg) : null;
    // A coach call that names the weight but not the reps ("stay at -18") still gets a
    // rep target when the engine's number is for that same load — the engine's rung is
    // the right rung then. At a different load the engine's reps belong to a different
    // bar, so they are left off rather than guessed.
    const sameLoad = weight == null || engine.suggested_weight_kg == null || engine.suggested_weight_kg === weight;
    return {
      aim: {
        source: 'coach',
        note_id: call.id,
        weight_kg: weight,
        reps: call.aim_reps ?? (sameLoad ? pickReps(engine) : null),
        reps_high: null,
        rir: call.aim_rir ?? defaultRir,
        why: call.note,
        action: null,
        // The suppressed opinion travels along for the "why" sheet, so the reader can
        // see what the coach overrode — it just never gets top billing.
        engine_reason: engine.action === 'no_history' || engine.action === 'no_target' ? null : engine.reason,
      },
      cues,
    };
  }
  if (engine.action !== 'increase' && engine.action !== 'hold') {
    return { aim: null, cues };
  }
  return {
    aim: {
      source: 'engine',
      note_id: null,
      weight_kg: engine.suggested_weight_kg ?? null,
      reps: pickReps(engine),
      // The ceiling, for the per-row "one more than last time" ghost on a hold.
      reps_high: engine.suggested_reps_high ?? null,
      rir: defaultRir,
      why: engine.reason,
      engine_reason: null,
      // Lets the upcoming-exercise line draw its ↑ without re-deriving the verdict.
      action: engine.action,
    },
    cues,
  };
}

module.exports = { resolveAim };
