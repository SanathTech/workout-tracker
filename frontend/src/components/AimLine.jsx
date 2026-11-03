import { useState } from 'react';
import { Sheet } from './ui';

// One instruction per exercise: the progression engine's aim (backend/src/util/aim.js),
// with its reason behind "why". Coach notes used to compete for this line; they went in
// the 2026-11-03 strip-back.

// "52.5 kg × 6 · RIR 1". Any part may be missing; a reps-only aim on a hold logged in
// seconds still reads as "45 reps", which is the least-wrong option without a unit on
// the exercise.
export function formatAim(aim) {
  if (!aim) return '';
  const parts = [];
  // 0 kg is bodyweight (dead hang, dips at nothing added) — say the reps, not "0 kg × 45".
  if (aim.weight_kg != null && Number(aim.weight_kg) !== 0) {
    const w = `${Math.round(aim.weight_kg * 100) / 100} kg`;
    parts.push(aim.reps != null ? `${w} × ${aim.reps}` : w);
  } else if (aim.reps != null) {
    parts.push(`${aim.reps} reps`);
  }
  if (aim.rir != null) parts.push(`RIR ${aim.rir}`);
  return parts.join(' · ');
}

export default function AimLine({ aim, className = '' }) {
  const [open, setOpen] = useState(false);
  if (!aim) return null;
  const text = formatAim(aim);
  return (
    <div className={className}>
      <div className="flex items-center gap-2 text-sm tabular-nums min-h-11">
        <span className="text-neutral-400 shrink-0">Aim</span>
        <span className="font-semibold text-neutral-200 min-w-0 truncate">{text || '—'}</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ml-auto -mr-2 shrink-0 h-11 px-2 text-xs text-neutral-400 hover:text-neutral-200"
        >
          why ›
        </button>
      </div>
      {open && (
        <Sheet title="Why this aim" onClose={() => setOpen(false)}>
          <div className="p-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] space-y-3 overflow-y-auto">
            <p className="text-base font-semibold text-neutral-200 tabular-nums">{text || '—'}</p>
            <p className="text-sm text-neutral-300 whitespace-pre-line">{aim.why}</p>
          </div>
        </Sheet>
      )}
    </div>
  );
}
