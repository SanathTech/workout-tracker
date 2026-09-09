import { lazy, Suspense, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCheckins, getCoachLatest, getReadiness, getTrends, logBodyweight,
} from '../api/client';
import Sparkline from '../components/Sparkline';
import { Skeleton } from '../components/Skeleton';
import { ChevronIcon } from '../components/icons';
import { Disclosure, Page, Section, Tile } from '../components/ui';
import { formatDay, localDate } from '../util/format';
import { track } from '../util/telemetry';

// Health (Trends until 2026-09-08, Coach before that). This tab used to print a
// paragraph of generated coaching every morning. It reports the numbers instead, for a
// structural reason: the figures the system computes have been reliable, and the prose
// wrapped around them needed five corrective patches in a fortnight. The morning ntfy
// push still arrives — that part works — but the screen is a dashboard, and the
// judgement happens in conversation.
//
// Redesign PR 5 regrouped the same data by the question it answers, in the order he
// asks them: the week review first (it used to be last, under three screens of rows),
// then Recovery (last night against its baseline, then the month), Protocol (the levers
// he controls — bedtime, the ramp, weight), Endurance last. The explainer paragraphs
// that sat under every block are behind an ⓘ now: they were read once.
//
// Recharts loads only for the fitness chart and the expanded detail. Everything else is
// plain SVG and paints on the first render.
const FitnessChart = lazy(() => import('../components/FitnessChart'));
const MetricDetail = lazy(() => import('../components/MetricDetail'));
const EnduranceTrends = lazy(() => import('../components/EnduranceTrends'));

function hours(secs) {
  if (!secs) return null;
  return `${Math.floor(secs / 3600)}h ${Math.round((secs % 3600) / 60)}m`;
}

