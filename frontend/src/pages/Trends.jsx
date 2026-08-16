import { lazy, Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCoachLatest, getReadiness, getTrends } from '../api/client';
import CheckinCard from '../components/CheckinCard';
import Sparkline from '../components/Sparkline';
import { Skeleton } from '../components/Skeleton';
import { formatDay, formatKg } from '../utils/format';

// This tab used to print a paragraph of generated coaching every morning. It reports
// the numbers instead, for a structural reason: the figures the system computes have
// been reliable, and the prose wrapped around them needed five corrective patches in a
// fortnight. The morning ntfy push still arrives — that part works — but the screen is
// now a dashboard, and the judgement happens in conversation.
//
// Recharts loads only for the fitness chart, below the fold. Everything above it is
// plain SVG and paints on the first render.
const FitnessChart = lazy(() => import('../components/FitnessChart'));
const MetricDetail = lazy(() => import('../components/MetricDetail'));

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

function Today() {
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
          <Metric label="Form" value={Number(data.training_load.tsb)} goodDirection="up" />
        )}
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {night.sleep_secs && <span className="tag">{hours(night.sleep_secs)} asleep</span>}
        {night.sleep_deep_secs && <span className="tag">{Math.round(night.sleep_deep_secs / 60)}m deep</span>}
        {night.sleep_rem_secs && <span className="tag">{Math.round(night.sleep_rem_secs / 60)}m REM</span>}
        {night.steps != null && <span className="tag">{night.steps.toLocaleString()} steps</span>}
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

// Compliance as dots, not sentences: seven nights against the 22:30 anchor, read left
// to right, oldest to last night. A filled dot is a night inside tolerance, a hollow
// one is a miss, and a dash is a night the watch didn't record — which is neither, and
// must not be scored as either.
function Protocol({ protocol, bodyweight }) {
  const last = protocol?.bedtime?.last_night;
  const streak = protocol?.movement?.current_streak_days ?? 0;

  // Seven calendar slots, oldest first, ending last night — not the seven most recent
  // *recorded* nights. Those are different sets whenever the watch came off, and
  // rendering the recorded ones while labelling them "last 7 nights" silently dropped
  // the untracked ones: seven dots over a caption reading "3 of 6 nights".
  //
  // The caption is counted from these same slots rather than taken from the server's
  // own tally, so the dots and the sentence cannot disagree.
  const byDate = new Map(
    (protocol?.bedtime?.last_14_nights || []).map((n) => [String(n.date).slice(0, 10), n])
  );
  const slots = [];
  for (let i = 7; i >= 1; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    slots.push({ iso, night: byDate.get(iso) || null });
  }
  const tracked = slots.filter((s) => s.night).length;
  const within = slots.filter((s) => s.night?.within_anchor).length;

  const weights = (bodyweight || []).filter((b) => b.weight_kg != null);
  const latestWeight = weights[weights.length - 1];
  const firstWeight = weights[0];
  const drift = latestWeight && firstWeight && weights.length > 1
    ? Number(latestWeight.weight_kg) - Number(firstWeight.weight_kg)
    : null;

  return (
    <section className="border-t border-neutral-200 dark:border-neutral-800 pt-4">
      <h2 className="section-label mb-2">Protocol</h2>

      <div className="flex items-center gap-1.5 flex-wrap">
        {slots.map(({ iso, night }) => (
          <span
            key={iso}
            title={
              night
                ? `${formatDay(iso, { weekday: 'short' })} · bed ${night.bed}`
                : `${formatDay(iso, { weekday: 'short' })} · not tracked`
            }
            className={
              !night
                ? 'w-3.5 h-3.5 flex items-center justify-center text-neutral-400 dark:text-neutral-600 text-xs leading-none'
                : night.within_anchor
                  ? 'w-3.5 h-3.5 rounded-full bg-emerald-500'
                  : 'w-3.5 h-3.5 rounded-full border-2 border-red-400 dark:border-red-500'
            }
          >
            {!night && '·'}
          </span>
        ))}
        <span className="text-[11px] text-neutral-500 dark:text-neutral-400 ml-1">
          bedtime · {within} of {tracked} tracked night{tracked === 1 ? '' : 's'} on anchor
        </span>
      </div>

      {last && (
        <p className="text-sm mt-2 tabular-nums">
          Last night <span className="font-medium">{last.bed}</span>{' '}
          <span className={Math.abs(last.minutes_vs_anchor) <= 30
            ? 'text-emerald-600 dark:text-emerald-500'
            : 'text-red-600 dark:text-red-400'}>
            {last.minutes_vs_anchor > 0 ? '+' : ''}{last.minutes_vs_anchor} min vs 22:30
          </span>
        </p>
      )}

      <p className="text-sm mt-1 text-neutral-700 dark:text-neutral-300 tabular-nums">
        Movement streak{' '}
        <span className="font-medium text-emerald-600 dark:text-emerald-500">
          {streak} day{streak === 1 ? '' : 's'}
        </span>
        {latestWeight && (
          <>
            {' · '}Weight <span className="font-medium">{formatKg(latestWeight.weight_kg)}</span>
            {drift != null && drift !== 0 && (
              <span className={drift > 0 ? 'text-amber-600 dark:text-amber-500' : 'text-emerald-600 dark:text-emerald-500'}>
                {' '}{drift > 0 ? '+' : ''}{drift.toFixed(1)}
              </span>
            )}
          </>
        )}
      </p>
    </section>
  );
}

