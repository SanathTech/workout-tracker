// The autosave loop's invariants, driven with fake timers so a 20-second deadline
// costs nothing. Every case here is a bug that actually reached the gym.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaveLoop, SaveDeadlineError } from '../src/util/saveLoop.js';

// A controllable clock: `schedule` records callbacks, `advance` fires the due ones.
function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  return {
    schedule: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clear: (id) => { timers.delete(id); },
    async advance(ms) {
      now += ms;
      const due = [...timers.entries()].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at);
      for (const [id, t] of due) { timers.delete(id); t.fn(); }
      // Let any promise continuations settle before the assertions run.
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
    },
    get pendingTimers() { return timers.size; },
  };
}

const flushMicrotasks = () => new Promise((r) => setImmediate(r));

test('a request that never settles does not wedge the loop', async () => {
  const clock = fakeClock();
  const statuses = [];
  let aborted = false;
  // The 2026-08-13 / 08-17 failure: the OS tears down the XHR while the app is frozen.
  // The promise never resolves AND never rejects, and aborting a dead request dispatches
  // no event — so abort alone can never free the loop.
  const loop = createSaveLoop({
    send: (_payload, { signal }) => {
      signal.addEventListener('abort', () => { aborted = true; });
      return new Promise(() => {});
    },
    onStatus: (s) => statuses.push(s),
    schedule: clock.schedule,
    clear: clock.clear,
  });

  loop.setPending('v1');
  const run = loop.flush();
  await flushMicrotasks();
  assert.equal(loop.inFlight, true, 'run is in flight before the deadline');

  await clock.advance(20_000);
  await run;

  assert.equal(aborted, true, 'the dead request is aborted at the network layer');
  assert.equal(loop.inFlight, false, 'the run settled instead of hanging forever');
  assert.deepEqual(statuses, ['saving', 'error']);
});

test('after a deadline the payload is re-sent, not assumed saved', async () => {
  const clock = fakeClock();
  const sent = [];
  let hang = true;
  const loop = createSaveLoop({
    send: (payload) => {
      sent.push(payload);
      if (hang) return new Promise(() => {});
      return Promise.resolve({ ok: true });
    },
    schedule: clock.schedule,
    clear: clock.clear,
  });

  loop.setPending('v1');
  const first = loop.flush();
  await flushMicrotasks();
  await clock.advance(20_000);
  await first;
  assert.deepEqual(sent, ['v1']);

  // The abort may have raced a request already on the wire, so "saved" is unknowable.
  assert.equal(loop.lastSaved, null, 'the baseline is forgotten after a deadline');
  assert.equal(loop.isDirty(), true, 'still dirty, so Finish will not pass silently');

  hang = false;
  await clock.advance(3_000); // the scheduled retry
  await flushMicrotasks();
  assert.deepEqual(sent, ['v1', 'v1'], 'the retry re-sends rather than trusting the timeout');
  assert.equal(loop.isDirty(), false);
});

test('single flight: concurrent callers share one run, and no second request goes out', async () => {
  const clock = fakeClock();
  let inFlight = 0;
  let maxConcurrent = 0;
  let release;
  const loop = createSaveLoop({
    send: () => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      return new Promise((res) => { release = () => { inFlight -= 1; res({ ok: true }); }; });
    },
    schedule: clock.schedule,
    clear: clock.clear,
  });

  loop.setPending('v1');
  const a = loop.flush();
  const b = loop.flush();
  assert.equal(a, b, 'the second caller awaits the same run');
  await flushMicrotasks();
  release();
  await a;
  assert.equal(maxConcurrent, 1);
});

test('the loop re-reads pending, so a newer edit is not overwritten by a slow response', async () => {
  const clock = fakeClock();
  const sent = [];
  const releases = [];
  const loop = createSaveLoop({
    send: (payload) => {
      sent.push(payload);
      return new Promise((res) => releases.push(() => res({ ok: true })));
    },
    schedule: clock.schedule,
    clear: clock.clear,
  });

  loop.setPending('v1');
  const run = loop.flush();
  await flushMicrotasks();
  loop.setPending('v2'); // typed while v1 is still in the air
  releases[0]();
  await flushMicrotasks();
  releases[1]?.();
  await run;

  assert.deepEqual(sent, ['v1', 'v2'], 'the newer payload is sent after the older one lands');
  assert.equal(loop.lastSaved, 'v2');
  assert.equal(loop.isDirty(), false);
});

