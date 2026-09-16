import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { getMetric } from '../api/client';
import { Skeleton } from '../components/Skeleton';
import { Page, Section } from '../components/ui';
import { useSmartBack } from '../hooks/useSmartBack';
import { formatDay } from '../util/format';

// One number, at the range he asked for (2026-09-16 rethink, PR 3). The old Health rows
// expanded in place at a fixed 90 days: "not very fine grained, not useful if I just want
// to see how its been going today or the last week". Every tile and every row now opens
// its own page instead, and the range is his to choose.

const RANGES = [
  { key: 'week', label: 'Week', days: 7 },
  { key: 'month', label: 'Month', days: 30 },
  { key: '3m', label: '3M', days: 90 },
  { key: 'year', label: 'Year', days: 365 },
];

const STROKE = {
  sleep_score: '#60a5fa',
  sleep_secs: '#60a5fa',
  body_battery_at_wake: '#34d399',
  resting_hr: '#f472b6',
  stress_avg: '#fbbf24',
  steps: '#a78bfa',
  weight_kg: '#fb923c',
};

const hhmm = (secs) => `${Math.floor(secs / 3600)}h ${Math.round((secs % 3600) / 60)}m`;

function fmt(value, { field, precision }) {
  if (value == null) return '—';
  if (field === 'sleep_secs') return hhmm(value);
  if (field === 'steps') return Math.round(value).toLocaleString();
  return precision > 0 ? value.toFixed(precision) : String(Math.round(value));
}

