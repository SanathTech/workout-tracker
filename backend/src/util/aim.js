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

// A load call is overtaken when his own logs have moved past the weight it pins, in a
// session logged AFTER the call was written. Both stale notes this has caught said the
// same thing in prose — "stay at 36 until RIR 1", "do not drop assistance again until
// RIR 0-1 at -18kg" — and in both cases he met the condition, moved up, and the note kept
// pinning the old rung: the hip abduction aim read 36kg while he was pulling 43 (23 Aug),
// and the pull-up aim read -18kg mid-session while he was at -14 (19 Sep).
//
// The evidence is gathered by the caller (progress.js), which asks the question of EVERY
// session since the note rather than just the latest one: a lighter day afterwards — a
// deload, a machine taken, a bad morning — must not resurrect a call his history has
// already answered.
//
// A note is never deleted by this. It steps aside, keeps its text as a cue, and says why —
// the coach still resolves it, but the phone stops issuing a number his own history has
// already answered.
function overtaken(call) {
  const by = call.overtaken_by;
  if (!by || call.aim_weight_kg == null) return null;
  return {
    note_id: call.id,
    pinned_kg: Number(call.aim_weight_kg),
    lifted_kg: Number(by.lifted_kg),
    on: by.on,
  };
}

function pickReps(engine) {
  if (engine.action === 'increase') return engine.suggested_reps_low ?? null;
  if (engine.action === 'hold') return engine.suggested_reps_next ?? engine.suggested_reps_low ?? null;
  return null;
}

// notes: the exercise's active notes, already routine-filtered, oldest first.
function resolveAim(engine, notes, targetRirPerSet) {
  const defaultRir = Array.isArray(targetRirPerSet) ? targetRirPerSet.find((r) => r != null) ?? null : null;
  const hasCall = (n) => n.aim_weight_kg != null || n.aim_reps != null || n.aim_rir != null;
  const newest = [...notes].reverse().find(hasCall) || null;
  // A call his logs have already passed does not get to issue a number.
  const superseded = newest ? overtaken(newest) : null;
  const call = superseded ? null : newest;
  // Only number-free notes are cues. An older load call the newest one superseded is
  // dropped, not demoted — "back off to 95" under an aim of 100 is a contradiction, and
  // the coach resolves the stale note rather than the phone explaining it away.
  const cues = notes
    .filter((n) => !hasCall(n) || (superseded && n.id === newest.id))
    .map((n) => ({
      id: n.id,
      note: n.note,
      // The stepped-aside call keeps its text and says what overtook it.
      superseded: superseded && n.id === newest.id ? superseded : undefined,
    }));

  if (call) {
    // A call that leaves the weight alone ("take the last set to RIR 1") keeps the
    // engine's load — the coach changed the effort, not the bar, and the kg ghosts must
    // not vanish because of it. Only a named weight replaces the engine's.
    const engineWeight = engine.suggested_weight_kg ?? null;
    const weight = call.aim_weight_kg != null ? Number(call.aim_weight_kg) : engineWeight;
    // A coach call that names the weight but not the reps ("stay at -18") still gets a
    // rep target when the engine's number is for that same load — the engine's rung is
    // the right rung then. At a different load the engine's reps belong to a different
    // bar, so they are left off rather than guessed.
    const sameLoad = weight == null || engineWeight == null || engineWeight === weight;
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
    return { aim: null, cues, superseded_note: superseded || undefined };
  }
  return {
    superseded_note: superseded || undefined,
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