test('retry backs off and resets after a success', async () => {
  const clock = fakeClock();
  let fail = true;
  const attempts = [];
  const loop = createSaveLoop({
    send: (p) => { attempts.push(p); return fail ? Promise.reject(new Error('offline')) : Promise.resolve({ ok: true }); },
    schedule: clock.schedule,
    clear: clock.clear,
  });

  loop.setPending('v1');
  await loop.flush();
  assert.equal(attempts.length, 1);

  await clock.advance(3_000);   // 1500 * 2
  assert.equal(attempts.length, 2);
  await clock.advance(5_999);
  assert.equal(attempts.length, 2, 'the next retry waits the doubled delay');
  await clock.advance(1);       // 6000
  assert.equal(attempts.length, 3);

  fail = false;
  await clock.advance(12_000);
  await flushMicrotasks();
  assert.equal(loop.isDirty(), false);

  // A later failure starts from the base delay again rather than the capped one.
  fail = true;
  loop.setPending('v2');
  await loop.flush();
  const before = attempts.length;
  await clock.advance(3_000);
  assert.equal(attempts.length, before + 1, 'backoff reset after the success');
});

test('lastSaved only advances on a confirmed success', async () => {
  const clock = fakeClock();
  const loop = createSaveLoop({
    send: () => Promise.reject(new Error('500')),
    schedule: clock.schedule,
    clear: clock.clear,
  });
  loop.setPending('v1');
  await loop.flush();
  assert.equal(loop.lastSaved, null);
  assert.equal(loop.isDirty(), true, 'a failed save must never report clean');
});

// The 2026-08-20 wedge: 21 minutes, zero requests issued, while sets were being logged.
// The deadline is meant to make this impossible and did not, so the loop no longer trusts
// it — a run older than the stall window is abandoned and replaced. This test does not
// care WHY the run hung, which is the point of it.
test('a run that hangs past the stall window is abandoned, and saving resumes', async () => {
  const clock = fakeClock();
  let t = 0;
  const sent = [];
  let hang = true;
  let aborted = 0;
  const loop = createSaveLoop({
    send: (payload, { signal }) => {
      sent.push(payload);
      signal.addEventListener('abort', () => { aborted += 1; });
      // Neither resolves nor rejects, and — unlike the deadline test — the scheduled
      // deadline never fires either. This is the failure the deadline did not catch.
      if (hang) return new Promise(() => {});
      return Promise.resolve({ ok: true });
    },
    // Timers frozen: nothing scheduled ever runs, so only the stall check can free it.
    schedule: () => 1,
    clear: () => {},
    now: () => t,
    stallMs: 45_000,
  });

  loop.setPending('v1');
  loop.flush();
  await flushMicrotasks();
  assert.deepEqual(sent, ['v1'], 'the first attempt goes out');

  // Still inside the window: the caller is handed the existing run, no second request.
  t = 30_000;
  loop.flush();
  await flushMicrotasks();
  assert.deepEqual(sent, ['v1'], 'a healthy in-flight run is not duplicated');
  assert.equal(loop.stalls, 0);

  // Past it: cut the dead run loose and start again.
  hang = false;
  t = 46_000;
  await loop.flush();
  await flushMicrotasks();
  assert.equal(loop.stalls, 1, 'the stall is counted');
  assert.equal(aborted, 1, 'the abandoned request is aborted at the network layer');
  assert.deepEqual(sent, ['v1', 'v1'], 'the payload is re-sent rather than assumed saved');
  assert.equal(loop.isDirty(), false, 'the loop is clean again without a remount');
});

test('the event log records what the loop did', async () => {
  const clock = fakeClock();
  const loop = createSaveLoop({
    send: () => Promise.resolve({ ok: true }),
    schedule: clock.schedule,
    clear: clock.clear,
  });
  loop.setPending('v1');
  await loop.flush();
  const types = loop.getEvents().map((e) => e.type);
  assert.deepEqual(types, ['flush', 'send', 'saved']);
  assert.ok(loop.getEvents().every((e) => typeof e.t === 'number'), 'every event is timestamped');
});

test('SaveDeadlineError is distinguishable from a network error', async () => {
  const clock = fakeClock();
  let seen = null;
  const loop = createSaveLoop({
    send: () => new Promise(() => {}),
    onStatus: () => {},
    schedule: clock.schedule,
    clear: clock.clear,
  });
  loop.setPending('v1');
  const run = loop.flush();
  await flushMicrotasks();
  await clock.advance(20_000);
  await run;
  // The type is what lets the UI say "still trying" rather than "check your connection".
  assert.ok(new SaveDeadlineError(20_000) instanceof Error);
  assert.equal(new SaveDeadlineError(20_000).name, 'SaveDeadlineError');
  assert.equal(seen, null);
});