// A line with gaps: an untracked day is a hole, never a straight line between the
// readings either side. Bars would lie the same way at a year's width.
function Chart({ series, stroke, mean, goal, field, precision }) {
  const present = series.filter((r) => r.value != null);
  if (present.length < 2) return <p className="text-sm text-neutral-400 py-6">Not enough readings in this window.</p>;

  const W = 320;
  const H = 170;
  const pad = { l: field === 'steps' ? 34 : 28, r: 6, t: 10, b: 18 };
  const values = present.map((r) => r.value);
  const refs = [mean, goal].filter((v) => v != null);
  const min = Math.min(...values, ...refs);
  const max = Math.max(...values, ...refs);
  const span = max - min || Math.max(1, Math.abs(max) * 0.1);
  const lo = min - span * 0.12;
  const hi = max + span * 0.12;
  const x = (i) => pad.l + (i / (series.length - 1)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + ((hi - v) / (hi - lo)) * (H - pad.t - pad.b);

  // Consecutive runs, so gaps break the line.
  const runs = [];
  let run = [];
  series.forEach((r, i) => {
    if (r.value == null) { if (run.length > 1) runs.push(run); run = []; return; }
    run.push(`${x(i).toFixed(1)},${y(r.value).toFixed(1)}`);
  });
  if (run.length > 1) runs.push(run);

  const ticks = [lo + (hi - lo) * 0.15, (lo + hi) / 2, hi - (hi - lo) * 0.15];
  const first = series.find((r) => r.value != null);
  const last = [...series].reverse().find((r) => r.value != null);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`${series.length} day trend`}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="#262626" strokeWidth="1" />
          <text x={pad.l - 5} y={y(v) + 3.5} textAnchor="end" fontSize="9.5" fill="#737373">{fmt(v, { field, precision })}</text>
        </g>
      ))}
      {mean != null && <line x1={pad.l} x2={W - pad.r} y1={y(mean)} y2={y(mean)} stroke="#e5e5e5" strokeWidth="1" strokeDasharray="4 3" opacity="0.55" />}
      {goal != null && <line x1={pad.l} x2={W - pad.r} y1={y(goal)} y2={y(goal)} stroke="#34d399" strokeWidth="1" strokeDasharray="2 3" opacity="0.8" />}
      {runs.map((pts) => (
        <polyline key={pts[0]} points={pts.join(' ')} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {/* Reference labels last, so the trend line can't draw over them, and backed by a
          plate because the line runs behind them at some ranges. */}
      {mean != null && (
        <g>
          <rect x={W - pad.r - 52} y={y(mean) - 13} width="52" height="11" fill="#0a0a0a" opacity="0.85" rx="2" />
          <text x={W - pad.r - 1} y={y(mean) - 4} textAnchor="end" fontSize="9" fill="#a3a3a3">usual {fmt(mean, { field, precision })}</text>
        </g>
      )}
      {goal != null && (
        <g>
          <rect x={W - pad.r - 46} y={y(goal) + 1} width="46" height="11" fill="#0a0a0a" opacity="0.85" rx="2" />
          <text x={W - pad.r - 1} y={y(goal) + 10} textAnchor="end" fontSize="9" fill="#34d399">goal {goal}</text>
        </g>
      )}
      {first && <text x={pad.l} y={H - 4} fontSize="9.5" fill="#737373">{formatDay(first.date, { day: 'numeric', month: 'short' })}</text>}
      {last && <text x={W - pad.r} y={H - 4} textAnchor="end" fontSize="9.5" fill="#737373">{formatDay(last.date, { day: 'numeric', month: 'short' })}</text>}
    </svg>
  );
}

function Stats({ stats, field, precision, unit }) {
  const cells = [
    ['Average', stats.avg],
    ['Best', stats.best],
    ['Worst', stats.worst],
  ];
  return (
    <div className="grid grid-cols-3 gap-3">
      {cells.map(([label, value]) => (
        <div key={label}>
          <p className="text-[11px] uppercase tracking-wide text-neutral-400">{label}</p>
          <p className="text-lg font-semibold tabular-nums text-neutral-200 leading-tight">
            {fmt(value, { field, precision })}
            {unit && value != null && field !== 'sleep_secs' && <span className="text-xs font-normal text-neutral-400 ml-0.5">{unit}</span>}
          </p>
        </div>
      ))}
    </div>
  );
}

// Sleep's own block: the stages of last night, then how the week's bedtimes sat against
// the anchor — the lever that actually moves the score.
function SleepBlock({ sleep, anchorLabel }) {
  const n = sleep?.last_night;
  if (!n) return null;
  const stages = [
    ['Deep', n.sleep_deep_secs, '#1d4ed8'],
    ['Light', n.sleep_light_secs, '#60a5fa'],
    ['REM', n.sleep_rem_secs, '#a78bfa'],
    ['Awake', n.sleep_awake_secs, '#f87171'],
  ].filter(([, secs]) => secs);
  const within = sleep.nights.filter((x) => x.within_anchor).length;
  return (
    <>
      <Section label="Last night" action={<span className="text-[11px] text-neutral-400">{hhmm(n.sleep_secs)}</span>}>
        {stages.length > 0 && (
          <>
            <div className="flex h-3 rounded-full overflow-hidden gap-0.5" aria-hidden="true">
              {stages.map(([label, secs, colour]) => <span key={label} style={{ flex: secs, background: colour }} />)}
            </div>
            <p className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-neutral-400 tabular-nums mt-1.5">
              {stages.map(([label, secs]) => <span key={label}>{label} {hhmm(secs)}</span>)}
            </p>
          </>
        )}
        {n.bed && <p className="text-xs text-neutral-400 tabular-nums mt-2">Bed {n.bed} · woke {n.wake}</p>}
      </Section>

      <Section label="Bedtime" action={<span className={`text-[11px] ${within ? 'text-emerald-400' : 'text-amber-400'}`}>{within} of {sleep.nights.length} by {anchorLabel}</span>}>
        <div className="grid grid-cols-7 gap-1.5 text-center">
          {[...sleep.nights].reverse().map((x) => (
            <div key={x.date} className="rounded-md bg-neutral-900 py-1.5">
              <p className={`text-[11px] font-semibold tabular-nums ${x.within_anchor ? 'text-emerald-400' : 'text-amber-400'}`}>{x.bed || '—'}</p>
              <p className="text-[10px] text-neutral-400">{formatDay(x.date, { weekday: 'narrow' })}</p>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

export default function Metric() {
  const { field } = useParams();
  const goBack = useSmartBack('/dashboard');
  const [range, setRange] = useState('month');
  const days = RANGES.find((r) => r.key === range).days;
  const { data, isLoading, isError } = useQuery({
    queryKey: ['metric', field, days],
    queryFn: () => getMetric(field, { days }),
    staleTime: 5 * 60_000,
  });

  const back = (
    <button type="button" onClick={goBack} className="text-sm text-neutral-400 hover:text-neutral-200 inline-flex items-center min-h-11 md:min-h-0 -ml-1 pl-1 self-start">← Back</button>
  );
  if (isError) {
    return <Page>{back}<p className="text-center text-neutral-400 py-16">That metric isn’t tracked.</p></Page>;
  }

  const latest = data?.stats?.latest;
  const usual = data?.stats?.usual_30d;
  const delta = latest && usual != null ? latest.value - usual : null;
  const better = delta == null ? null : (delta > 0) === (data.good === 'up');

  return (
    <Page>
      <div>
        {back}
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{data?.label || 'Metric'}</h1>
          {latest && (
            <p className="text-sm text-neutral-400 tabular-nums">
              latest <span className="text-neutral-200 font-semibold">{fmt(latest.value, data)}</span>
              {delta != null && (
                <span className={better ? 'text-emerald-400 ml-1.5' : 'text-amber-400 ml-1.5'}>
                  {delta > 0 ? '+' : '−'}{fmt(Math.abs(delta), data)}
                </span>
              )}
            </p>
          )}
        </div>
      </div>

      <div className="flex gap-1.5" role="group" aria-label="Range">
        {RANGES.map((r) => (
          <button key={r.key} type="button" onClick={() => setRange(r.key)} aria-pressed={range === r.key} className={range === r.key ? 'chip-solid flex-1' : 'chip flex-1'}>
            {r.label}
          </button>
        ))}
      </div>

      {isLoading || !data ? (
        <Skeleton className="h-44 w-full" />
      ) : (
        <>
          <Chart
            series={data.series}
            stroke={STROKE[field] || '#e5e5e5'}
            mean={data.stats.usual_30d}
            goal={data.weight_goal_kg}
            field={field}
            precision={data.precision}
          />
          <Stats stats={data.stats} field={field} precision={data.precision} unit={data.unit} />
          <p className="text-[11px] text-neutral-400">
            {data.stats.tracked} of {data.series.length} days tracked · usual is the last 30 days
          </p>
          {data.sleep && <SleepBlock sleep={data.sleep} anchorLabel={`${data.sleep.anchor} ±${data.sleep.tolerance_minutes}m`} />}
        </>
      )}
    </Page>
  );
}
