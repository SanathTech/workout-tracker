import { useEffect, useState } from 'react';
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

// Day is only offered for the two metrics Garmin samples through the day; the rest are
// one reading each and a "day" of them would be a single point.
const DAY_RANGE = { key: 'day', label: 'Day', days: 1 };
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

// Minutes first, then carried: rounding the remainder alone renders 1h 60m.
const hhmm = (secs) => {
  const mins = Math.round(secs / 60);
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
};

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
  // One reading still draws — as its dot, against the scale and the usual line. Only an
  // empty window has nothing to say.
  if (!present.length) return <p className="text-sm text-neutral-400 py-6">No readings in this window.</p>;

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

  // Consecutive runs, so gaps break the line. A reading with no neighbour is drawn as a
  // dot: dropping it left a sparse window (two scattered weigh-ins) rendering nothing at
  // all, which reads as a broken chart rather than a thin month.
  const runs = [];
  const dots = [];
  let run = [];
  const flush = () => {
    if (run.length > 1) runs.push(run);
    else if (run.length === 1) dots.push(run[0]);
    run = [];
  };
  series.forEach((r, i) => {
    if (r.value == null) { flush(); return; }
    run.push([x(i), y(r.value)]);
  });
  flush();

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
        <polyline
          key={`${pts[0][0]}`}
          points={pts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ')}
          fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round"
        />
      ))}
      {dots.map(([px, py]) => <circle key={px} cx={px.toFixed(1)} cy={py.toFixed(1)} r="1.8" fill={stroke} />)}
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
          <text x={W - pad.r - 1} y={y(goal) + 10} textAnchor="end" fontSize="9" fill="#34d399">goal {fmt(goal, { field, precision })}</text>
        </g>
      )}
      {first && <text x={pad.l} y={H - 4} fontSize="9.5" fill="#737373">{formatDay(first.date, { day: 'numeric', month: 'short' })}</text>}
      {last && <text x={W - pad.r} y={H - 4} textAnchor="end" fontSize="9.5" fill="#737373">{formatDay(last.date, { day: 'numeric', month: 'short' })}</text>}
    </svg>
  );
}

