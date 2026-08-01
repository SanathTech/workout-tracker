// Offline safety net for the live session.
//
// Autosave keeps the server authoritative, but its pending payload lives in memory: kill
// the app in a gym dead-spot and everything typed since the last successful PUT is gone.
// A draft is written on every edit and removed the moment the server confirms the same
// payload, so a surviving draft means exactly one thing — unsaved work.
//
// Deliberately not React Query's persister: that cache is keyed by server state, and
// ['workout', id] is excluded from it precisely so stale server data can't overwrite live
// edits. This stores the *edits*, which is the opposite problem.

const key = (workoutId) => `wt-draft-${workoutId}`;

// localStorage throws when full or when the browser blocks storage (Safari private mode).
// Losing the safety net is survivable; taking the session down with it is not.
function safely(fn, fallback = null) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function readRaw(workoutId) {
  return safely(() => {
    const raw = window.localStorage.getItem(key(workoutId));
    return raw ? JSON.parse(raw) : null;
  });
}

// The sets alone can't rebuild the page — exercise names, targets and rep ranges live on
// the server response, and ['workout', id] is deliberately kept out of the persisted query
// cache so stale server data can't land on top of live edits. So the draft carries its own
// copy of the workout shape, letting a cold offline reload render without the network.
export function saveSnapshot(workoutId, workout) {
  return safely(() => {
    const prev = readRaw(workoutId) || {};
    window.localStorage.setItem(key(workoutId), JSON.stringify({ ...prev, workout, at: Date.now() }));
    return true;
  }, false);
}

export function saveDraft(workoutId, payloadJson) {
  return safely(() => {
    const prev = readRaw(workoutId) || {};
    window.localStorage.setItem(
      key(workoutId),
      JSON.stringify({ ...prev, payload: payloadJson, at: Date.now() })
    );
    return true;
  }, false);
}

export function readDraft(workoutId) {
  const raw = readRaw(workoutId);
  if (!raw) return null;
  return {
    payload: typeof raw.payload === 'string' ? raw.payload : null,
    workout: raw.workout && Array.isArray(raw.workout.exercises) ? raw.workout : null,
    at: typeof raw.at === 'number' ? raw.at : null,
  };
}

export function clearDraft(workoutId) {
  safely(() => window.localStorage.removeItem(key(workoutId)));
}

// Drafts for workouts finished long ago would otherwise accumulate forever, and each one
// pins a full payload in a storage bucket the query cache also shares.
export function pruneDrafts(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  safely(() => {
    const cutoff = Date.now() - maxAgeMs;
    for (const k of Object.keys(window.localStorage)) {
      if (!k.startsWith('wt-draft-')) continue;
      const at = safely(() => JSON.parse(window.localStorage.getItem(k))?.at);
      if (typeof at !== 'number' || at < cutoff) window.localStorage.removeItem(k);
    }
  });
}
