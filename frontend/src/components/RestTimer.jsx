import { useEffect, useRef, useState, useCallback } from 'react';
import { CloseIcon } from './icons';

// Deadline-based, not tick-based. A phone locked in a pocket throttles or suspends
// timers, so counting down a stored `remaining` drifts badly over a 3-minute rest.
// Storing the target timestamp means the display is correct the instant the screen
// wakes, however long it was asleep.
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

export default function RestTimer({ remaining, target, onStop, onAdjust }) {
  const doneRef = useRef(false);

  // One buzz when the rest is up. Vibration is unsupported on iOS Safari and is a no-op
  // there rather than an error, so it stays best-effort with no capability branching.
  useEffect(() => {
    if (remaining === null) { doneRef.current = false; return; }
    if (remaining === 0 && !doneRef.current) {
      doneRef.current = true;
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
      className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.25rem)] z-30 px-4 pointer-events-none"
    >
      <div
        className={`max-w-2xl mx-auto rounded-lg border shadow-lg overflow-hidden pointer-events-auto ${
          done
            ? 'bg-emerald-600 border-emerald-500 text-white'
            : 'bg-neutral-900 border-neutral-700 text-white dark:bg-neutral-900 dark:border-neutral-700'
        }`}
      >
        <div className="flex items-center gap-3 px-3 py-2">
          <span className="text-lg font-semibold tabular-nums w-14">{mmss(remaining)}</span>
          <span className="text-xs opacity-80 flex-1">{done ? 'Rest over' : 'Resting'}</span>
          <button
            type="button"
            onClick={() => onAdjust(-15)}
            className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 tabular-nums"
          >
            −15s
          </button>
          <button
            type="button"
            onClick={() => onAdjust(15)}
            className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 tabular-nums"
          >
            +15s
          </button>
          <button
            type="button"
            onClick={onStop}
            aria-label="Dismiss rest timer"
            className="p-1 opacity-70 hover:opacity-100"
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
    </div>
  );
}
