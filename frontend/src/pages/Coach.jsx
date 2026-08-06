import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCoachLatest, getReadiness, getCoachHistory } from '../api/client';
import CheckinCard from '../components/CheckinCard';
import { Skeleton } from '../components/Skeleton';
import { formatDay } from '../utils/format';

const CALL_LABEL = {
  push: 'Push',
  as_planned: 'As planned',
  go_easy: 'Go easy',
  rest: 'Rest',
};

const CALL_STYLE = {
  push: 'text-emerald-700 dark:text-emerald-400 border-l-emerald-500',
  as_planned: 'text-sky-700 dark:text-sky-400 border-l-sky-500',
  go_easy: 'text-amber-700 dark:text-amber-500 border-l-amber-500',
  rest: 'text-red-700 dark:text-red-400 border-l-red-500',
};

function hours(secs) {
  if (!secs) return null;
  return `${Math.floor(secs / 3600)}h ${Math.round((secs % 3600) / 60)}m`;
}

// A reading is only legible against its own baseline, so every figure that has one
// carries it. `delta` is coloured by direction, not by value — a resting HR going up
// is bad where a Body Battery going up is good.
function Metric({ label, value, unit, baseline, goodDirection }) {
  if (value == null) return null;
  const diff = baseline != null ? Math.round(value - baseline) : null;
  const good = diff == null || diff === 0 ? null : goodDirection === 'up' ? diff > 0 : diff < 0;
  return (
    <div className="flex-1 min-w-[5.5rem]">
      <div className="text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{label}</div>
      <div className="text-lg font-semibold tabular-nums">
        {value}
        {unit && <span className="text-xs font-normal text-neutral-500 dark:text-neutral-400 ml-0.5">{unit}</span>}
      </div>
      {diff != null && diff !== 0 && (
        <div className={`text-[11px] tabular-nums ${good ? 'text-emerald-600 dark:text-emerald-500' : 'text-amber-600 dark:text-amber-500'}`}>
          {diff > 0 ? '+' : ''}{diff} vs 10d
        </div>
      )}
    </div>
  );
}

function Readiness() {
  const { data, isLoading } = useQuery({
    queryKey: ['readiness'],
    queryFn: getReadiness,
    staleTime: 5 * 60_000,
  });

  if (isLoading) return <Skeleton className="h-20 w-full" />;
  const night = data?.last_night;
  if (!night) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        No wellness data yet — the Garmin sync hasn’t written a row.
      </p>
    );
  }

  const base = data.baseline_10d || {};
  return (
    <>
      <div className="flex flex-wrap gap-x-4 gap-y-3">
        <Metric label="Battery" value={night.body_battery_at_wake} baseline={base.body_battery_at_wake} goodDirection="up" />
        <Metric label="Sleep" value={night.sleep_score} baseline={base.sleep_score} goodDirection="up" />
        <Metric label="RHR" value={night.resting_hr} unit="bpm" baseline={base.resting_hr} goodDirection="down" />
        <Metric label="Stress" value={night.stress_avg} baseline={base.stress_avg} goodDirection="down" />
        {data.training_load?.tsb != null && (
          <Metric label="TSB" value={Number(data.training_load.tsb)} goodDirection="up" />
        )}
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {night.sleep_secs && <span className="tag">{hours(night.sleep_secs)} asleep</span>}
        {night.sleep_deep_secs && <span className="tag">{Math.round(night.sleep_deep_secs / 60)}m deep</span>}
        {night.sleep_rem_secs && <span className="tag">{Math.round(night.sleep_rem_secs / 60)}m REM</span>}
        {night.steps != null && <span className="tag">{night.steps.toLocaleString(undefined)} steps</span>}
      </div>
      <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1.5">
        {formatDay(night.date, { weekday: 'long', month: 'short', day: 'numeric' })}
        {data.stale_hours != null && data.stale_hours > 48 && (
          <span className="text-amber-600 dark:text-amber-500"> · sync {data.stale_hours}h stale</span>
        )}
      </p>
    </>
  );
}