// How many nights back the shown night is. Whether it IS last night comes from the
// server's `is_last_night` — the app's calendar day is decided there, and recomputing
// it from the browser clock is how the two ends of one number start disagreeing. This
// only turns the gap into words.
function nightsAgo(iso) {
  return Math.round(
    (Date.parse(`${localDate()}T00:00:00Z`) - Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`)) / 86400000
  );
}

// The ⓘ that replaced the explainer paragraphs. One glyph app-wide; the text it reveals
// is whatever the section passes.
function InfoToggle({ open, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-label={label}
      className={`w-11 h-11 -m-3 md:w-auto md:h-auto md:m-0 inline-flex items-center justify-center rounded-full text-sm leading-none ${
        open ? 'text-neutral-200' : 'text-neutral-600 hover:text-neutral-400'
      }`}
    >
      ⓘ
    </button>
  );
}

// ── Recovery ────────────────────────────────────────────────

// A reading is only legible against its own baseline, so every tile carries its ten-day
// delta. Coloured by direction, not by value — a resting HR going up is bad where a
// Body Battery going up is good.
function readingTile({ label, value, unit, baseline, goodDirection, srName, note }) {
  if (value == null) return null;
  const diff = baseline != null ? Math.round(value - baseline) : null;
  const good = diff == null || diff === 0 ? null : goodDirection === 'up' ? diff > 0 : diff < 0;
  const delta = diff == null ? '' : diff === 0 ? '= 10d' : `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)}`;
  return {
    label,
    value: unit ? <>{value}<span className="text-xs font-normal text-neutral-400 ml-0.5">{unit}</span></> : value,
    sub: [delta, note].filter(Boolean).join(' · '),
    subClass: diff == null || diff === 0 ? 'text-neutral-400' : good ? 'text-emerald-400' : 'text-amber-400',
    srLabel: `${srName || label} ${value}${diff != null ? `, ${diff > 0 ? '+' : ''}${diff} against the ten-day mean` : ''}${note ? `, ${note}` : ''}`,
  };
}

function LastNight() {
  const { data, isLoading } = useQuery({
    queryKey: ['readiness'],
    queryFn: getReadiness,
    staleTime: 5 * 60_000,
  });

  if (isLoading) return <Skeleton className="h-16 w-full" />;
  const night = data?.last_night;
  if (!night) {
    return (
      <p className="text-sm text-neutral-400">
        No wellness data yet — the Garmin sync hasn’t written a row.
      </p>
    );
  }

  // `is_last_night` is absent on a cached response from before this shipped; treating
  // undefined as "assume it is" keeps the old behaviour rather than flashing a false
  // stale warning at everyone on first load after an update.
  const stale = data.is_last_night === false;
  const back = stale ? nightsAgo(night.date) : 0;
  const heading = !stale ? 'Last night' : back === 1 ? 'Night before last' : `${back} nights ago`;

  const base = data.baseline_10d || {};
  // Stress is a whole-DAY average, unlike everything else on this row, which is settled
  // by the time he wakes. Today's row only ever holds a part-day — at 06:00 it is an
  // average of sleeping hours — so it reads far too calm against a baseline of complete
  // days. Show the last complete day and name it, rather than a number that is wrong
  // every morning in the reassuring direction.
  //
  // Four tiles, like Today's four: five didn't fit their own labels at 390px. Form
  // (TSB) is the one that left — it's the legend line under the fitness chart below.
  const stress = data.stress_last_full_day;
  const tiles = [
    readingTile({ label: 'Battery', value: night.body_battery_at_wake, baseline: base.body_battery_at_wake, goodDirection: 'up', srName: 'Body battery' }),
    readingTile({ label: 'Sleep', value: night.sleep_score, baseline: base.sleep_score, goodDirection: 'up', srName: 'Sleep score' }),
    readingTile({ label: 'RHR', value: night.resting_hr, unit: 'bpm', baseline: base.resting_hr, goodDirection: 'down', srName: 'Resting heart rate' }),
    readingTile({
      label: 'Stress',
      value: stress?.stress_avg != null ? Number(stress.stress_avg) : null,
      baseline: base.stress_avg,
      goodDirection: 'down',
      note: stress?.date ? formatDay(stress.date, { weekday: 'short' }) : null,
    }),
  ].filter(Boolean);

  return (
    <>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <p className={`text-[11px] uppercase tracking-wide ${stale ? 'text-amber-400' : 'text-neutral-600'}`}>
          {heading} · {formatDay(night.date, { weekday: 'short', day: 'numeric', month: 'short' })}
        </p>
        {stale ? (
          <span className="text-[11px] text-amber-400">last night not synced</span>
        ) : data.stale_hours != null && data.stale_hours > 48 ? (
          <span className="text-[11px] text-amber-400">sync {data.stale_hours}h stale</span>
        ) : null}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {tiles.map((t) => <Tile key={t.label} {...t} />)}
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
    </>
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
        className="w-full flex items-center gap-3 py-1 min-h-11 md:min-h-0 text-left rounded-md hover:bg-neutral-900/50 transition-colors"
      >
        <span className="w-14 shrink-0 text-xs text-neutral-400">{row.label}</span>
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
          diff === 0 ? 'text-neutral-600'
            : good ? 'text-emerald-400'
            : 'text-amber-400'
        }`}>
          {diff > 0 ? '+' : ''}{precision > 0 ? diff.toFixed(precision) : diff}
        </span>
        <span className="w-3 shrink-0 inline-flex items-center text-neutral-600">
          <ChevronIcon open={open} />
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

function Recovery({ wellness, isLoading }) {
  const [openMetric, setOpenMetric] = useState(null);
  const wellness30 = wellness.slice(-30);
  return (
    <Section label="Recovery">
      <LastNight />

      <div className="flex items-baseline justify-between mt-4 mb-1">
        <p className="text-[11px] uppercase tracking-wide text-neutral-600">Last 30 days</p>
        <span className="text-[11px] text-neutral-600">tap for 90</span>
      </div>
      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : wellness30.length > 1 ? (
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
        <p className="text-sm text-neutral-400">
          No wellness readings yet — they arrive with the Garmin sync.
        </p>
      )}

      <p className="text-[11px] uppercase tracking-wide text-neutral-600 mt-4 mb-1">Fitness · 90 days</p>
      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <FitnessChart days={90} />
      </Suspense>
    </Section>
  );
}

// ── Protocol ────────────────────────────────────────────────

