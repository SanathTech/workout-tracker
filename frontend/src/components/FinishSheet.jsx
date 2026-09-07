import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { saveSessionFeel } from '../api/client';
import { Sheet } from './ui';

// Shown on Finish, after the workout is completed and before the page changes: what
// the session added up to, what moved, any PRs — then the RPE grid.
//
// The rating used to live at the top of the finished-workout page, which is the one
// place it reliably went unseen: you land there, scroll down to look at what you just
// lifted, and it is gone above you. Two of three sessions had no RPE, and that was the
// UI's fault. The summary joins it here for the same reason — the detail page's
// "Workout complete" banner rode on router state and vanished on the first refresh.
//
// Nothing here can lose data: the workout is already saved and completed by the time
// this opens. Done, Escape and the tap-outside all just close it.
const ANCHORS = [
  { n: 3, hint: 'very easy' },
  { n: 5, hint: 'easy' },
  { n: 7, hint: 'solid' },
  { n: 8, hint: 'hard' },
  { n: 9, hint: 'very hard' },
  { n: 10, hint: 'max' },
];

export default function FinishSheet({ workoutId, title, facts, progressions = [], prs = [], onDone }) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState(null);
  const closedRef = useRef(false);

  const save = useMutation({
    mutationFn: (rpe) => saveSessionFeel({ workout_id: Number(workoutId), rpe }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['session-feel', String(workoutId)] }),
  });

  // Closing is idempotent: a double-tap on Done, or Escape landing while the save is
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
    // this sheet unmounts soon after Done and React Query drops an unmounted observer's
    // callbacks, so a slow save would never get to write it.
    qc.setQueryData(['session-feel', String(workoutId)], (old) => ({ ...(old || {}), rpe: n }));
    // Fire and continue. The rating is worth having, not worth blocking on — if it
    // fails, the workout is still finished and the detail page will ask again.
    save.mutate(n);
  };

  const hint = ANCHORS.find((a) => a.n === picked)?.hint;

  return (
    <Sheet onClose={close} label="Workout complete">
      <div className="p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] overflow-y-auto space-y-4">
        <div>
          <p className="section-label text-emerald-400">Workout complete</p>
          <h2 className="text-lg font-semibold tracking-tight mt-0.5 text-neutral-200">{title}</h2>
          {facts && <p className="text-sm text-neutral-400 tabular-nums mt-0.5">{facts}</p>}
        </div>

        {progressions.length > 0 && (
          <ul className="space-y-1">
            {progressions.map((p) => (
              <li key={p.exercise_id} className="flex items-baseline gap-2 text-sm tabular-nums">
                <span className="text-emerald-400 shrink-0">↑</span>
                <span className="text-neutral-200 min-w-0 truncate">{p.exercise_name}</span>
                <span className="ml-auto shrink-0 text-neutral-400">{p.detail}</span>
              </li>
            ))}
          </ul>
        )}
        {prs.length > 0 && (
          <ul className="space-y-1">
            {prs.map((pr) => (
              <li key={pr.exercise_id} className="flex items-baseline gap-2 text-sm tabular-nums">
                <span className="text-amber-400 shrink-0">★</span>
                <span className="text-neutral-200 min-w-0 truncate">{pr.exercise_name}</span>
                <span className="ml-auto shrink-0 text-neutral-400">{pr.detail} · best</span>
              </li>
            ))}
          </ul>
        )}

        <div>
          <p className="text-sm font-medium text-neutral-200">How hard was that?</p>
          <p className="text-xs text-neutral-400 mb-2">RPE 1–10 — 8 is hard, 10 is nothing left.</p>
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
                    ? 'bg-emerald-700 border-emerald-700 text-white'
                    : 'border-neutral-800 text-neutral-300 hover:border-neutral-600'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          {/* Reserved line, so picking a number doesn't shift the button under the thumb. */}
          <p className="text-xs text-neutral-400 mt-2 h-4">{hint || ''}</p>
        </div>

        <button type="button" onClick={close} className="btn-primary w-full justify-center h-11">
          Done
        </button>
      </div>
    </Sheet>
  );
}