function DailyAdvice({ entry }) {
  if (!entry) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        No call yet. The coach runs at 06:30.
      </p>
    );
  }
  const a = entry.advice || {};
  const style = CALL_STYLE[a.call] || 'border-l-neutral-300 dark:border-l-neutral-700';
  return (
    <div className={`border-l-2 pl-3 ${style}`}>
      <p className="section-label">{CALL_LABEL[a.call] || 'Today'}</p>
      <h3 className="font-semibold tracking-tight mt-0.5 text-neutral-900 dark:text-neutral-100">{a.headline}</h3>
      {a.why && <p className="text-sm text-neutral-700 dark:text-neutral-300 mt-1.5">{a.why}</p>}
      {a.session_guidance && (
        <p className="text-sm text-neutral-700 dark:text-neutral-300 mt-2">{a.session_guidance}</p>
      )}
      {a.watch?.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {a.watch.map((w, i) => (
            <li key={i} className="text-sm text-neutral-600 dark:text-neutral-400">· {w}</li>
          ))}
        </ul>
      )}
      {a.data_caveats?.length > 0 && (
        <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-2 italic">
          {a.data_caveats.join('; ')}
        </p>
      )}
      <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-2">
        {formatDay(entry.for_date, { weekday: 'short', month: 'short', day: 'numeric' })} · {entry.model}
      </p>
    </div>
  );
}

function WeeklyAdvice({ entry }) {
  const [open, setOpen] = useState(false);
  if (!entry) return null;
  const a = entry.advice || {};
  return (
    <section className="border-t border-neutral-200 dark:border-neutral-800 pt-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-baseline justify-between text-left min-h-11 md:min-h-0"
      >
        <span className="section-label">Week review</span>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {formatDay(entry.for_date, { month: 'short', day: 'numeric' })} {open ? '▲' : '▼'}
        </span>
      </button>
      <h3 className="font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">{a.headline}</h3>
      {open && (
        <div className="space-y-3 mt-2">
          {[
            ['This week', a.week_review],
            ['Adherence', a.adherence],
            ['Load', a.load_assessment],
            ['Strength', a.strength_note],
          ].map(([label, text]) =>
            text ? (
              <div key={label}>
                <p className="section-label">{label}</p>
                <p className="text-sm text-neutral-700 dark:text-neutral-300">{text}</p>
              </div>
            ) : null
          )}
          {a.next_week?.length > 0 && (
            <div>
              <p className="section-label">Next week</p>
              <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {a.next_week.map((d, i) => (
                  <li key={i} className="py-1.5">
                    <span className="text-sm font-medium">{d.day}</span>{' '}
                    <span className="text-sm text-neutral-700 dark:text-neutral-300">{d.focus}</span>
                    {d.detail && (
                      <div className="text-sm text-neutral-600 dark:text-neutral-400">{d.detail}</div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {a.flags?.length > 0 && (
            <div>
              <p className="section-label text-amber-700 dark:text-amber-500">Flags</p>
              <ul className="space-y-0.5">
                {a.flags.map((f, i) => (
                  <li key={i} className="text-sm text-amber-700 dark:text-amber-500">· {f}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function History() {
  const [open, setOpen] = useState(false);
  const { data = [] } = useQuery({
    queryKey: ['coach-history'],
    queryFn: () => getCoachHistory({ kind: 'daily', limit: 14 }),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  return (
    <section className="border-t border-neutral-200 dark:border-neutral-800 pt-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-baseline justify-between text-left min-h-11 md:min-h-0"
      >
        <span className="section-label">Past calls</span>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {data.length === 0 && (
            <li className="py-2 text-sm text-neutral-500 dark:text-neutral-400">Nothing yet.</li>
          )}
          {data.map((e) => (
            <li key={e.id} className="py-2">
              <div className="flex items-baseline gap-2">
                <span className={`text-[11px] uppercase tracking-wide ${CALL_STYLE[e.advice?.call]?.split(' ')[0] || ''}`}>
                  {CALL_LABEL[e.advice?.call] || '—'}
                </span>
                <span className="text-[11px] text-neutral-500 dark:text-neutral-400 tabular-nums">
                  {formatDay(e.for_date, { month: 'short', day: 'numeric' })}
                </span>
              </div>
              <p className="text-sm text-neutral-700 dark:text-neutral-300">{e.advice?.headline}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function Coach() {
  const { data, isLoading } = useQuery({
    queryKey: ['coach-latest'],
    queryFn: getCoachLatest,
    staleTime: 5 * 60_000,
  });

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Coach</h1>

      {isLoading ? <Skeleton className="h-32 w-full" /> : <DailyAdvice entry={data?.daily} />}

      <section className="border-t border-neutral-200 dark:border-neutral-800 pt-4">
        <h2 className="section-label mb-2">Last night</h2>
        <Readiness />
      </section>

      <CheckinCard />
      <WeeklyAdvice entry={data?.weekly} />
      <History />
    </div>
  );
}
