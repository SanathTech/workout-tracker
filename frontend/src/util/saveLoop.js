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

// A stalled run is one that has been in flight far longer than any real request should
// take. The deadline below is supposed to make that impossible — and yet the loop wedged
// again on 2026-08-20, with zero requests issued for 21 minutes while sets were being
// logged. Rather than guess at a fourth root cause, this makes the wedge survivable: any
// run older than STALL_MS is abandoned and replaced, which is exactly what leaving the
// page and coming back does by hand, and what fixed it every time.
const STALL_MS = 45_000;

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
  // Injectable so tests can drive elapsed time without waiting for it.
  now = () => Date.now(),
  stallMs = STALL_MS,
} = {}) {
  let pending = null;
  let lastSaved = null;
  let running = null;
  let retryTimer = null;
  let retryDelay = retryBase;
  let runStartedAt = null;
  let abandonCurrent = null;   // aborts the in-flight attempt of the current run
  let stalls = 0;
  // A short history of what the loop actually did, so the next time this goes wrong
  // there is evidence instead of inference. Four incidents in, every diagnosis so far
  // has been reconstructed from HTTP logs after the fact.
  const events = [];
  const record = (type, detail) => {
    events.push({ t: now(), type, ...(detail === undefined ? {} : { detail }) });
    if (events.length > 60) events.shift();
  };

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
    abandonCurrent = () => ctrl.abort();
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
      abandonCurrent = null;
      // After a deadline we do not know whether the write landed — the abort may have
      // raced a request already on the wire. Forget the baseline so the next pass
      // re-sends rather than assuming we are in sync with the server.
      if (timedOut) lastSaved = null;
    }
  }

  function flush() {
    if (running) {
      // The single-flight guard is what makes a hung run fatal: every later trigger gets
      // handed the same dead promise. Age it out rather than trusting it forever.
      if (runStartedAt != null && now() - runStartedAt > stallMs) {
        stalls += 1;
        record('stalled', now() - runStartedAt);
        try { abandonCurrent?.(); } catch { /* aborting a dead request can throw */ }
        abandonCurrent = null;
        running = null;
        runStartedAt = null;
        // The abandoned attempt may still be on the wire, so what the server holds is
        // unknowable. Forget the baseline and re-send.
        lastSaved = null;
      } else {
        return running;
      }
    }
    cancelRetry();
    runStartedAt = now();
    record('flush');
    const run = (async () => {
      try {
        while (pending != null && pending !== lastSaved) {
          const snapshot = pending;
          onStatus('saving');
          try {
            record('send');
            const response = await attempt(snapshot);
            lastSaved = snapshot;
            record('saved');
            onSaved(response);
          } catch (err) {
            record(err?.name === 'SaveDeadlineError' ? 'deadline' : 'error', err?.message);
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
        runStartedAt = null;
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
    // Diagnostics. `stalls` is surfaced in the UI: if it is ever non-zero, the watchdog
    // did something the user would otherwise have had to do by hand.
    get stalls() { return stalls; },
    getEvents() { return events.slice(); },
    // Baseline after hydration: what the server already has.
    setBaseline(payload) { lastSaved = payload; },
    get pending() { return pending; },
    get lastSaved() { return lastSaved; },
    get inFlight() { return running != null; },
  };
}
