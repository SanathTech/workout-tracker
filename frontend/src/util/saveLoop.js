// The session autosave loop, extracted from WorkoutSession so it can be tested without
// a browser. It has caused three separate incidents (2026-08-13, and twice on 08-17)
// and had no test coverage at all, which is how the same class of bug kept coming back.
//
// The contract is small and the invariants are the whole point:
//
//   1. Single flight. At most one request in the air; concurrent callers await the same
//      run. A second PUT racing the first can land out of order on a last-write-wins
//      server and resurrect sets the user just deleted.
//   2. The run ALWAYS settles. This is the one that kept breaking. A mobile OS can
//      freeze a backgrounded PWA and kill its in-flight XHR without the request ever
//      resolving or rejecting; every later trigger then gets handed the same dead
//      promise by the single-flight guard, and saving stops until the app is relaunched.
//   3. The loop re-reads `pending` on every iteration, so a slow response can never
//      overwrite a newer edit.
//   4. `lastSaved` only advances on a confirmed success — never optimistically.

export class SaveDeadlineError extends Error {
  constructor(ms) {
    super(`save did not settle within ${ms}ms`);
    this.name = 'SaveDeadlineError';
  }
}

export function createSaveLoop({
  // send(payload, { signal }) -> Promise<serverResponse>
  send,
  // onStatus('saving' | 'saved' | 'error')
  onStatus = () => {},
  // Called with the server's response after each confirmed save.
  onSaved = () => {},
  // Whether a retry may be scheduled (i.e. the component is still mounted).
  canRetry = () => true,
  deadlineMs = 20_000,
  retryBase = 1500,
  retryCap = 30_000,
  // Injectable so tests can drive time without waiting for it.
  schedule = setTimeout,
  clear = clearTimeout,
} = {}) {
  let pending = null;
  let lastSaved = null;
  let running = null;
  let retryTimer = null;
  let retryDelay = retryBase;

  const isDirty = () => pending != null && pending !== lastSaved;

  function cancelRetry() {
    if (retryTimer != null) { clear(retryTimer); retryTimer = null; }
  }

  // One attempt, guaranteed to settle.
  //
  // Two mechanisms, because neither is sufficient alone. The AbortController kills the
  // request at the network layer, so a zombie can't complete later and overwrite a newer
  // retry. The rejecting deadline is what actually frees the loop: aborting a request the
  // OS has already torn down can be a no-op that dispatches no event, leaving the
  // underlying promise pending forever — which is exactly the state the app got stuck in.
  // PR #70 replaced the race with abort alone and reintroduced the hang.
  async function attempt(snapshot) {
    const ctrl = new AbortController();
    let timer = null;
    let timedOut = false;
    const deadline = new Promise((_, reject) => {
      timer = schedule(() => {
        timedOut = true;
        ctrl.abort();
        reject(new SaveDeadlineError(deadlineMs));
      }, deadlineMs);
    });
    try {
      return await Promise.race([send(snapshot, { signal: ctrl.signal }), deadline]);
    } finally {
      if (timer != null) clear(timer);
      // After a deadline we do not know whether the write landed — the abort may have
      // raced a request already on the wire. Forget the baseline so the next pass
      // re-sends rather than assuming we are in sync with the server.
      if (timedOut) lastSaved = null;
    }
  }

  function flush() {
    if (running) return running;
    cancelRetry();
    const run = (async () => {
      try {
        while (pending != null && pending !== lastSaved) {
          const snapshot = pending;
          onStatus('saving');
          try {
            const response = await attempt(snapshot);
            lastSaved = snapshot;
            onSaved(response);
          } catch (err) {
            onStatus('error');
            if (canRetry() && retryTimer == null) {
              retryDelay = Math.min(retryDelay * 2, retryCap);
              retryTimer = schedule(() => { retryTimer = null; flush(); }, retryDelay);
            }
            return;
          }
        }
        // Reported only once the server genuinely holds the latest payload.
        if (pending === lastSaved) {
          onStatus('saved');
          retryDelay = retryBase;
        }
      } finally {
        running = null;
      }
    })();
    running = run;
    return run;
  }

  return {
    flush,
    isDirty,
    cancelRetry,
    setPending(payload) { pending = payload; },
    // Baseline after hydration: what the server already has.
    setBaseline(payload) { lastSaved = payload; },
    get pending() { return pending; },
    get lastSaved() { return lastSaved; },
    get inFlight() { return running != null; },
  };
}
