import { useState } from 'react';
import { Sheet } from './ui';

// One instruction per exercise. The server has already decided whose call it is
// (backend/src/util/aim.js): a coach note that names a load is the aim and the engine's
// number is suppressed; otherwise the engine's. This renders what it is handed and
// nothing else — the four-voices problem (chip + ghosts + reason + amber note, all
// disagreeing on the pull-up card on 2026-09-07) was a client that merged them itself.
//
// Shared with Lifts, where the same line sits above the chart and the coach note is
// edited. Keep it free of session state.

const SOURCE_TAG = {
  engine: 'bg-emerald-400/15 text-emerald-400',
  coach: 'bg-amber-400/15 text-amber-400',
};

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

export default function AimLine({ aim, cues = [], className = '' }) {
  const [sheet, setSheet] = useState(null); // 'why' | cue id
  if (!aim && cues.length === 0) return null;
  const text = formatAim(aim);
  const openCue = cues.find((c) => c.id === sheet) || null;
  return (
    <div className={className}>
      {aim && (
        <div className="flex items-center gap-2 text-sm tabular-nums min-h-11">
          <span className="text-neutral-400 shrink-0">Aim</span>
          <span className="font-semibold text-neutral-200 min-w-0 truncate">{text || '—'}</span>
          <span className={`shrink-0 text-[10.5px] leading-4 uppercase tracking-wider px-1.5 rounded ${SOURCE_TAG[aim.source]}`}>
            {aim.source}
          </span>
          <button
            type="button"
            onClick={() => setSheet('why')}
            className="ml-auto shrink-0 h-11 pl-3 pr-2 -mr-2 text-xs text-neutral-400 hover:text-neutral-200"
          >
            why ›
          </button>
        </div>
      )}
      {/* Cues: standing coach notes with no load call. Two lines on the card, the
          rest in the sheet — note 9 runs to a paragraph. */}
      {cues.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => setSheet(c.id)}
          className="block w-full text-left text-xs text-amber-400 line-clamp-2 py-1"
        >
          <span className="font-semibold uppercase tracking-wider text-[10.5px] mr-1.5">Coach</span>
          {c.note}
        </button>
      ))}

      {sheet === 'why' && aim && (
        <Sheet title="Why this aim" onClose={() => setSheet(null)}>
          <div className="p-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] space-y-3 overflow-y-auto">
            <div className="flex items-center gap-2 text-base tabular-nums">
              <span className="font-semibold text-neutral-200">{text || '—'}</span>
              <span className={`text-[10.5px] leading-4 uppercase tracking-wider px-1.5 rounded ${SOURCE_TAG[aim.source]}`}>
                {aim.source}
              </span>
            </div>
            <p className="text-sm text-neutral-300 whitespace-pre-line">{aim.why}</p>
            {aim.engine_reason && (
              <p className="text-xs text-neutral-400">
                <span className="section-label mr-1.5">Engine would say</span>
                {aim.engine_reason}
              </p>
            )}
          </div>
        </Sheet>
      )}
      {openCue && (
        <Sheet title="Coach" onClose={() => setSheet(null)}>
          <div className="p-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] overflow-y-auto">
            <p className="text-sm text-neutral-300 whitespace-pre-line">{openCue.note}</p>
          </div>
        </Sheet>
      )}
    </div>
  );
}
