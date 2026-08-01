import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { getMuscleVolume } from '../api/client';
import { Skeleton } from './Skeleton';

// The bar is positioned on the MEV→MRV scale, not on "percent of a target", because there
// isn't a target — there's a productive band. Anything past MRV is drawn as overflow.
function VolumeBar({ row }) {
  const scaleMax = Math.max(row.mrv, row.sets);
  const pct = (v) => `${Math.min(100, (v / scaleMax) * 100)}%`;

  const tone = {
    below_mev:  'bg-neutral-400 dark:bg-neutral-600',
    productive: 'bg-emerald-500',
    high:       'bg-amber-500',
    above_mrv:  'bg-red-500',
  }[row.status];

  const note = {
    below_mev:  `under MEV (${row.mev})`,
    productive: 'productive',
    high:       `above MAV (${row.mav})`,
    above_mrv:  `over MRV (${row.mrv})`,
  }[row.status];

  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-sm text-neutral-800 dark:text-neutral-200">{row.label}</span>
        <span className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
          {row.sets} {row.sets === 1 ? 'set' : 'sets'} · {note}
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-neutral-150 dark:bg-neutral-800 overflow-hidden">
        {/* the productive band, so the bar can be read against it at a glance */}
        <div
          className="absolute inset-y-0 bg-emerald-500/15"
          style={{ left: pct(row.mev), width: `calc(${pct(row.mav)} - ${pct(row.mev)})` }}
        />
        <div className={`absolute inset-y-0 left-0 rounded-full ${tone}`} style={{ width: pct(row.sets) }} />
        <div className="absolute inset-y-0 w-px bg-neutral-400/70 dark:bg-neutral-500" style={{ left: pct(row.mev) }} />
        <div className="absolute inset-y-0 w-px bg-red-400/70" style={{ left: pct(row.mrv) }} />
      </div>
    </div>
  );
}

export default function MuscleVolume() {
  const [weeks, setWeeks] = useState(8);
  const [showAll, setShowAll] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['muscle-volume', weeks],
    queryFn: () => getMuscleVolume({ weeks }),
    staleTime: 5 * 60_000,
  });

  if (isLoading) {
    return (
      <div className="card space-y-3">
        <Skeleton className="h-4 w-40" />
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-6 w-full" />)}
      </div>
    );
  }

  const summary = data?.summary || [];
  const trained = summary.filter((r) => r.sets > 0);
  const untrained = summary.filter((r) => r.sets === 0);
  const shown = showAll ? summary : trained;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h2 className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            This week’s sets per muscle
          </h2>
          <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-0.5">
            Assisting muscles count as half a set
          </p>
        </div>
        <select
          className="input w-24 py-1 text-xs"
          value={weeks}
          onChange={(e) => setWeeks(Number(e.target.value))}
          aria-label="Weeks of history"
        >
          <option value={4}>4 weeks</option>
          <option value={8}>8 weeks</option>
          <option value={12}>12 weeks</option>
        </select>
      </div>

      {trained.length === 0 ? (
        <p className="text-sm text-neutral-500 py-4">
          No sets logged this week yet.
        </p>
      ) : (
        <div className="divide-y divide-neutral-100 dark:divide-neutral-900">
          {shown.map((row) => <VolumeBar key={row.muscle} row={row} />)}
        </div>
      )}

      {untrained.length > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-2 text-xs font-medium text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200"
        >
          {showAll ? 'Hide untrained' : `Show ${untrained.length} untrained`}
        </button>
      )}
    </div>
  );
}
