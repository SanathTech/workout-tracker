// The one instruction per exercise, from the progression engine. Coach notes used to
// compete for it (and override it); they went in the 2026-11-03 strip-back, so the aim is
// the engine's verdict in the shape the session renders.
//
// `rir` falls back to the routine's first-set target, so "Aim 52.5 kg × 6 · RIR 1" reads
// the program's effort target alongside the engine's load.

function pickReps(engine) {
  if (engine.action === 'increase') return engine.suggested_reps_low ?? null;
  if (engine.action === 'hold') return engine.suggested_reps_next ?? engine.suggested_reps_low ?? null;
  return null;
}

function resolveAim(engine, targetRirPerSet) {
  if (engine.action !== 'increase' && engine.action !== 'hold') return { aim: null };
  const rir = Array.isArray(targetRirPerSet) ? targetRirPerSet.find((r) => r != null) ?? null : null;
  return {
    aim: {
      weight_kg: engine.suggested_weight_kg ?? null,
      reps: pickReps(engine),
      // The ceiling, for the per-row "one more than last time" ghost on a hold.
      reps_high: engine.suggested_reps_high ?? null,
      rir,
      why: engine.reason,
      // Lets the upcoming-exercise line draw its ↑ without re-deriving the verdict.
      action: engine.action,
    },
  };
}

module.exports = { resolveAim };