// The one place a weigh-in is typed in (the logger lived on Lifts until PR 5, next to
// a chart nobody looked at). Named because it is not obvious: the scale syncs to Garmin
// Connect, which reaches here via intervals.icu, so nothing is normally typed in by hand.
// The logger exists for weeks away from the scale.
function WeighIn() {
  const qc = useQueryClient();
  const [value, setValue] = useState('');
  const save = useMutation({
    mutationFn: () => logBodyweight({ weight_kg: Number(value) }),
    onSuccess: () => {
      setValue('');
      track('save', 'weigh-in');
      // Every reader of the series — this page and Today's tile — keys on ['trends', days].
      // Prefix match on purpose: whatever the window, the row that changed is today's.
      qc.invalidateQueries({ queryKey: ['trends'], exact: false });
    },
  });
  const parsed = Number(value);
  const valid = value !== '' && Number.isFinite(parsed) && parsed > 0 && parsed <= 500;
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(); }}
      className="flex items-center gap-2 mt-2"
    >
      <input
        type="number" inputMode="decimal" step="0.1" min="0"
        placeholder="kg"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="input w-24 py-1.5 tabular-nums"
        aria-label="Bodyweight in kilograms"
      />
      <button type="submit" disabled={!valid || save.isPending} className="btn-secondary px-4">
        {save.isPending ? '…' : 'Log weigh-in'}
      </button>
      <span className="text-[11px] text-neutral-600 min-w-0">
        {save.isError ? <span className="text-red-400">Couldn’t save.</span> : 'replaces today’s'}
      </span>
    </form>
  );
}

