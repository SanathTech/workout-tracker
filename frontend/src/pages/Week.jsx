import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getWeek } from '../api/client';

// What's on, every day, Monday to Sunday — so the answer to "what am I doing today"
// lives in the app rather than in a message each morning. The gym slots are resolved
// forward through the A->B->C cycle, which is the part that couldn't be worked out by
// looking: knowing Thursday is Day A means the bag gets packed on Wednesday night.
//
// Everything on this page is computed server-side. No model writes it. A plan you
// prepare around has to be right, and the cycle position is a modulo, not a judgement.

const KIND_STYLES = {
  gym: 'bg-emerald-500',
  run: 'bg-sky-500',
  swim: 'bg-cyan-500',
  walk: 'bg-neutral-400 dark:bg-neutral-600',
};

const KIND_LABELS = { gym: 'Gym', run: 'Run', swim: 'Swim', walk: 'Walk' };

function DayRow({ day }) {
  const { planned, actual, state, done } = day;
  const isToday = state === 'today';
  const missed = state === 'past' && !done;
  const [, month, dom] = day.date.split('-');
  const monthName = new Date(Date.UTC(2000, Number(month) - 1, 1))
    .toLocaleString(undefined, { month: 'short', timeZone: 'UTC' });

  return (
    <div
      className={`flex gap-3 py-3 ${isToday ? 'bg-emerald-50/60 dark:bg-emerald-950/20 -mx-3 px-3' : ''}`}
    >
      {/* Fixed-width date gutter keeps every title on the same left edge. */}
      <div className="w-12 shrink-0 pt-0.5">
        <p
          className={`text-xs font-semibold tracking-wide ${
            isToday ? 'text-emerald-700 dark:text-emerald-400' : 'text-neutral-500 dark:text-neutral-400'
          }`}
        >
          {day.weekday.slice(0, 3).toUpperCase()}
        </p>
        <p className="text-xs text-neutral-400 dark:text-neutral-500 tabular-nums">
          {Number(dom)} {monthName}
        </p>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
              KIND_STYLES[planned.kind] || 'bg-neutral-400'
            } ${state === 'upcoming' ? 'opacity-50' : ''}`}
            aria-hidden="true"
          />
          <span className="sr-only">{KIND_LABELS[planned.kind] || planned.kind}: </span>
          <h3
            className={`text-sm font-medium ${
              missed
                ? 'text-neutral-400 dark:text-neutral-500 line-through'
                : 'text-neutral-900 dark:text-neutral-100'
            }`}
          >
            {planned.title}
          </h3>
          {isToday && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
              Today
            </span>
          )}
          {done && !isToday && (
            <span className="text-emerald-600 dark:text-emerald-500 text-xs" aria-label="done">
              ✓
            </span>
          )}
        </div>

        {planned.detail && (
          <p
            className={`text-xs mt-0.5 ${
              state === 'past'
                ? 'text-neutral-400 dark:text-neutral-500'
                : 'text-neutral-600 dark:text-neutral-400'
            }`}
          >
            {planned.detail}
          </p>
        )}

        {actual.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {actual.map((a, i) => {
              // On a gym day the logged session IS the title above it, so repeating the
              // routine name in the chip just says "Day C — Overhead / Upper" twice.
              const label = a.label === planned.title ? null : a.label;
              const text = [label, a.meta].filter(Boolean).join(' · ');
              if (!text) return null;
              return (
                <span key={`${a.label}-${i}`} className={`tag ${a.skipped ? 'opacity-60' : ''}`}>
                  {text}
                </span>
              );
            })}
          </div>
        )}

        {missed && (
          <p className="text-xs text-amber-700 dark:text-amber-500 mt-0.5">Nothing logged</p>
        )}
      </div>
    </div>
  );
}

export default function Week() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['week'],
    queryFn: getWeek,
    staleTime: 60_000,
  });

  if (isLoading) {
    return <p className="text-sm text-neutral-500 dark:text-neutral-400 py-8">Loading the week…</p>;
  }
  if (isError || !data) {
    return <p className="text-sm text-red-600 dark:text-red-400 py-8">Couldn’t load the week.</p>;
  }

  const todayRow = data.days.find((d) => d.state === 'today');
  const nextGym = data.days.find((d) => d.state !== 'past' && d.planned.kind === 'gym');

  return (
    <div className="space-y-6">
      <section>
        <p className="section-label">This week</p>
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100 mt-0.5">
          {todayRow ? todayRow.planned.title : 'Rest'}
        </h1>
        {todayRow?.planned.detail && (
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
            {todayRow.planned.detail}
          </p>
        )}
        {nextGym && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-2">
            Next gym:{' '}
            <span className="text-neutral-700 dark:text-neutral-300">
              {nextGym.state === 'today' ? 'today' : nextGym.weekday} — {nextGym.planned.title}
            </span>
          </p>
        )}
      </section>

      <section className="border-t border-neutral-200 dark:border-neutral-800 pt-1">
        <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {data.days.map((d) => (
            <DayRow key={d.date} day={d} />
          ))}
        </div>
      </section>

      {/* The newest thing he wrote about his body, and nothing older. Whether an older
          niggle has resolved is exactly the judgement the daily brief kept getting
          wrong, so the app shows what is unsuperseded and leaves the reading to him. */}
      {data.latest_notes?.length > 0 && (
        <section className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
          <p className="section-label">Latest notes</p>
          <ul className="mt-1.5 space-y-2">
            {data.latest_notes.map((n, i) => (
              <li key={`${n.date}-${i}`}>
                <p className="text-sm text-neutral-800 dark:text-neutral-200">“{n.note}”</p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                  {n.when} · {n.source}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
        <Link to="/trends" className="btn-ghost text-xs -ml-1">
          How it’s tracking →
        </Link>
      </section>
    </div>
  );
}
