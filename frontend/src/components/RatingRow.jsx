// A row of numbered tap targets. The whole point of the check-in is that it costs
// three taps, so there is no slider, no stepper and no submit — the tap IS the save.
export default function RatingRow({ label, hint, value, max = 5, onPick, disabled }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="w-20 shrink-0">
        <div className="text-sm text-neutral-700 dark:text-neutral-300">{label}</div>
        {hint && <div className="text-[11px] text-neutral-500 dark:text-neutral-400">{hint}</div>}
      </div>
      <div className="flex gap-1 flex-1">
        {Array.from({ length: max }, (_, i) => i + 1).map((n) => {
          const active = value === n;
          return (
            <button
              key={n}
              type="button"
              disabled={disabled}
              aria-label={`${label}: ${n} of ${max}`}
              aria-pressed={active}
              onClick={() => onPick(n)}
              className={`flex-1 min-h-11 md:min-h-9 rounded-md text-sm font-medium tabular-nums transition-colors disabled:opacity-50 ${
                active
                  ? 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-neutral-950'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800'
              }`}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}