// The check-in history, on request. Fourteen days of mood / energy / soreness, the ramp
// toggles, and whatever he wrote — the rows are the primary source the coach reads, and
// the "latest notes" block that used to sit on this tab was a server-side digest of the
// same column. Fetched on open: it's the least-read thing on the page.
function CheckinHistory() {
  const [open, setOpen] = useState(false);
  const { data = [], isLoading } = useQuery({
    queryKey: ['checkins', 14],
    queryFn: () => getCheckins({ days: 14 }),
    staleTime: 60_000,
    enabled: open,
  });
  return (
    <div className="mt-3">
      <Disclosure open={open} label="Check-ins · 14 days" onClick={() => setOpen((o) => !o)} />
      {open && (
        isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : data.length === 0 ? (
          <p className="text-sm text-neutral-400">No check-ins in the last fortnight.</p>
        ) : (
          <ul className="divide-y divide-neutral-800">
            {data.map((c) => {
              const ramp = [c.no_caffeine_pm, c.food_by_cutoff, c.screens_by_cutoff];
              const answered = ramp.some((v) => v != null);
              return (
                <li key={c.date} className="flex gap-3 py-2">
                  <span className="w-12 shrink-0 text-xs text-neutral-400 pt-0.5">
                    {formatDay(c.date, { day: 'numeric', month: 'short' })}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm tabular-nums">
                      {c.mood != null || c.energy != null || c.soreness != null ? (
                        <span className="text-neutral-300">
                          Mood {c.mood ?? '–'} · Energy {c.energy ?? '–'} · Soreness {c.soreness ?? '–'}
                        </span>
                      ) : (
                        <span className="text-neutral-600">no ratings</span>
                      )}
                      {answered && (
                        <span className="text-neutral-400" title="caffeine · food · screens">
                          {' · '}{ramp.map((v) => (v == null ? '·' : v ? '✓' : '✗')).join('')}
                        </span>
                      )}
                    </p>
                    {c.note && <p className="text-sm text-neutral-200">“{c.note}”</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        )
      )}
    </div>
  );
}

// Compliance as dots, not sentences: seven nights against the 22:30 anchor, read left
// to right, oldest to last night. A filled dot is a night inside tolerance, a hollow
// one is a miss, and a dash is a night the watch didn't record — which is neither, and
// must not be scored as either.
function Protocol({ protocol, bodyweight }) {
  const [info, setInfo] = useState(false);
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
    const iso = localDate(-i);
    slots.push({ iso, night: byDate.get(iso) || null });
  }
  const tracked = slots.filter((s) => s.night).length;
  const within = slots.filter((s) => s.night?.within_anchor).length;

  // Ramp compliance per rule, kept-of-answered over the last 7 days. Answered is the
  // denominator on purpose: an unanswered day is "didn't say", and folding it into the
  // denominator would punish forgetting to log as if it were caffeine at 4pm. Rules with
  // nothing answered are omitted; no answers at all, no line.
  const ramp = protocol?.evening_ramp?.last_7_days;
  const rampParts = [
    ['caffeine', ramp?.no_caffeine_pm],
    ['food', ramp?.food_by_cutoff],
    ['screens', ramp?.screens_by_cutoff],
  ].filter(([, t]) => t && t.answered > 0);

  // The bodyweight endpoint returns NEWEST first. Reading it as oldest-first showed the
  // oldest reading as his current weight and inverted the sign of the trend — a 94.09
  // that was really 94.78, and a +0.7kg gain rendered as "-0.7" in green. Sorted here
  // rather than trusting the order, so a change at the other end cannot flip it back.
  const weights = (bodyweight || [])
    .filter((b) => b.weight_kg != null)
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const latestWeight = weights[weights.length - 1];
  // Fat mass in kg, not the raw percentage: "23.3kg fat / 72.5kg lean" is the
  // decomposition that answers whether a weight move is tissue or water, and
  // percentages hide it (weight up + fat% flat still means fat up). BIA is a trend
  // instrument — day-to-day wobble is hydration, so this shows the latest reading and
  // lets the weekly eye do the smoothing.
  const bf = weights.filter((b) => b.body_fat_pct != null).at(-1);
  const fatKg = bf ? (Number(bf.weight_kg) * Number(bf.body_fat_pct)) / 100 : null;

  // Distance to goal is deliberately computed from the WEEKLY MEAN, never from the
  // number on the scale this morning. Those are different instruments: inside this very
  // dataset he went 94.79 -> 96.10 on consecutive days across a fortnight that averaged
  // out nearly flat, and a "2.8kg to go" that swings by a kilo overnight would talk him
  // out of a plan that is working. The server owns the arithmetic so the coach reasons
  // over the same two numbers this line shows.
  const g = protocol?.weight;
  // Week-on-week is the signal the guardrails are written against, so it is coloured
  // and the raw distance is not: losing at a sane rate is the only green. Flat stays
  // neutral because ONE flat week is noise — it is two in a row that mean something,
  // and colouring the first amber would manufacture an alarm.
  const paceClass = {
    losing: 'text-emerald-400',
    gaining: 'text-amber-400',
    too_fast: 'text-amber-400',
    flat: 'text-neutral-400',
  }[g?.pace] || 'text-neutral-400';
  const paceTitle = {
    losing: 'On plan — a sane rate that keeps lean tissue',
    gaining: 'Weekly mean is up on last week',
    too_fast: `Faster than ${g?.max_loss_kg_per_week}kg/week — that rate spends lean tissue`,
    flat: 'No move this week. Two flat weeks in a row is the signal to tighten a lever.',
  }[g?.pace];
  const reached = g?.to_goal_kg != null && g.to_goal_kg <= 0;

  return (
    <Section
      label="Protocol"
      action={<InfoToggle open={info} onClick={() => setInfo((o) => !o)} label="How the protocol lines are read" />}
    >
      {info && (
        <p className="text-[11px] text-neutral-400 mb-3">
          Bedtime dots are the last seven nights against the 22:30 anchor — filled is on time,
          hollow is a miss, a dot is a night the watch didn’t record. Ramp is kept-of-answered,
          so a day you didn’t log is not a day you broke it. Goal distance is measured from the
          weekly mean, not this morning’s reading: the scale swings a kilo overnight, the mean
          doesn’t. Fat is the BIA estimate as kilos — a trend instrument, read weekly.
        </p>
      )}

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
                ? 'w-3.5 h-3.5 flex items-center justify-center text-neutral-600 text-xs leading-none'
                : night.within_anchor
                  ? 'w-3.5 h-3.5 rounded-full bg-emerald-500'
                  : 'w-3.5 h-3.5 rounded-full border-2 border-red-500'
            }
          >
            {!night && '·'}
          </span>
        ))}
        <span className="text-[11px] text-neutral-400 ml-1">
          bedtime · {within} of {tracked} tracked night{tracked === 1 ? '' : 's'} on anchor
        </span>
      </div>

      {last && (
        <p className="text-sm mt-2 tabular-nums">
          Last night <span className="font-medium">{last.bed}</span>{' '}
          <span className={Math.abs(last.minutes_vs_anchor) <= 30
            ? 'text-emerald-400'
            : 'text-red-400'}>
            {last.minutes_vs_anchor > 0 ? '+' : ''}{last.minutes_vs_anchor} min vs 22:30
          </span>
        </p>
      )}

      <p className="text-sm mt-1 text-neutral-300 tabular-nums">
        Movement streak{' '}
        <span className="font-medium text-emerald-400">
          {streak} day{streak === 1 ? '' : 's'}
        </span>
        {rampParts.length > 0 && (
          <>
            {' · '}ramp
            {rampParts.map(([label, t]) => (
              <span key={label}>
                {' '}{label}{' '}
                <span className={t.kept === t.answered
                  ? 'font-medium text-emerald-400'
                  : 'font-medium'}>
                  {t.kept}/{t.answered}
                </span>
              </span>
            ))}
          </>
        )}
      </p>

      {/* Weight: today's reading and its source, the goal against the weekly mean, and
          the fat estimate. Then the only weigh-in input in the app. */}
      <div className="mt-3">
        <p className="text-[11px] uppercase tracking-wide text-neutral-600 mb-1">Weight</p>
        {latestWeight ? (
          <p className="text-sm tabular-nums">
            <span className="font-medium">{Number(latestWeight.weight_kg).toFixed(1)}kg</span>
            <span className="text-neutral-400">
              {' '}{formatDay(latestWeight.date, { day: 'numeric', month: 'short' })}
              {' · '}{latestWeight.source === 'manual' ? 'manual' : 'Garmin'}
            </span>
            {fatKg != null && (
              <span className="text-neutral-400">
                {' · '}fat {fatKg.toFixed(1)}kg ({Number(bf.body_fat_pct).toFixed(1)}%)
              </span>
            )}
          </p>
        ) : (
          <p className="text-sm text-neutral-400">No weigh-ins yet.</p>
        )}
        {g && g.week_mean != null && (
          <p className="text-sm mt-1 text-neutral-300 tabular-nums">
            Goal <span className="font-medium">{g.goal_kg.toFixed(1)}kg</span>
            {' · '}week mean{' '}
            <span className="font-medium">{g.week_mean.toFixed(1)}</span>
            {g.change_kg != null && (
              <span className={paceClass} title={paceTitle}>
                {' '}{g.change_kg > 0 ? '+' : ''}{g.change_kg.toFixed(1)} vs last wk
              </span>
            )}
            <span className="text-neutral-400">
              {reached ? ' · at goal' : ` · ${g.to_goal_kg.toFixed(1)}kg to go`}
            </span>
            {/* A thin week is shown rather than silently averaged: three readings is the
                floor for calling something a mean, and a week that scrapes it should say
                so next to the number it produced. */}
            {g.week_readings < 5 && (
              <span className="text-neutral-400" title="Weekly mean over fewer than five weigh-ins">
                {' '}({g.week_readings} weigh-in{g.week_readings === 1 ? '' : 's'})
              </span>
            )}
          </p>
        )}
        <WeighIn />
      </div>

      <CheckinHistory />
    </Section>
  );
}

