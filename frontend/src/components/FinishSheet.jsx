import { useRef } from 'react';
import { Sheet } from './ui';

// Shown on Finish, after the workout is completed and before the page changes: what the
// session added up to, what moved, any PRs. The RPE grid that ended it went in the
// 2026-11-03 strip-back — it read 8 nearly every time.
//
// Nothing here can lose data: the workout is already saved and completed by the time
// this opens. Done, Escape and the tap-outside all just close it.
export default function FinishSheet({ title, facts, progressions = [], prs = [], onDone }) {
  const closedRef = useRef(false);

  // Closing is idempotent: a double-tap on Done must not navigate twice.
  const close = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    onDone();
  };

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

        <button type="button" onClick={close} className="btn-primary w-full justify-center h-11">
          Done
        </button>
      </div>
    </Sheet>
  );
}