// The shape of one day: battery charging overnight and draining through it, stress
// spiking. The night that ended this morning is shaded, so "I woke at 58" and "it was
// gone by six" are the same glance.
function DayChart({ intraday, stroke, field, precision }) {
  const pts = intraday?.points || [];
  if (!pts.length) return <p className="text-sm text-neutral-400 py-6">No readings for this day yet.</p>;
  if (pts.length < 3) return <p className="text-sm text-neutral-400 py-6">Only {pts.length} reading{pts.length > 1 ? 's' : ''} so far today — the line starts once there are a few.</p>;
  const W = 320;
  const H = 170;
  const pad = { l: 28, r: 6, t: 10, b: 18 };
  const values = pts.map((p) => p[1]);
  const lo = Math.min(0, ...values);
  const hi = Math.max(...values) * 1.08 || 1;
  const x = (m) => pad.l + (m / 1440) * (W - pad.l - pad.r);
  const y = (v) => pad.t + ((hi - v) / (hi - lo)) * (H - pad.t - pad.b);

  // Gaps are the watch off the wrist, not a value of zero.
  const runs = [];
  let run = [];
  // One missing sample is the watch off the wrist, and should read as a gap rather than a
  // line drawn through it — so the tolerance is for jitter in the sampling, not for a
  // missed reading.
  const step = (intraday.step_minutes || 6) * 1.5;
  pts.forEach((p, i) => {
    if (i && p[0] - pts[i - 1][0] > step) { if (run.length > 1) runs.push(run); run = []; }
    run.push(`${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`);
  });
  if (run.length > 1) runs.push(run);

  const { bed, wake } = intraday.night || {};
  // His bed times sit either side of midnight, and the band has to follow. Bed BEFORE
  // midnight (23:14) wraps: the evening at the right-hand end plus midnight-to-wake at
  // the left. Bed AFTER midnight (00:19) is a single band from bed to wake — shading
  // from midnight would colour in the half hour he was still up.
  const bands = [];
  if (bed != null && wake != null) {
    if (bed > wake) { bands.push([0, wake], [bed, 1440]); } else { bands.push([bed, wake]); }
  } else if (wake != null) {
    bands.push([0, wake]);
  } else if (bed != null) {
    bands.push([bed, 1440]);
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Through the day, with the night shaded">
      {bands.map(([a, b]) => (
        <rect key={a} x={x(a)} y={pad.t} width={Math.max(0, x(b) - x(a))} height={H - pad.t - pad.b} fill="#1d4ed8" opacity="0.13" />
      ))}
      {[hi * 0.25, hi * 0.5, hi * 0.75].map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="#262626" strokeWidth="1" />
          <text x={pad.l - 5} y={y(v) + 3.5} textAnchor="end" fontSize="9.5" fill="#737373">{fmt(v, { field, precision })}</text>
        </g>
      ))}
      {runs.map((r) => (
        <polyline key={r[0]} points={r.join(' ')} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {[0, 6, 12, 18, 24].map((h) => (
        <text key={h} x={x(h * 60)} y={H - 4} textAnchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'} fontSize="9.5" fill="#737373">
          {h === 24 ? '24' : String(h).padStart(2, '0')}
        </text>
      ))}
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
  // Metrics don't share a range: Day exists for battery and stress only, and walking from
  // one of those to weight left the page asking for a day of a metric with no chip.
  useEffect(() => { setRange('month'); }, [field]);
  const isDay = range === 'day';
  const days = isDay ? 1 : (RANGES.find((r) => r.key === range) || RANGES[1]).days;
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['metric', field, days, isDay],
    queryFn: () => getMetric(field, isDay ? { days: 1, day: 1 } : { days }),
    staleTime: 5 * 60_000,
  });
  // The Day chip only exists once the server says this metric has a shape; asking for a
  // day of weight would draw one dot.
  const ranges = data?.has_intraday ? [DAY_RANGE, ...RANGES] : RANGES;

  const back = (
    <button type="button" onClick={goBack} className="text-sm text-neutral-400 hover:text-neutral-200 inline-flex items-center min-h-11 md:min-h-0 -ml-1 pl-1 self-start">← Back</button>
  );
  if (isError) {
    const missing = error?.response?.status === 404;
    return (
      <Page>
        {back}
        <p className="text-center text-neutral-400 py-16">
          {missing ? 'That metric isn’t tracked.' : 'Couldn’t load this metric — try again.'}
        </p>
      </Page>
    );
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
              {/* Only when it actually moved: a delta of zero rendered as "−0", coloured
                  as though sitting exactly on the usual were a bad thing. */}
              {delta != null && fmt(Math.abs(delta), data) !== fmt(0, data) && (
                <span className={better ? 'text-emerald-400 ml-1.5' : 'text-amber-400 ml-1.5'}>
                  {delta > 0 ? '+' : '−'}{fmt(Math.abs(delta), data)}
                </span>
              )}
            </p>
          )}
        </div>
      </div>

      <div className="flex gap-1.5" role="group" aria-label="Range">
        {ranges.map((r) => (
          <button key={r.key} type="button" onClick={() => setRange(r.key)} aria-pressed={range === r.key} className={range === r.key ? 'chip-solid flex-1' : 'chip flex-1'}>
            {r.label}
          </button>
        ))}
      </div>

      {isLoading || !data ? (
        <Skeleton className="h-44 w-full" />
      ) : (
        <>
          {isDay ? (
            <>
              <DayChart intraday={data.intraday} stroke={STROKE[field] || '#e5e5e5'} field={field} precision={data.precision} />
              <p className="text-[11px] text-neutral-400">
                {data.intraday
                  ? `${data.intraday.when} · every ${data.intraday.step_minutes} min · the shaded band is the night`
                  : 'No readings for this day yet.'}
              </p>
            </>
          ) : (
          <Chart
            series={data.series}
            stroke={STROKE[field] || '#e5e5e5'}
            mean={data.stats.usual_30d}
            goal={data.weight_goal_kg}
            field={field}
            precision={data.precision}
          />
          )}
          {!isDay && <Stats stats={data.stats} field={field} precision={data.precision} unit={data.unit} />}
          {!isDay && (
            <p className="text-[11px] text-neutral-400">
              {data.stats.tracked} of {data.series.length} days tracked · usual is the last 30 days
            </p>
          )}
          {data.sleep && <SleepBlock sleep={data.sleep} anchorLabel={`${data.sleep.anchor} ±${data.sleep.tolerance_minutes}m`} />}
        </>
      )}
    </Page>
  );
}
