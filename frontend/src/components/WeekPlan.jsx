import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getWeek } from '../api/client';
import { Skeleton } from './Skeleton';

// What's on, every day, Monday to Sunday — so the answer to "what am I doing today"
// lives in the app rather than in a message each morning. The gym slots are resolved
// forward through the A->B->C cycle, which is the part that couldn't be worked out by
// looking: knowing Thursday is Day A means the bag gets packed on Wednesday night.
//
// Everything here is computed server-side. No model writes it. A plan you prepare
// around has to be right, and the cycle position is a modulo, not a judgement.
//
// This was its own tab until 2026-09-05, then seven rows on Home. Today shows the week as
// a strip of seven lettered days and the rows (DayRow) live on Train; tapping the strip
// goes there.

const KIND_STYLES = {
  gym: 'bg-emerald-500',
  run: 'bg-sky-500',
  swim: 'bg-cyan-500',
  walk: 'bg-neutral-600',
};

const KIND_LABELS = { gym: 'Gym', run: 'Run', swim: 'Swim', walk: 'Walk' };

export function useWeek() {
  return useQuery({ queryKey: ['week'], queryFn: getWeek, staleTime: 60_000 });
}

// One line per day: the full seven-day detail made Home nearly four screens tall
// (2026-09-06). Tap a row for its description and what was actually logged; a logged
// gym day links through to the workout.
export function DayRow({ day }) {
  const { planned, actual, state, done } = day;
  const isToday = state === 'today';
  const missed = state === 'past' && !done;
  const [open, setOpen] = useState(false);
  const [, month, dom] = day.date.split('-');
  const monthName = new Date(Date.UTC(2000, Number(month) - 1, 1))
    .toLocaleString(undefined, { month: 'short', timeZone: 'UTC' });
  const chips = actual
    .map((a, i) => {
      // On a gym day the logged session IS the title, so repeating the routine name
      // in the chip just says "Day C — Overhead / Upper" twice.
      const label = a.label === planned.title ? null : a.label;
      const text = [label, a.meta].filter(Boolean).join(' · ');
      return text ? { key: `${a.label}-${i}`, text, skipped: a.skipped } : null;
    })
    .filter(Boolean);
  const workoutId = actual.find((a) => a.kind === 'gym' && !a.skipped && a.workout_id)?.workout_id ?? null;
  const expandable = !!planned.detail || chips.length > 0 || workoutId != null;

  return (
    <div className={`${isToday ? 'bg-emerald-950/20 -mx-3 px-3' : ''}`}>
      <button
        type="button"
        disabled={!expandable}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={expandable ? open : undefined}
        className="w-full text-left flex gap-3 py-2 min-h-11"
      >
        {/* Fixed-width date gutter keeps every title on the same left edge. */}
        <div className="w-12 shrink-0 flex items-baseline gap-1">
          <span
            className={`text-xs font-semibold tracking-wide ${
              isToday ? 'text-emerald-400' : 'text-neutral-400'
            }`}
          >
            {day.weekday.slice(0, 3).toUpperCase()}
          </span>
          <span className="text-[11px] text-neutral-400 tabular-nums">{Number(dom)}</span>
          <span className="sr-only">{monthName}</span>
        </div>

        <div className="min-w-0 flex-1 flex items-baseline gap-2">
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
              KIND_STYLES[planned.kind] || 'bg-neutral-400'
            } ${state === 'upcoming' ? 'opacity-50' : ''}`}
            aria-hidden="true"
          />
          <span className="sr-only">{KIND_LABELS[planned.kind] || planned.kind}: </span>
          <span
            className={`text-sm font-medium truncate ${
              missed
                ? 'text-neutral-400 line-through'
                : 'text-neutral-200'
            }`}
          >
            {planned.title}
          </span>
          {isToday && <span className="sr-only">today</span>}
          {done && !isToday && (
            <span className="text-emerald-400 text-xs shrink-0" aria-label="done">✓</span>
          )}
          {missed && (
            <span className="text-[11px] text-amber-400 shrink-0">nothing logged</span>
          )}
        </div>
      </button>

      {open && (
        <div className="pl-[3.75rem] pb-2 -mt-1 space-y-1.5">
          {planned.detail && <p className="text-xs text-neutral-400">{planned.detail}</p>}
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <span key={c.key} className={`tag ${c.skipped ? 'opacity-60' : ''}`}>{c.text}</span>
              ))}
            </div>
          )}
          {workoutId != null && (
            <Link to={`/workouts/${workoutId}`} className="inline-flex items-center text-xs text-neutral-400 hover:text-neutral-200 min-h-11 md:min-h-0">
              Open workout ›
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

// The seven days as letters — the routine's letter on a gym day (A/B/C), R/S/W for run,
// swim and walk — so the strip says what each day IS, not just that it exists. Filled in
// the kind's colour when done, dashed when skipped, a plain outline when a past day has
// nothing logged. There is no red: the walkthrough (2026-09-15) was blunt that a red dot
// on a session he skipped on purpose "does nothing for me".
const KIND_RING = {
  gym: 'border-emerald-800 text-emerald-400',
  run: 'border-sky-900 text-sky-400',
  swim: 'border-cyan-900 text-cyan-400',
  walk: 'border-neutral-700 text-neutral-400',
};
const KIND_FILL = {
  gym: 'bg-emerald-400 border-emerald-400 text-neutral-950',
  run: 'bg-sky-400 border-sky-400 text-neutral-950',
  swim: 'bg-cyan-400 border-cyan-400 text-neutral-950',
  walk: 'bg-neutral-400 border-neutral-400 text-neutral-950',
};

// A done day wears the letter of what was done: a run on a walk day reads R, not W.
export function dayLetter(day) {
  const { planned, actual } = day;
  const kind = (day.done && actual.find((a) => !a.skipped)?.kind) || planned.kind;
  if (kind === 'gym') {
    const title = actual.find((a) => a.kind === 'gym')?.label || planned.title || '';
    return title.match(/^Day\s+([A-Z])\b/i)?.[1]?.toUpperCase() || 'G';
  }
  return { run: 'R', swim: 'S', walk: 'W' }[kind] || '·';
}

function DayMark({ day }) {
  const { planned, state, done, actual } = day;
  const skipped = !done && actual.some((a) => a.skipped);
  const doneKind = actual.find((a) => !a.skipped)?.kind || planned.kind;
  let cls;
  if (done) cls = KIND_FILL[doneKind] || KIND_FILL.walk;
  else if (skipped) cls = 'border-dashed border-neutral-700 text-neutral-600';
  else if (state === 'past') cls = 'border-neutral-800 text-neutral-600';
  else cls = KIND_RING[planned.kind] || KIND_RING.walk;
  return (
    <span
      aria-hidden="true"
      className={`grid place-items-center w-7 h-7 rounded-full border-[1.5px] text-[11px] font-semibold ${cls} ${
        state === 'today' ? 'ring-2 ring-neutral-200 ring-offset-2 ring-offset-neutral-950' : ''
      }`}
    >
      {dayLetter(day)}
    </span>
  );
}

export default function WeekStrip({ week, isLoading, isError }) {
  if (isLoading) {
    return (
      <div className="flex justify-between px-2 py-1">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="w-7 h-7 rounded-full" />)}
      </div>
    );
  }
  if (isError || !week) return <p className="text-sm text-red-400">Couldn’t load the week.</p>;

  return (
    <div>
      <Link
        to="/train"
        aria-label="This week — open Train"
        className="w-full flex items-stretch -mx-1 px-1 py-1 rounded-lg hover:bg-neutral-900 transition-colors"
      >
        {week.days.map((d) => {
          const isToday = d.state === 'today';
          return (
            <span key={d.date} className="flex-1 flex flex-col items-center gap-1.5 py-1">
              <span className={`text-[11px] tracking-wide ${isToday ? 'text-neutral-200 font-semibold' : 'text-neutral-400'}`}>
                {d.weekday.slice(0, 1)}
              </span>
              <DayMark day={d} />
            </span>
          );
        })}
      </Link>
      <ul className="sr-only">
        {week.days.map((d) => {
          const skipped = !d.done && d.actual.some((a) => a.skipped);
          return (
            <li key={d.date}>
              {d.weekday}: {d.planned.title}
              {d.done ? ', done' : skipped ? ', skipped' : d.state === 'today' ? ', today' : d.state === 'past' ? ', nothing logged' : ''}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
