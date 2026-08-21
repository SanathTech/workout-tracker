// What the app was doing, recorded so the next question has evidence behind it.
//
// Two jobs. The autosave loop has wedged four times and every diagnosis was
// reconstructed afterwards from HTTP logs, which say what the server saw and nothing
// about what the client tried. And the layout work needs to know which affordances are
// actually used, in what order, and where a screen gets opened and immediately left —
// none of which is answerable by either of us guessing.
//
// Records ACTIONS, never values. The weights and reps are already stored as workout
// data; keystrokes would be volume without information.
//
// The hard rule: this can never cost the user anything. Every path is wrapped, failures
// are swallowed, and the buffer is bounded — dropping events is always better than
// interfering with a session.

const ENDPOINT = '/api/events';
const FLUSH_MS = 20_000;
const MAX_BUFFER = 300;   // a runaway loop cannot grow this without bound
const MAX_BATCH = 200;    // matches the server's cap

// One id per app load, which is what turns a pile of rows into a journey.
const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

let buffer = [];
let timer = null;
let route = null;
let enabled = true;

function schedule() {
  if (timer != null || !buffer.length) return;
  timer = setTimeout(() => { timer = null; flush(); }, FLUSH_MS);
}

export function setRoute(nextRoute) {
  route = nextRoute;
}

export function track(kind, name, detail, workoutId) {
  if (!enabled) return;
  try {
    if (buffer.length >= MAX_BUFFER) buffer.shift();
    buffer.push({
      ts: Date.now(),
      session_id: sessionId,
      kind,
      name,
      route,
      workout_id: workoutId ?? null,
      detail: detail ?? null,
    });
    schedule();
  } catch {
    // Telemetry must not be able to throw into the caller.
  }
}

// `keepalive` so a flush started as the app is being backgrounded still goes out —
// Android kills backgrounded PWAs without warning, and the events describing the moment
// before that are the interesting ones. Deliberately not awaited by any caller.
export async function flush() {
  if (!enabled || !buffer.length) return;
  const batch = buffer.slice(0, MAX_BATCH);
  buffer = buffer.slice(batch.length);
  try {
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
      credentials: 'same-origin',
      keepalive: true,
    });
  } catch {
    // Dropped rather than retried. A retry queue here would compete with the save loop
    // for the same flaky gym wifi, and these events are worth far less than a set.
  }
  schedule();
}

// Installed once, from main.jsx. Kept out of React so a re-render can never double up
// the listeners, and so a crash inside the tree still gets its events out.
let installed = false;

export function installTelemetry() {
  if (typeof window === 'undefined') return;
  // Idempotent: Vite HMR re-evaluates modules, and a second install would attach
  // duplicate listeners — every lifecycle event counted twice, forever.
  if (installed) return;
  installed = true;
  try {
    document.addEventListener('visibilitychange', () => {
      track('lifecycle', document.visibilityState === 'hidden' ? 'hidden' : 'visible');
      // The last reliable moment on mobile — see the same reasoning in WorkoutSession's
      // save flush. Waiting for the timer means these never leave the phone.
      if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', () => { track('lifecycle', 'pagehide'); flush(); });
    window.addEventListener('online', () => track('lifecycle', 'online'));
    window.addEventListener('offline', () => track('lifecycle', 'offline'));
    window.addEventListener('error', (e) => {
      track('error', 'window-error', { message: String(e?.message || '').slice(0, 300) });
    });
    window.addEventListener('unhandledrejection', (e) => {
      track('error', 'unhandled-rejection', { message: String(e?.reason?.message || e?.reason || '').slice(0, 300) });
    });
  } catch {
    enabled = false;
  }
}

export const telemetrySessionId = sessionId;