// ── Endurance ───────────────────────────────────────────────

// Runs and swims as sessions rather than a single bar chart. The over-ceiling minutes
// the weekly review grades him on are still here, as one line inside a row that also
// carries cadence, elevation and the swim beside it — because the interesting question
// is never "how many minutes over" on its own, it is that number next to the terrain
// and the pace that produced it.
//
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
      <span className="w-12 shrink-0 text-xs text-neutral-400 pt-0.5">
        {formatDay(date, { day: 'numeric', month: 'short' })}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// A fortnight of sessions by default; the rest of the six weeks on tap. Twelve runs
// and five swims at two lines each was the block that made the old tab three screens
// long, and the recent ones are the ones the week review is talking about.
const RECENT_DAYS = 14;

// One discipline at a time (2026-09-09). The charts came first — "trends, not just a
// log list" — and six charts plus two logs stacked was the three-screen tab again. The
// chip scopes the whole section: the trend charts, then the recent sessions under them.
// Runs by default: the limiter for the 70.3 and the discipline the HR cap is about.
const DISCIPLINES = [
  { key: 'run', label: 'Runs', match: (s) => s.type === 'Run' || s.type === 'VirtualRun' },
  { key: 'swim', label: 'Swims', match: (s) => s.type === 'Swim' },
];