// The standing weekly template against what the week actually contained. Today is
// marked but not scored — it hasn't finished yet.
function Week({ week }) {
  if (!week?.days?.length) return null;
  return (
    <section className="border-t border-neutral-200 dark:border-neutral-800 pt-4">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="section-label">This week</h2>
        <span className="text-[11px] text-neutral-500 dark:text-neutral-400 tabular-nums">
          {week.slots_met} of {week.slots_scored} slots
        </span>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {week.days.map((d) => (
          <div key={d.date} className={d.is_today ? 'rounded-md bg-neutral-100 dark:bg-neutral-800/70 py-1' : 'py-1'}>
            <div className="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              {formatDay(d.date, { weekday: 'short' })}
            </div>
            <div className="text-base leading-5 mt-0.5">
              {d.met ? (
                <span className="text-emerald-600 dark:text-emerald-500">✓</span>
              ) : d.upcoming || d.is_today ? (
                <span className="text-neutral-400 dark:text-neutral-600">·</span>
              ) : (
                <span className="text-neutral-300 dark:text-neutral-700">—</span>
              )}
            </div>
            <div className="text-[10px] text-neutral-500 dark:text-neutral-400 truncate" title={d.did.join(', ') || d.slot}>
              {d.did.length ? d.did[0].split(' — ')[0].replace('Day ', '') : ''}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const TREND_ROWS = [
  { field: 'sleep_score', label: 'Sleep', stroke: '#60a5fa', goodDirection: 'up' },
  { field: 'body_battery_at_wake', label: 'Battery', stroke: '#34d399', goodDirection: 'up' },
  { field: 'resting_hr', label: 'RHR', stroke: '#f472b6', goodDirection: 'down', unit: 'bpm' },
  { field: 'stress_avg', label: 'Stress', stroke: '#fbbf24', goodDirection: 'down' },
  { field: 'steps', label: 'Steps', stroke: '#a78bfa', goodDirection: 'up' },
];

// Each row is its own baseline: the latest reading against the mean of its window, so a
// number is legible without having to remember what normal looks like. Tapping opens the
// same series over the full 90 days with axes and a range — the "look through it in
// detail" half of the tab, kept in place rather than on its own route so the comparison
// with the rows around it survives.
function TrendRow({ row, window30, window90, open, onToggle }) {
  // Same "not tracked" test as Sparkline and MetricDetail, and it has to be: Number('')
  // is 0, so an empty reading would enter the mean as a zero-score night and drag the
  // baseline the row is judged against — while the chart beside it, which drops the
  // same value, showed a different average.
  const values = window30
    .map((d) => d[row.field])
    .filter((v) => v != null && v !== '' && Number.isFinite(Number(v)))
    .map(Number);
  if (values.length < 2) return null;
  const latest = values[values.length - 1];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const diff = Math.round(latest - mean);
  const good = diff === 0 ? null : row.goodDirection === 'up' ? diff > 0 : diff < 0;

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-3 py-1 min-h-11 md:min-h-0 text-left rounded-md
                   hover:bg-neutral-50 dark:hover:bg-neutral-900/50 transition-colors"
      >
        <span className="w-14 shrink-0 text-xs text-neutral-500 dark:text-neutral-400">{row.label}</span>
        <Sparkline
          data={window30}
          field={row.field}
          stroke={row.stroke}
          className="flex-1 min-w-0 h-6"
        />
        <span className="w-14 shrink-0 text-right text-sm font-medium tabular-nums">
          {row.field === 'steps' ? latest.toLocaleString() : latest}
        </span>
        <span className={`w-11 shrink-0 text-right text-[11px] tabular-nums ${
          diff === 0 ? 'text-neutral-400 dark:text-neutral-600'
            : good ? 'text-emerald-600 dark:text-emerald-500'
            : 'text-amber-600 dark:text-amber-500'
        }`}>
          {diff > 0 ? '+' : ''}{diff}
        </span>
        <span className="w-3 shrink-0 text-[10px] text-neutral-400 dark:text-neutral-600">
          {open ? '▲' : '▼'}
        </span>
      </button>
      {open && (
        <Suspense fallback={<Skeleton className="h-44 w-full" />}>
          <MetricDetail
            label={row.label}
            data={window90}
            field={row.field}
            stroke={row.stroke}
            unit={row.unit}
          />
        </Suspense>
      )}
    </div>
  );
}

// Minutes above the top of his Zone 2, per run. This is the number the weekly review
// grades him on and the one whole-session average HR hides: on a run/walk session the
// walk reps drag the average down while the run reps sit at threshold.
function RunDiscipline({ runs, ceiling }) {
  // An empty section, not a vanished one: no runs in six weeks is itself the finding,
  // and a section that silently disappears reads as a bug rather than as a fact.
  if (!runs?.length) {
    return (
      <section className="border-t border-neutral-200 dark:border-neutral-800 pt-4">
        <h2 className="section-label mb-2">Run discipline</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          No runs logged in the last six weeks.
        </p>
      </section>
    );
  }
  const recent = runs.slice(-6);
  const worst = Math.max(...recent.map((r) => Number(r.minutes_over_hr_ceiling) || 0), 1);

  return (
    <section className="border-t border-neutral-200 dark:border-neutral-800 pt-4">
      <h2 className="section-label mb-2">Run discipline · minutes over {ceiling} bpm</h2>
      <div className="flex items-end gap-2 h-24">
        {recent.map((r) => {
          const mins = Number(r.minutes_over_hr_ceiling) || 0;
          const tone = mins <= 3 ? 'bg-emerald-500' : mins <= 12 ? 'bg-amber-500' : 'bg-red-500';
          return (
            <div key={r.date} className="flex-1 flex flex-col justify-end items-center gap-1 h-full">
              <span className="text-[10px] text-neutral-500 dark:text-neutral-400 tabular-nums">{mins}</span>
              <div
                className={`w-full rounded-t ${tone}`}
                style={{ height: `${Math.max((mins / worst) * 100, 3)}%` }}
              />
              <span className="text-[10px] text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
                {formatDay(r.date, { day: 'numeric', month: 'short' })}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1.5">
        An easy run should sit near zero. Ten-plus is a threshold run wearing an easy run’s name.
      </p>
    </section>
  );
}

function WeeklyReview({ entry }) {
  const [open, setOpen] = useState(false);
  if (!entry) return null;
  const a = entry.advice || {};
  return (
    <section className="border-t border-neutral-200 dark:border-neutral-800 pt-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-baseline justify-between text-left min-h-11 md:min-h-0"
        aria-expanded={open}
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

export default function Trends() {
  // 90 days in one request, rendered two ways: the sparklines take the last 30 (a
  // quarter's worth of daily points in a 200px line is noise), the expanded detail
  // takes all of it. One fetch, both views — a second request per row opened would be
  // the same bytes, later, on worse wifi.
  const { data: trends, isLoading } = useQuery({
    queryKey: ['trends', 90],
    queryFn: () => getTrends({ days: 90 }),
    staleTime: 5 * 60_000,
  });
  const { data: coach } = useQuery({
    queryKey: ['coach-latest'],
    queryFn: getCoachLatest,
    staleTime: 5 * 60_000,
  });
  const [openMetric, setOpenMetric] = useState(null);

  const wellness = trends?.wellness || [];
  const wellness30 = wellness.slice(-30);

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Trends</h1>

      <section>
        <h2 className="section-label mb-2">Last night</h2>
        <Today />
      </section>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <Protocol protocol={trends?.protocol} bodyweight={trends?.bodyweight} />
          <Week week={trends?.week} />

          <section className="border-t border-neutral-200 dark:border-neutral-800 pt-4">
            <h2 className="section-label mb-2">Fitness · 90 days</h2>
            <Suspense fallback={<Skeleton className="h-40 w-full" />}>
              <FitnessChart days={90} />
            </Suspense>
          </section>

          <section className="border-t border-neutral-200 dark:border-neutral-800 pt-4">
            <div className="flex items-baseline justify-between mb-2">
              <h2 className="section-label">Last 30 days</h2>
              <span className="text-[11px] text-neutral-400 dark:text-neutral-600">tap for 90</span>
            </div>
            {wellness30.length > 1 ? (
              TREND_ROWS.map((row) => (
                <TrendRow
                  key={row.field}
                  row={row}
                  window30={wellness30}
                  window90={wellness}
                  open={openMetric === row.field}
                  onToggle={() => setOpenMetric((f) => (f === row.field ? null : row.field))}
                />
              ))
            ) : (
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                No wellness readings yet — they arrive with the Garmin sync.
              </p>
            )}
          </section>

          <RunDiscipline runs={trends?.runs} ceiling={trends?.hr_ceiling ?? 153} />
        </>
      )}

      <CheckinCard />
      <WeeklyReview entry={coach?.weekly} />
    </div>
  );
}
