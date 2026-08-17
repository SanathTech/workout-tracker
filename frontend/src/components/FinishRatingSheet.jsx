import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { saveSessionFeel } from '../api/client';

// Asked on Finish, before the page changes.
//
// The rating used to live at the top of the finished-workout page, which is the one
// place it reliably went unseen: you land there, scroll down to look at what you just
// lifted, and it is gone above you. It also rendered only on the just-finished view, so
// there was exactly one window to answer and it was easy to scroll past — two of the
// last three sessions have no RPE, and that was the UI's fault, not forgetfulness.
//
// Nothing here can lose data: the workout is already saved and completed by the time
// this opens. Skip and the tap-outside both just close it.
const ANCHORS = [
  { n: 3, hint: 'very easy' },
  { n: 5, hint: 'easy' },
  { n: 7, hint: 'solid' },
  { n: 8, hint: 'hard' },
  { n: 9, hint: 'very hard' },
  { n: 10, hint: 'max' },
];

export default function FinishRatingSheet({ workoutId, summary, onDone }) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState(null);
  const closedRef = useRef(false);

  const save = useMutation({
    mutationFn: (rpe) => saveSessionFeel({ workout_id: Number(workoutId), rpe }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['session-feel', String(workoutId)] }),
  });

  // Closing is idempotent: a double-tap on Skip, or Escape landing while the save is
  // still in flight, must not navigate twice.
  const close = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    onDone();
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (n) => {
    setPicked(n);
    // Seed the answer into the cache the detail page reads, synchronously and before
    // the mutation settles. That page keeps ['session-feel', id] for 60s and paints an
    // amber "Not rated yet" when it's null — so without this it can greet you with the
    // flag one tap after you answered. It has to happen here, not in an onSuccess:
    // this sheet unmounts ~220ms from now and React Query drops an unmounted observer's
    // callbacks, so a slow save would never get to write it.
    qc.setQueryData(['session-feel', String(workoutId)], (old) => ({ ...(old || {}), rpe: n }));
    // Fire and continue. The rating is worth having, not worth blocking on — if it
    // fails, the workout is still finished and the inline prompt will ask again.
    save.mutate(n);
    setTimeout(close, 220); // just long enough for the selection to register visually
  };

  const hint = ANCHORS.find((a) => a.n === picked)?.hint;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Rate this session"
    >
      <div
        className="w-full max-w-md bg-white dark:bg-neutral-950 rounded-t-2xl border-t border-neutral-200 dark:border-neutral-800 p-4 pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="section-label text-emerald-700 dark:text-emerald-400">Workout complete</p>
        {summary && (
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-0.5">{summary}</p>
        )}

        <h2 className="text-lg font-semibold tracking-tight mt-3 text-neutral-900 dark:text-neutral-100">
          How hard was that?
        </h2>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2">
          RPE 1–10 — 8 is hard, 10 is nothing left.
        </p>

        <div className="grid grid-cols-5 gap-1.5">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => pick(n)}
              aria-label={`RPE ${n}`}
              aria-pressed={picked === n}
              className={`min-h-11 rounded-md text-sm font-medium tabular-nums border transition-colors ${
                picked === n
                  ? 'bg-emerald-600 border-emerald-600 text-white'
                  : 'border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300 hover:border-neutral-400 dark:hover:border-neutral-600'
              }`}
            >
              {n}
            </button>
          ))}
        </div>

        {/* Reserved line, so picking a number doesn't shift the buttons under the thumb. */}
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-2 h-4">{hint || ''}</p>

        <button type="button" onClick={close} className="btn-ghost w-full mt-1">
          Skip
        </button>
      </div>
    </div>
  );
}