function Endurance({ sessions, ceiling }) {
  const [info, setInfo] = useState(false);
  const [all, setAll] = useState(false);
  const [disc, setDisc] = useState('run');
  const discipline = DISCIPLINES.find((d) => d.key === disc);
  const cutoff = localDate(-RECENT_DAYS);
  const mine = (sessions || []).filter(discipline.match);
  const shown = all ? mine : mine.filter((s) => String(s.date).slice(0, 10) >= cutoff);
  const older = mine.length - shown.length;
  const runs = disc === 'run' ? shown : [];
  const swims = disc === 'swim' ? shown : [];

  return (
    <Section
      label="Endurance"
      action={
        <InfoToggle open={info} onClick={() => setInfo((o) => !o)} label="How the endurance charts and rows are read" />
      }
    >
      <div className="flex gap-1.5 mb-3" role="group" aria-label="Discipline — drives the charts and the sessions below">
        {DISCIPLINES.map((d) => (
          <button key={d.key} type="button" onClick={() => setDisc(d.key)} aria-pressed={disc === d.key} className={disc === d.key ? 'chip-solid' : 'chip'}>
            {d.label}
          </button>
        ))}
      </div>

      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <EnduranceTrends discipline={disc} />
      </Suspense>

      <p className="text-[11px] uppercase tracking-wide text-neutral-600 mt-4">
        {discipline.label} · last {all ? '6 weeks' : 'fortnight'}
      </p>
      {/* An empty block, not a vanished one: no sessions in the window is itself the
          finding, and a block that silently disappears reads as a bug rather than a
          fact. */}
      {!mine.length ? (
        <p className="text-sm text-neutral-400">No {discipline.label.toLowerCase()} in the last six weeks.</p>
      ) : !shown.length ? (
        <p className="text-sm text-neutral-400">Nothing in the last fortnight.</p>
      ) : null}

      {info && (
        <div className="text-[11px] text-neutral-400 space-y-1.5 mb-2">
          <p>
            An easy run should sit near zero minutes over {ceiling} bpm. “spm run” is cadence over
            the running samples only — walk breaks excluded; “spm session” is the old blended
            average on pre-stream history. HRR is beats recovered in the minute after the
            session’s peak — higher is fitter. Drift is aerobic decoupling: how much more heart
            the second half cost than the first (strides excluded) — under 5% is a built base,
            and a fast first kilometre inflates it.
          </p>
          <p>
            Swims: minutes are the dose; distance per stroke is the economy. A slower pace with
            more minutes is a better session, not a worse one.
          </p>
        </div>
      )}

      {runs.length > 0 && (
        <>
          <div className="divide-y divide-neutral-800">
            {runs.map((r) => {
              const mins = Number(r.minutes_over_hr_ceiling) || 0;
              const overTone = mins <= 3 ? 'text-emerald-400'
                : mins <= 12 ? 'text-amber-400'
                : 'text-red-400';
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
                    {r.average_hr && <span className="text-neutral-400">HR {r.average_hr}</span>}
                    {runCadence != null ? (
                      <span className="text-neutral-400">{runCadence} spm run</span>
                    ) : cadence != null ? (
                      <span className="text-neutral-400">{cadence} spm session</span>
                    ) : null}
                    {/* Detected strides/surges. Two is the floor: one "effort" on an
                        easy run is usually a downhill, six is a stride set, fourteen
                        is a run that never settled. */}
                    {effortCount >= 2 && (
                      <span className="text-neutral-400">{effortCount} efforts</span>
                    )}
                    {r.elevation_m != null && (
                      <span className="text-neutral-400">↑{r.elevation_m}m</span>
                    )}
                    {/* Bpm dropped in the minute after the run's hardest effort. Only
                        present when the file has a clear peak — in practice, stride
                        days. The number to watch rise as the base builds: it moves
                        weeks before pace-at-HR does, so it gets the accent colour the
                        other chips don't. */}
                    {r.hrr != null && (
                      <span className="text-sky-400">HRR {r.hrr}</span>
                    )}
                    {/* Aerobic decoupling. Amber only from 10% — high drift is as often
                        a fast first km as a fitness statement, so it flags, not scolds. */}
                    {r.decoupling_pct != null && (
                      <span className={Number(r.decoupling_pct) >= 10
                        ? 'text-amber-400'
                        : 'text-neutral-400'}>
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
        </>
      )}

      {swims.length > 0 && (
        <>
          <div className="divide-y divide-neutral-800">
            {swims.map((w) => (
              <SessionRow key={w.date + w.name} date={w.date}>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm tabular-nums">
                  {/* Duration first, deliberately. It is the aerobic dose, and the pace
                      beside it will read slower on exactly the sessions that went best. */}
                  <span className="font-medium">{Math.round(w.moving_time / 60)} min</span>
                  <span>{Number(w.distance_m)}m</span>
                  <span className="text-neutral-400">
                    {pacePer100m(w.moving_time, Number(w.distance_m))}/100m
                  </span>
                  {w.stride_m != null && (
                    <span className="text-neutral-400">{w.stride_m} m/stroke</span>
                  )}
                  {/* Wall rest from the stream. On a continuous-block swim this is the
                      honest continuity figure — pace per 100m can hold steady while
                      the rests quietly grow. */}
                  {w.swim_rest_s != null && (
                    <span className="text-neutral-400">
                      rest {Math.floor(w.swim_rest_s / 60)}:{String(w.swim_rest_s % 60).padStart(2, '0')}
                    </span>
                  )}
                </div>
              </SessionRow>
            ))}
          </div>
        </>
      )}

      {older > 0 && (
        <Disclosure
          open={false}
          label={`Earlier · ${older} session${older === 1 ? '' : 's'}`}
          onClick={() => setAll(true)}
          className="mt-1"
        />
      )}
    </Section>
  );
}

// ── Week review ─────────────────────────────────────────────

// First on the page since PR 5: it was the last block on the longest tab, and it is the
// one paragraph here that someone wrote. Headline always visible; the rest on tap.
function WeeklyReview({ entry }) {
  const [open, setOpen] = useState(false);
  if (!entry) return null;
  const a = entry.advice || {};
  return (
    <Section
      label="Week review"
      action={
        <Disclosure
          open={open}
          label={formatDay(entry.for_date, { month: 'short', day: 'numeric' })}
          onClick={() => setOpen((o) => !o)}
        />
      }
    >
      <h3 className="font-semibold tracking-tight text-neutral-200">{a.headline}</h3>
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
                <p className="text-sm text-neutral-300">{text}</p>
              </div>
            ) : null
          )}
          {a.next_week?.length > 0 && (
            <div>
              <p className="section-label">Next week</p>
              <ul className="divide-y divide-neutral-800">
                {a.next_week.map((d, i) => (
                  <li key={i} className="py-1.5">
                    <span className="text-sm font-medium">{d.day}</span>{' '}
                    <span className="text-sm text-neutral-300">{d.focus}</span>
                    {d.detail && (
                      <div className="text-sm text-neutral-400">{d.detail}</div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {a.flags?.length > 0 && (
            <div>
              <p className="section-label text-amber-400">Flags</p>
              <ul className="space-y-0.5">
                {a.flags.map((f, i) => (
                  <li key={i} className="text-sm text-amber-400">· {f}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

export default function Health() {
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

  return (
    <Page>
      <h1 className="text-2xl font-semibold tracking-tight">Health</h1>
      <WeeklyReview entry={coach?.weekly} />
      <Recovery wellness={wellness} isLoading={isLoading} />
      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <Protocol protocol={trends?.protocol} bodyweight={trends?.bodyweight} />
          <Endurance sessions={trends?.endurance} ceiling={trends?.hr_ceiling ?? 153} />
        </>
      )}
    </Page>
  );
}
