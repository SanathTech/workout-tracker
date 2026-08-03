import { useEffect, useRef, useState, useCallback } from 'react';
import { CloseIcon } from './icons';

// Deadline-based, not tick-based. A phone locked in a pocket throttles or suspends
// timers, so counting down a stored `remaining` drifts badly over a 3-minute rest.
// Storing the target timestamp means the display is correct the instant the screen
// wakes, however long it was asleep.
// Vibration alone is inaudible in a pocket and a no-op on iOS, so a rest that ends while
// the screen is off used to pass unannounced. The context is created on the tap that
// starts the rest — a user gesture — which is what lets it make sound later.
let audioCtx = null;
function primeAudio() {
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    if (!audioCtx) audioCtx = new Ctor();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* audio unavailable — vibration and the visible timer still work */ }
}

function playTones() {
  const at = audioCtx.currentTime;
  for (const [i, freq] of [880, 1174].entries()) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    // Ramped, not switched: a square-edged gain change clicks.
    const start = at + i * 0.18;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.25, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(start);
    osc.stop(start + 0.18);
  }
}

function beep() {
  try {
    if (!audioCtx) return;
    // A locked or backgrounded phone suspends the context — which is precisely when the
    // rest ends unwatched, so bailing out on a non-running state would skip the alert in
    // the only case it exists for. Resume first; the context was already unlocked by the
    // tap that started the rest, so this doesn't need a fresh gesture.
    if (audioCtx.state === 'running') { playTones(); return; }
    audioCtx.resume().then(playTones).catch(() => { /* OS refused — vibration still fires */ });
  } catch { /* best effort */ }
}

// Only when permission is already granted — a rest timer is the wrong moment to throw a
// permission prompt in front of someone mid-set.
function notifyRestOver() {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (document.visibilityState === 'visible') return;
    new Notification('Rest over', { body: 'Next set.', tag: 'wt-rest', silent: false });
  } catch { /* best effort */ }
}

export function useRestTimer() {
  const [endsAt, setEndsAt] = useState(null);
  const [target, setTarget] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!endsAt) return undefined;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [endsAt]);

  // Re-read the clock the moment the tab is shown again, so an unlocked phone doesn't
  // display a stale value for up to a tick.
  useEffect(() => {
    const onVisible = () => setNow(Date.now());
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);

  const start = useCallback((seconds) => {
    if (!seconds || seconds <= 0) return;
    primeAudio();
    setTarget(seconds);
    setEndsAt(Date.now() + seconds * 1000);
    setNow(Date.now());
  }, []);

  const stop = useCallback(() => {
    setEndsAt(null);
    setTarget(null);
  }, []);

  const adjust = useCallback((deltaSeconds) => {
    setEndsAt((prev) => (prev ? Math.max(Date.now(), prev + deltaSeconds * 1000) : prev));
  }, []);

  const remaining = endsAt ? Math.max(0, Math.round((endsAt - now) / 1000)) : null;
  return { remaining, target, running: endsAt != null, start, stop, adjust };
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// Renders in the flow, inside the session's fixed action bar — floating above it meant
// covering a set row that couldn't be scrolled out from under it.
export default function RestTimer({ remaining, target, onStop, onAdjust }) {
  const doneRef = useRef(false);

  useEffect(() => {
    if (remaining === null) { doneRef.current = false; return; }
    if (remaining === 0 && !doneRef.current) {
      doneRef.current = true;
      beep();
      notifyRestOver();
      try { navigator.vibrate?.([120, 60, 120]); } catch { /* not supported */ }
    }
  }, [remaining]);

  if (remaining === null) return null;

  const done = remaining === 0;
  const pct = target ? Math.min(100, Math.max(0, ((target - remaining) / target) * 100)) : 0;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`mt-2 rounded-lg border overflow-hidden ${
        done
          ? 'bg-emerald-600 border-emerald-500 text-white'
          : 'bg-neutral-900 border-neutral-700 text-white dark:bg-neutral-900 dark:border-neutral-700'
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="text-lg font-semibold tabular-nums w-14">{mmss(remaining)}</span>
        <span className="text-xs opacity-80 flex-1">{done ? 'Rest over' : 'Resting'}</span>
        <button
          type="button"
          onClick={() => onAdjust(-15)}
          aria-label="Take 15 seconds off the rest"
          className="text-xs w-11 h-11 rounded hover:bg-white/15 tabular-nums"
        >
          −15s
        </button>
        <button
          type="button"
          onClick={() => onAdjust(15)}
          aria-label="Add 15 seconds to the rest"
          className="text-xs w-11 h-11 rounded hover:bg-white/15 tabular-nums"
        >
          +15s
        </button>
        <button
          type="button"
          onClick={onStop}
          aria-label="Dismiss rest timer"
          className="w-11 h-11 flex items-center justify-center rounded opacity-70 hover:opacity-100 hover:bg-white/15"
        >
          <CloseIcon />
        </button>
      </div>
      {!done && (
        <div className="h-0.5 bg-white/15">
          <div className="h-full bg-white/60 transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
