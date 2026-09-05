import { lazy, Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCoachLatest, getReadiness, getTrends } from '../api/client';
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

// How many nights back the shown night is. Whether it IS last night comes from the
// server's `is_last_night` — the app's calendar day is decided there, and recomputing
// it from the browser clock is how the two ends of one number start disagreeing. This
// only turns the gap into words.
function nightsAgo(iso) {
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return Math.round(
    (Date.parse(`${todayIso}T00:00:00Z`) - Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`)) / 86400000
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
      <>
        <h2 className="section-label mb-2">Last night</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          No wellness data yet — the Garmin sync hasn’t written a row.
        </p>
      </>
    );
  }

  // `is_last_night` is absent on a cached response from before this shipped; treating
  // undefined as "assume it is" keeps the old behaviour rather than flashing a false
  // stale warning at everyone on first load after an update.
  const stale = data.is_last_night === false;
  const back = stale ? nightsAgo(night.date) : 0;
  const heading = !stale ? 'Last night' : back === 1 ? 'Night before last' : `${back} nights ago`;

  const base = data.baseline_10d || {};
  // One source for both halves of the tile, so the label cannot end up as a dangling
  // "Stress · " if the value is ever absent. Today it cannot be — Metric renders nothing
  // for a null value — but that safety lives in a different component, and this label is
  // built here.
  const stress = data.stress_last_full_day;
  const stressLabel = stress?.stress_avg != null
    ? `Stress · ${formatDay(stress.date, { weekday: 'short' })}`
    : 'Stress';
  return (
    <>
      <div className="flex items-baseline justify-between mb-2">
        <h2 className={`section-label ${stale ? 'text-amber-700 dark:text-amber-500' : ''}`}>
          {heading}
        </h2>
        {stale && (
          <span className="text-[11px] text-amber-700 dark:text-amber-500">
            last night not synced
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-3">
        <Metric label="Battery" value={night.body_battery_at_wake} baseline={base.body_battery_at_wake} goodDirection="up" />
        <Metric label="Sleep" value={night.sleep_score} baseline={base.sleep_score} goodDirection="up" />
        <Metric label="RHR" value={night.resting_hr} unit="bpm" baseline={base.resting_hr} goodDirection="down" />
        {/* Stress is a whole-DAY average, unlike everything else on this card, which is
            settled by the time he wakes. Today's row only ever holds a part-day — at
            06:00 it is an average of sleeping hours — so it reads far too calm against a
            baseline of complete days. Show the last complete day and name it, rather than
            a number that is wrong every morning in the reassuring direction. */}
        <Metric
          label={stressLabel}
          value={stress?.stress_avg != null ? Number(stress.stress_avg) : null}
          baseline={base.stress_avg}
          goodDirection="down"
        />
        {data.training_load?.tsb != null && (
          <Metric label="Form" value={Number(data.training_load.tsb)} goodDirection="up" />
        )}
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {night.sleep_secs && <span className="tag">{hours(night.sleep_secs)} asleep</span>}
        {night.sleep_deep_secs && <span className="tag">{Math.round(night.sleep_deep_secs / 60)}m deep</span>}
        {night.sleep_rem_secs && <span className="tag">{Math.round(night.sleep_rem_secs / 60)}m REM</span>}
        {night.steps != null && <span className="tag">{night.steps.toLocaleString()} steps</span>}
        {data.steps_today != null && (
          <span className="tag">{data.steps_today.toLocaleString()} steps today</span>
        )}
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

  // The bodyweight endpoint returns NEWEST first. Reading it as oldest-first showed the
  // oldest reading as his current weight and inverted the sign of the trend — a 94.09
  // that was really 94.78, and a +0.7kg gain rendered as "-0.7" in green. Sorted here
  // rather than trusting the order, so a change at the other end cannot flip it back.
  const weights = (bodyweight || [])
    .filter((b) => b.weight_kg != null)
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const latestWeight = weights[weights.length - 1];
  const oldestWeight = weights[0];
  const drift = latestWeight && oldestWeight && weights.length > 1
    ? Number(latestWeight.weight_kg) - Number(oldestWeight.weight_kg)
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
            {/* Named because it is not obvious: the scale syncs to Garmin Connect, which
                reaches here via intervals.icu, so nothing is typed in by hand. The manual
                logger exists for weeks away from the scale and has never been used. */}
            <span className="text-neutral-500 dark:text-neutral-400 font-normal">
              {' '}({latestWeight.source === 'manual' ? 'manual' : 'Garmin'})
            </span>
          </>
        )}
        {(() => {
          // Fat mass in kg, not the raw percentage: "23.3kg fat / 72.5kg lean" is the
          // decomposition that answers whether a weight move is tissue or water, and
          // percentages hide it (weight up + fat% flat still means fat up). BIA is a
          // trend instrument — day-to-day wobble is hydration, so this shows the
          // latest reading and lets the weekly eye do the smoothing.
          const bf = weights.filter((b) => b.body_fat_pct != null).at(-1);
          if (!bf) return null;
          const fatKg = (Number(bf.weight_kg) * Number(bf.body_fat_pct)) / 100;
          return (
            <span className="text-neutral-500 dark:text-neutral-400">
              {' · '}fat {fatKg.toFixed(1)}kg ({Number(bf.body_fat_pct).toFixed(1)}%)
            </span>
          );
        })()}
      </p>

      {(() => {
        // Ramp compliance per rule, kept-of-answered over the last 7 days. Answered is
        // the denominator on purpose: an unanswered day is "didn't say", and folding it
        // into the denominator would punish forgetting to log as if it were caffeine at
        // 4pm. Rules with nothing answered are omitted; no answers at all, no line.
        const ramp = protocol?.evening_ramp?.last_7_days;
        const parts = [
          ['caffeine', ramp?.no_caffeine_pm],
          ['food', ramp?.food_by_cutoff],
          ['screens', ramp?.screens_by_cutoff],
        ].filter(([, t]) => t && t.answered > 0);
        if (!parts.length) return null;
        return (
          <p className="text-sm mt-1 text-neutral-700 dark:text-neutral-300 tabular-nums">
            Evening ramp
            {parts.map(([label, t]) => (
              <span key={label}>
                {' · '}{label}{' '}
                <span className={t.kept === t.answered
                  ? 'font-medium text-emerald-600 dark:text-emerald-500'
                  : 'font-medium'}>
                  {t.kept}/{t.answered}
                </span>
              </span>
            ))}
          </p>
        );
      })()}

      {(() => {
        // Distance to goal is deliberately computed from the WEEKLY MEAN, never from the
        // number on the scale this morning. Those are different instruments: inside this
        // very dataset he went 94.79 -> 96.10 on consecutive days across a fortnight that
        // averaged out nearly flat, and a "2.8kg to go" that swings by a kilo overnight
        // would talk him out of a plan that is working. The server owns the arithmetic so
        // the coach reasons over the same two numbers this line shows.
        const g = protocol?.weight;
        if (!g || g.week_mean == null) return null;

        // Week-on-week is the signal the guardrails are written against, so it is
        // coloured and the raw distance is not: losing at a sane rate is the only green.
        // Flat stays neutral because ONE flat week is noise — it is two in a row that
        // mean something, and colouring the first amber would manufacture an alarm.
        const paceClass = {
          losing: 'text-emerald-600 dark:text-emerald-500',
          gaining: 'text-amber-600 dark:text-amber-500',
          too_fast: 'text-amber-600 dark:text-amber-500',
          flat: 'text-neutral-500 dark:text-neutral-400',
        }[g.pace] || 'text-neutral-500 dark:text-neutral-400';
        const paceTitle = {
          losing: 'On plan — a sane rate that keeps lean tissue',
          gaining: 'Weekly mean is up on last week',
          too_fast: `Faster than ${g.max_loss_kg_per_week}kg/week — that rate spends lean tissue`,
          flat: 'No move this week. Two flat weeks in a row is the signal to tighten a lever.',
        }[g.pace];

        const reached = g.to_goal_kg != null && g.to_goal_kg <= 0;

        return (
          <p className="text-sm mt-1 text-neutral-700 dark:text-neutral-300 tabular-nums">
            Goal <span className="font-medium">{g.goal_kg.toFixed(1)}kg</span>
            {' · '}week mean{' '}
            <span className="font-medium">{g.week_mean.toFixed(1)}</span>
            {g.change_kg != null && (
              <span className={paceClass} title={paceTitle}>
                {' '}{g.change_kg > 0 ? '+' : ''}{g.change_kg.toFixed(1)} vs last wk
              </span>
            )}
            <span className="text-neutral-500 dark:text-neutral-400">
              {reached
                ? ' · at goal'
                : ` · ${g.to_goal_kg.toFixed(1)}kg to go`}
            </span>
            {/* A thin week is shown rather than silently averaged: three readings is the
                floor for calling something a mean, and a week that scrapes it should say
                so next to the number it produced. */}
            {g.week_readings < 5 && (
              <span
                className="text-neutral-400 dark:text-neutral-500"
                title="Weekly mean over fewer than five weigh-ins"
              >
                {' '}({g.week_readings} weigh-in{g.week_readings === 1 ? '' : 's'})
              </span>
            )}
          </p>
        );
      })()}
    </section>
  );
}

const TREND_ROWS = [
  { field: 'sleep_score', label: 'Sleep', stroke: '#60a5fa', goodDirection: 'up' },
  { field: 'body_battery_at_wake', label: 'Battery', stroke: '#34d399', goodDirection: 'up' },
  { field: 'resting_hr', label: 'RHR', stroke: '#f472b6', goodDirection: 'down', unit: 'bpm' },
  { field: 'stress_avg', label: 'Stress', stroke: '#fbbf24', goodDirection: 'down' },
  { field: 'steps', label: 'Steps', stroke: '#a78bfa', goodDirection: 'up' },
  // Down is "good" because the protocol target is flat-or-down. Tenths matter here and
  // nowhere else on this list: a 0.4kg move rounds to zero and reads as no change.
  { field: 'weight_kg', label: 'Weight', stroke: '#fb923c', goodDirection: 'down', unit: 'kg', precision: 1 },
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
  const precision = row.precision || 0;
  const diff = Number((latest - mean).toFixed(precision));
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
          {row.field === 'steps' ? latest.toLocaleString()
            : precision > 0 ? latest.toFixed(precision)
            : latest}
        </span>
        <span className={`w-11 shrink-0 text-right text-[11px] tabular-nums ${
          diff === 0 ? 'text-neutral-400 dark:text-neutral-600'
            : good ? 'text-emerald-600 dark:text-emerald-500'
            : 'text-amber-600 dark:text-amber-500'
        }`}>
          {diff > 0 ? '+' : ''}{precision > 0 ? diff.toFixed(precision) : diff}
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
            precision={precision}
          />
        </Suspense>
      )}
    </div>
  );
}

// Minutes above the top of his Zone 2, per run. This is the number the weekly review
// grades him on and the one whole-session average HR hides: on a run/walk session the
// walk reps drag the average down while the run reps sit at threshold.
// Runs and swims as sessions rather than a single bar chart. The over-ceiling minutes
// the weekly review grades him on are still here, now as one line inside a row that
// also carries cadence, elevation and the swim beside it — because the interesting
// question is never "how many minutes over" on its own, it is that number next to the
// terrain and the pace that produced it.
//
// Cadence and elevation were already synced and simply never read: the ingest keeps the
// whole intervals.icu payload, so this needed no new plumbing and no waiting for data.
// Round the TOTAL seconds before splitting. Rounding the remainder instead lets 5:59.6
// render as "5:60", because the carry never reaches the minutes.
function mmss(secondsPerUnit) {
  const total = Math.round(secondsPerUnit);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function pacePerKm(seconds, metres) {
  if (!seconds || !metres) return null;
  return mmss(seconds / (metres / 1000));
}

function pacePer100m(seconds, metres) {
  if (!seconds || !metres) return null;
  return mmss(seconds / (metres / 100));
}

function SessionRow({ children, date }) {
  return (
    <div className="flex gap-3 py-2">
      <span className="w-12 shrink-0 text-xs text-neutral-500 dark:text-neutral-400 pt-0.5">
        {formatDay(date, { day: 'numeric', month: 'short' })}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Endurance({ sessions, ceiling }) {
  // An empty section, not a vanished one: no endurance work in six weeks is itself the
  // finding, and a section that silently disappears reads as a bug rather than a fact.
  if (!sessions?.length) {
    return (
      <section className="border-t border-neutral-200 dark:border-neutral-800 pt-4">
        <h2 className="section-label mb-1">Endurance</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          No runs or swims in the last six weeks.
        </p>
      </section>
    );
  }

  const runs = sessions.filter((s) => s.type === 'Run' || s.type === 'VirtualRun');
  const swims = sessions.filter((s) => s.type === 'Swim');

  return (
    <section className="border-t border-neutral-200 dark:border-neutral-800 pt-4">
      <h2 className="section-label mb-1">Endurance · last 6 weeks</h2>

      {runs.length > 0 && (
        <>
          <p className="text-[11px] uppercase tracking-wide text-neutral-400 dark:text-neutral-600 mt-2">Runs</p>
          <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {runs.map((r) => {
              const mins = Number(r.minutes_over_hr_ceiling) || 0;
              const overTone = mins <= 3 ? 'text-emerald-600 dark:text-emerald-500'
                : mins <= 12 ? 'text-amber-600 dark:text-amber-500'
                : 'text-red-600 dark:text-red-400';
              // The running-only cadence, from the per-second stream — walk breaks
              // excluded, so it means what it says. The whole-session average (which
              // once raised a false overstriding alarm on a hilly walk-break day) is
              // the fallback for pre-stream history only, and is labelled as such.
              const runCadence = r.run_cadence != null ? Number(r.run_cadence) : null;
              const cadence = r.cadence != null ? Number(r.cadence) : null;
              const effortCount = Array.isArray(r.efforts) ? r.efforts.length : 0;
              return (
                <SessionRow key={r.date + r.name} date={r.date}>
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm tabular-nums">
                    <span className="font-medium">{(Number(r.distance_m) / 1000).toFixed(1)}km</span>
                    <span>{pacePerKm(r.moving_time, Number(r.distance_m))}/km</span>
                    {r.average_hr && <span className="text-neutral-500 dark:text-neutral-400">HR {r.average_hr}</span>}
                    {runCadence != null ? (
                      <span className="text-neutral-500 dark:text-neutral-400">{runCadence} spm run</span>
                    ) : cadence != null ? (
                      <span className="text-neutral-500 dark:text-neutral-400">{cadence} spm session</span>
                    ) : null}
                    {/* Detected strides/surges. Two is the floor: one "effort" on an
                        easy run is usually a downhill, six is a stride set, fourteen
                        is a run that never settled. */}
                    {effortCount >= 2 && (
                      <span className="text-neutral-500 dark:text-neutral-400">{effortCount} efforts</span>
                    )}
                    {r.elevation_m != null && (
                      <span className="text-neutral-500 dark:text-neutral-400">↑{r.elevation_m}m</span>
                    )}
                    {/* Bpm dropped in the minute after the run's hardest effort. Only
                        present when the file has a clear peak — in practice, stride
                        days. The number to watch rise as the base builds: it moves
                        weeks before pace-at-HR does, so it gets the accent colour the
                        other chips don't. */}
                    {r.hrr != null && (
                      <span className="text-sky-600 dark:text-sky-400">HRR {r.hrr}</span>
                    )}
                    {/* Aerobic decoupling. Amber only from 10% — high drift is as often
                        a fast first km as a fitness statement, so it flags, not scolds. */}
                    {r.decoupling_pct != null && (
                      <span className={Number(r.decoupling_pct) >= 10
                        ? 'text-amber-600 dark:text-amber-500'
                        : 'text-neutral-500 dark:text-neutral-400'}>
                        drift {r.decoupling_pct}%
                      </span>
                    )}
                  </div>
                  <p className={`text-[11px] tabular-nums ${overTone}`}>
                    {mins} min over {ceiling} bpm
                  </p>
                </SessionRow>
              );
            })}
          </div>
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1.5">
            An easy run should sit near zero minutes over. “spm run” is cadence over the
            running samples only — walk breaks excluded; “spm session” is the old blended
            average on pre-stream history. HRR is beats recovered in the minute after the
            session’s peak — higher is fitter. Drift is aerobic decoupling: how much more heart
            the second half cost than the first (strides excluded) — under 5% is a built
            base, and a fast first kilometre inflates it.
          </p>
        </>
      )}

      {swims.length > 0 && (
        <>
          <p className="text-[11px] uppercase tracking-wide text-neutral-400 dark:text-neutral-600 mt-4">Swims</p>
          <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {swims.map((w) => (
              <SessionRow key={w.date + w.name} date={w.date}>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm tabular-nums">
                  {/* Duration first, deliberately. It is the aerobic dose, and the pace
                      beside it will read slower on exactly the sessions that went best. */}
                  <span className="font-medium">{Math.round(w.moving_time / 60)} min</span>
                  <span>{Number(w.distance_m)}m</span>
                  <span className="text-neutral-500 dark:text-neutral-400">
                    {pacePer100m(w.moving_time, Number(w.distance_m))}/100m
                  </span>
                  {w.stride_m != null && (
                    <span className="text-neutral-500 dark:text-neutral-400">{w.stride_m} m/stroke</span>
                  )}
                  {/* Wall rest from the stream. On a continuous-block swim this is the
                      honest continuity figure — pace per 100m can hold steady while
                      the rests quietly grow. */}
                  {w.swim_rest_s != null && (
                    <span className="text-neutral-500 dark:text-neutral-400">
                      rest {Math.floor(w.swim_rest_s / 60)}:{String(w.swim_rest_s % 60).padStart(2, '0')}
                    </span>
                  )}
                </div>
              </SessionRow>
            ))}
          </div>
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1.5">
            Minutes are the dose; distance per stroke is the economy. A slower pace with more
            minutes is a better session, not a worse one.
          </p>
        </>
      )}
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

  // Weight is its own series — one row per day he actually stepped on the scale, not
  // one per day — so it is joined onto the daily wellness rows by date. Days with no
  // reading stay null and render as gaps, exactly like an untracked night.
  const weightByDate = new Map(
    (trends?.bodyweight || [])
      .filter((b) => b.weight_kg != null)
      .map((b) => [String(b.date).slice(0, 10), Number(b.weight_kg)])
  );
  const joined = (trends?.wellness || []).map((w) => ({
    ...w,
    weight_kg: weightByDate.get(String(w.date).slice(0, 10)) ?? null,
  }));
  // The wellness series deliberately ends YESTERDAY, because stress and steps are
  // part-days on today's row. Weight is not: a morning weigh-in is a complete reading the
  // moment it lands. Without this the weight row showed 94.8 from yesterday while the
  // protocol line six inches above showed today's 94.2 — one number, two answers, which
  // is the failure this whole tab exists to remove. Today is appended with weight only;
  // every other field stays null and renders as the gap it is.
  const lastDay = joined.length ? String(joined[joined.length - 1].date).slice(0, 10) : null;
  const todayWeight = [...weightByDate.entries()]
    .filter(([d]) => !lastDay || d > lastDay)
    .sort((a, b) => a[0].localeCompare(b[0]));
  const wellness = todayWeight.length
    ? [...joined, ...todayWeight.map(([date, weight_kg]) => ({ date, weight_kg }))]
    : joined;
  const wellness30 = wellness.slice(-30);

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Trends</h1>

      {/* The heading lives inside Today: it has to name which night this actually is,
          and only the component knows whether the newest row is last night's. */}
      <section>
        <Today />
      </section>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <Protocol protocol={trends?.protocol} bodyweight={trends?.bodyweight} />

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

          <Endurance
            sessions={trends?.endurance}
            ceiling={trends?.hr_ceiling ?? 153}
          />
        </>
      )}

      {/* The check-in moved to Home on 2026-09-05: it was the most-used control in the
          app and it sat at the bottom of its longest page. The week plan went with it. */}
      <WeeklyReview entry={coach?.weekly} />
    </div>
  );
}
