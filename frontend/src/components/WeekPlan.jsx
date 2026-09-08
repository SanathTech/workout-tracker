import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getWeek } from '../api/client';
import { ChevronIcon } from './icons';
import { Skeleton } from './Skeleton';

// What's on, every day, Monday to Sunday — so the answer to "what am I doing today"
// lives in the app rather than in a message each morning. The gym slots are resolved
// forward through the A->B->C cycle, which is the part that couldn't be worked out by
// looking: knowing Thursday is Day A means the bag gets packed on Wednesday night.
//
// Everything here is computed server-side. No model writes it. A plan you prepare
// around has to be right, and the cycle position is a modulo, not a judgement.
//
// This was its own tab until 2026-09-05, then seven rows on Home. Since the 2026-09-08
// redesign (PR 3) Home shows the week as a strip of seven dots — done, today, missed,
// planned — and the rows only unfold on tap. The rows move to Train in PR 4.

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
// (2026-09-06), and today's detail already sits in the header above. Tap a row for
// its description and what was actually logged.
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
  const expandable = !!planned.detail || chips.length > 0;

  return (
    <button
      type="button"
      disabled={!expandable}
      onClick={() => setOpen((v) => !v)}
      aria-expanded={expandable ? open : undefined}
      className={`w-full text-left flex gap-3 py-2 ${isToday ? 'bg-emerald-950/20 -mx-3 px-3' : ''}`}
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

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 min-w-0">
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

        {open && planned.detail && (
          <p
            className={`text-xs mt-1 ${
              state === 'past'
                ? 'text-neutral-400'
                : 'text-neutral-400'
            }`}
          >
            {planned.detail}
          </p>
        )}

        {open && chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {chips.map((c) => (
              <span key={c.key} className={`tag ${c.skipped ? 'opacity-60' : ''}`}>{c.text}</span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

// The seven dots. A filled dot is a day with something logged (in its kind's colour),
// a hollow one is still to come, today wears a ring, and a past day with nothing logged
// is dark red — the one state worth noticing at a glance.
function Dot({ day }) {
  const { planned, state, done } = day;
  const missed = state === 'past' && !done;
  const isToday = state === 'today';
  let cls;
  if (done) cls = KIND_STYLES[planned.kind] || 'bg-neutral-400';
  else if (missed) cls = 'bg-red-400/40';
  else if (isToday) cls = 'border border-emerald-400';
  else cls = 'border border-neutral-600';
  return (
    <span
      aria-hidden="true"
      className={`block w-2.5 h-2.5 rounded-full ${cls} ${isToday ? 'ring-2 ring-emerald-400/40 ring-offset-2 ring-offset-neutral-950' : ''}`}
    />
  );
}

export default function WeekStrip() {
  const { data, isLoading, isError } = useWeek();
  const [open, setOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="py-2 space-y-3">
        <div className="flex justify-between px-3">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="w-2.5 h-2.5 rounded-full" />)}
        </div>
        <Skeleton className="h-4 w-48" />
      </div>
    );
  }
  if (isError || !data) return <p className="text-sm text-red-400">Couldn’t load the week.</p>;

  const todayRow = data.days.find((d) => d.state === 'today');

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-stretch -mx-1 px-1 py-1 rounded-lg hover:bg-neutral-900 transition-colors"
      >
        {/* No aria-label here: the per-day sr-only text below is the accessible name. */}
        <span className="sr-only">This week{open ? '' : ' — show each day'}.</span>
        {data.days.map((d) => {
          const isToday = d.state === 'today';
          const missed = d.state === 'past' && !d.done;
          return (
            <span key={d.date} className="flex-1 flex flex-col items-center gap-2 py-1">
              <span className={`text-[11px] tracking-wide ${isToday ? 'text-emerald-400 font-semibold' : 'text-neutral-400'}`}>
                {d.weekday.slice(0, 1)}
              </span>
              <Dot day={d} />
              <span className="sr-only">
                {d.weekday}: {KIND_LABELS[d.planned.kind] || d.planned.kind}, {d.planned.title}
                {d.done ? ', done' : missed ? ', nothing logged' : isToday ? ', today' : ''}
              </span>
            </span>
          );
        })}
      </button>

      {/* Today's slot in words, because the session block only knows about gym days —
          on a Wednesday the answer is the swim, and the program can't say so. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-baseline justify-between gap-3 text-left mt-1 min-h-11 md:min-h-0"
      >
        <span className="text-sm min-w-0 truncate">
          <span className="text-neutral-200 font-medium">{todayRow ? todayRow.planned.title : 'Rest'}</span>
          {todayRow?.planned.detail && (
            <span className="text-neutral-400"> · {todayRow.planned.detail}</span>
          )}
        </span>
        <span className="text-xs text-neutral-400 shrink-0 inline-flex items-center gap-1">
          week <ChevronIcon open={open} />
        </span>
      </button>

      {open && (
        <div className="divide-y divide-neutral-800 border-t border-neutral-800 mt-1">
          {data.days.map((d) => <DayRow key={d.date} day={d} />)}
        </div>
      )}
    </div>
  );
}
