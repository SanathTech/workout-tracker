import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getWeek } from '../api/client';

// What's on, every day, Monday to Sunday — so the answer to "what am I doing today"
// lives in the app rather than in a message each morning. The gym slots are resolved
// forward through the A->B->C cycle, which is the part that couldn't be worked out by
// looking: knowing Thursday is Day A means the bag gets packed on Wednesday night.
//
// Everything here is computed server-side. No model writes it. A plan you prepare
// around has to be right, and the cycle position is a modulo, not a judgement.
//
// This was its own tab until 2026-09-05. Two weeks of telemetry showed it got a
// 4-second glance on the way from Home to the check-in, every night — a stop on a
// corridor, not a destination — so it lives on Home now, under the thing you start.

const KIND_STYLES = {
  gym: 'bg-emerald-500',
  run: 'bg-sky-500',
  swim: 'bg-cyan-500',
  walk: 'bg-neutral-400 dark:bg-neutral-600',
};

const KIND_LABELS = { gym: 'Gym', run: 'Run', swim: 'Swim', walk: 'Walk' };

// One line per day: the full seven-day detail made Home nearly four screens tall
// (2026-09-06), and today's detail already sits in the header above. Tap a row for
// its description and what was actually logged.
function DayRow({ day }) {
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
      className={`w-full text-left flex gap-3 py-2 ${isToday ? 'bg-emerald-50/60 dark:bg-emerald-950/20 -mx-3 px-3' : ''}`}
    >
      {/* Fixed-width date gutter keeps every title on the same left edge. */}
      <div className="w-12 shrink-0 flex items-baseline gap-1">
        <span
          className={`text-xs font-semibold tracking-wide ${
            isToday ? 'text-emerald-700 dark:text-emerald-400' : 'text-neutral-500 dark:text-neutral-400'
          }`}
        >
          {day.weekday.slice(0, 3).toUpperCase()}
        </span>
        <span className="text-[11px] text-neutral-400 dark:text-neutral-500 tabular-nums">{Number(dom)}</span>
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
                ? 'text-neutral-400 dark:text-neutral-500 line-through'
                : 'text-neutral-900 dark:text-neutral-100'
            }`}
          >
            {planned.title}
          </span>
          {isToday && <span className="sr-only">today</span>}
          {done && !isToday && (
            <span className="text-emerald-600 dark:text-emerald-500 text-xs shrink-0" aria-label="done">✓</span>
          )}
          {missed && (
            <span className="text-[11px] text-amber-700 dark:text-amber-500 shrink-0">nothing logged</span>
          )}
        </div>

        {open && planned.detail && (
          <p
            className={`text-xs mt-1 ${
              state === 'past'
                ? 'text-neutral-400 dark:text-neutral-500'
                : 'text-neutral-600 dark:text-neutral-400'
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

export default function WeekPlan() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['week'],
    queryFn: getWeek,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <section className="border-t border-neutral-200 dark:border-neutral-800 pt-4">
        <p className="section-label">This week</p>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 py-4">Loading the week…</p>
      </section>
    );
  }
  if (isError || !data) {
    return (
      <section className="border-t border-neutral-200 dark:border-neutral-800 pt-4">
        <p className="section-label">This week</p>
        <p className="text-sm text-red-600 dark:text-red-400 py-4">Couldn’t load the week.</p>
      </section>
    );
  }

  const todayRow = data.days.find((d) => d.state === 'today');
  const nextGym = data.days.find((d) => d.state !== 'past' && d.planned.kind === 'gym');

  return (
    <section className="border-t border-neutral-200 dark:border-neutral-800 pt-4 space-y-3">
      <div>
        <p className="section-label">This week</p>
        {/* Today's slot in words, because the "Up next" card above only knows about gym
            days — on a Wednesday the answer is the swim, and the program can't say so. */}
        <p className="text-base font-semibold tracking-tight text-neutral-900 dark:text-neutral-100 mt-0.5">
          {todayRow ? todayRow.planned.title : 'Rest'}
          <span className="text-xs font-normal text-neutral-500 dark:text-neutral-400 ml-2">today</span>
        </p>
        {todayRow?.planned.detail && (
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-0.5">
            {todayRow.planned.detail}
          </p>
        )}
        {nextGym && nextGym.state !== 'today' && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
            Next gym:{' '}
            <span className="text-neutral-700 dark:text-neutral-300">
              {nextGym.weekday} — {nextGym.planned.title}
            </span>
          </p>
        )}
      </div>

      <div className="divide-y divide-neutral-200 dark:divide-neutral-800 border-t border-neutral-200 dark:border-neutral-800">
        {data.days.map((d) => (
          <DayRow key={d.date} day={d} />
        ))}
      </div>

    </section>
  );
}
