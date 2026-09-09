import { useQuery } from '@tanstack/react-query';
import {
  Bar, BarChart, ComposedChart, Area, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { getEndurance } from '../api/client';
import { Skeleton } from './Skeleton';
import { formatDay } from '../util/format';
import { runSeries, runSessions, swimSeries, swimSessions, weeklyTotals } from '../util/endurance';

// The endurance trends (2026-09-09): three small charts per discipline over half a year,
// answering the one question the log list couldn't — is the engine growing. Runs: the
// weekly dose, then pace against heart rate on one plot (the HR cap since August pulled
// both lines; the base is built when pace comes back with HR flat), then drift. Swims:
// the weekly minutes, pace against wall rest (pace slowed exactly as the rests shrank —
// a better session reading as a worse one on pace alone), then metres per stroke.
//
// Every chart is one series plus at most one faint context series, no y-axis labels,
// the latest value stated in the caption. On a phone the axis is noise; the number is
// what he checks. Lazy-imported by Health alongside FitnessChart: same library, same
// reason.

const WEEKS = 26;
const DAYS = WEEKS * 7;

const mmss = (s) => {
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
const day = (d) => formatDay(d, { month: 'short', day: 'numeric' });
const tooltipDay = (d) => formatDay(d, { weekday: 'short', month: 'short', day: 'numeric' });

const tooltipStyle = { fontSize: 12, borderRadius: 8, background: '#171717', border: '1px solid #262626' };
const axisProps = { tick: { fontSize: 10 }, stroke: 'currentColor', className: 'text-neutral-600', minTickGap: 48 };

function Chart({ title, latest, hint, children }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] uppercase tracking-wide text-neutral-600">{title}</p>
        <p className="text-[11px] text-neutral-400 tabular-nums truncate">{latest}</p>
      </div>
      <div className="h-24 -ml-1">
        <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
      </div>
      {hint && <p className="text-[11px] text-neutral-600 mt-0.5">{hint}</p>}
    </div>
  );
}

function Weekly({ rows, dataKey, unit, title, hint }) {
  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  return (
    <Chart
      title={title}
      latest={`this week ${last[dataKey]}${unit} · last ${prev ? prev[dataKey] : 0}${unit}`}
      hint={hint}
    >
      <BarChart data={rows} margin={{ top: 4, right: 4, left: 4, bottom: 0 }} barCategoryGap={2}>
        <XAxis dataKey="week" {...axisProps} tickFormatter={day} />
        <Tooltip
          contentStyle={tooltipStyle} cursor={{ fill: '#262626' }}
          labelFormatter={(w) => `Week of ${day(w)}`}
          formatter={(v, n, p) => [`${v}${unit} · ${p.payload.sessions} session${p.payload.sessions === 1 ? '' : 's'}`, null]}
        />
        <Bar dataKey={dataKey} fill="#34d399" radius={[2, 2, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </Chart>
  );
}

function Runs({ sessions, ceiling }) {
  const points = runSeries(sessions);
  const weeks = weeklyTotals(runSessions(sessions), { weeks: WEEKS });
  const drift = points.filter((p) => p.drift != null);
  const last = points[points.length - 1];
  if (!last) return <p className="text-sm text-neutral-400">No runs over 2 km in the last {WEEKS} weeks.</p>;
  const lastDrift = drift[drift.length - 1];
  return (
    <div className="space-y-3">
      <Weekly rows={weeks} dataKey="km" unit="km" title={`Weekly km · ${WEEKS} weeks`} />
      <Chart
        title="Pace & heart rate"
        latest={<><span className="text-emerald-400">● {mmss(last.pace_s)}/km</span> · <span className="text-amber-400">● HR {last.hr}</span></>}
        hint={`Pace is the running samples only where the stream allows. The base is built when pace comes back with HR held under ${ceiling}.`}
      >
        <ComposedChart data={points} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
          <XAxis dataKey="date" {...axisProps} tickFormatter={day} />
          {/* Two hidden axes: pace and bpm share nothing but the date. Pace is
              reversed so up means faster — the direction he wants the line to go. */}
          <YAxis yAxisId="pace" hide reversed domain={['dataMin - 20', 'dataMax + 20']} />
          <YAxis yAxisId="hr" hide domain={['dataMin - 10', 'dataMax + 5']} />
          <Tooltip
            contentStyle={tooltipStyle} labelFormatter={tooltipDay}
            formatter={(v, n) => (n === 'Pace' ? [`${mmss(v)}/km`, n] : [`${v} bpm`, n])}
          />
          <ReferenceLine yAxisId="hr" y={ceiling} stroke="#fbbf24" strokeDasharray="2 4" strokeOpacity={0.5} />
          <Area yAxisId="hr" type="monotone" dataKey="hr" name="HR" stroke="#fbbf24" strokeOpacity={0.5} fill="#fbbf24" fillOpacity={0.08} strokeWidth={1} dot={false} isAnimationActive={false} />
          <Line yAxisId="pace" type="monotone" dataKey="pace_s" name="Pace" stroke="#34d399" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} connectNulls />
        </ComposedChart>
      </Chart>
      {drift.length >= 2 && (
        <Chart
          title="Drift"
          latest={`${lastDrift.drift}% · ${day(lastDrift.date)}`}
          hint="Aerobic decoupling: how much more heart the second half cost. Under 5% is a built base; a fast first km inflates it."
        >
          <ComposedChart data={drift} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <XAxis dataKey="date" {...axisProps} tickFormatter={day} />
            <YAxis hide domain={[0, 'dataMax + 2']} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={tooltipDay} formatter={(v) => [`${v}%`, 'Drift']} />
            <ReferenceLine y={5} stroke="#34d399" strokeDasharray="2 4" strokeOpacity={0.6} />
            <ReferenceLine y={10} stroke="#fbbf24" strokeDasharray="2 4" strokeOpacity={0.6} />
            <Line type="monotone" dataKey="drift" stroke="#a78bfa" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
          </ComposedChart>
        </Chart>
      )}
    </div>
  );
}

function Swims({ sessions }) {
  const points = swimSeries(sessions);
  const weeks = weeklyTotals(swimSessions(sessions), { weeks: WEEKS });
  const last = points[points.length - 1];
  if (!last) return <p className="text-sm text-neutral-400">No swims over 200 m in the last {WEEKS} weeks.</p>;
  const strides = points.filter((p) => p.stride_m != null);
  const lastStride = strides[strides.length - 1];
  return (
    <div className="space-y-3">
      <Weekly rows={weeks} dataKey="minutes" unit=" min" title={`Weekly minutes · ${WEEKS} weeks`} hint="Minutes are the dose. The distance follows." />
      <Chart
        title="Pace & wall rest"
        latest={<><span className="text-emerald-400">● {mmss(last.pace_s)}/100m</span>{last.rest_s != null && <> · <span className="text-amber-400">● rest {mmss(last.rest_s)}</span></>}</>}
        hint="Pace is while moving. It reads slower on exactly the swims where the rests shrank — the continuous block is the better session."
      >
        <ComposedChart data={points} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
          <XAxis dataKey="date" {...axisProps} tickFormatter={day} />
          <YAxis yAxisId="pace" hide reversed domain={['dataMin - 10', 'dataMax + 10']} />
          <YAxis yAxisId="rest" hide domain={[0, 'dataMax + 60']} />
          <Tooltip
            contentStyle={tooltipStyle} labelFormatter={tooltipDay}
            formatter={(v, n) => (n === 'Pace' ? [`${mmss(v)}/100m`, n] : [mmss(v), n])}
          />
          <Bar yAxisId="rest" dataKey="rest_s" name="Rest" fill="#fbbf24" fillOpacity={0.25} isAnimationActive={false} />
          <Line yAxisId="pace" type="monotone" dataKey="pace_s" name="Pace" stroke="#34d399" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} connectNulls />
        </ComposedChart>
      </Chart>
      {strides.length >= 2 && (
        <Chart
          title="Metres per stroke"
          latest={`${lastStride.stride_m.toFixed(2)} m · ${day(lastStride.date)}`}
          hint="Economy. Longer is better; it drops when the stroke shortens to hold pace."
        >
          <ComposedChart data={strides} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <XAxis dataKey="date" {...axisProps} tickFormatter={day} />
            <YAxis hide domain={['dataMin - 0.05', 'dataMax + 0.05']} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={tooltipDay} formatter={(v) => [`${Number(v).toFixed(2)} m`, 'Per stroke']} />
            <Line type="monotone" dataKey="stride_m" stroke="#a78bfa" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
          </ComposedChart>
        </Chart>
      )}
    </div>
  );
}

export default function EnduranceTrends({ discipline }) {
  const { data, isLoading } = useQuery({
    queryKey: ['endurance', DAYS],
    queryFn: () => getEndurance({ days: DAYS }),
    staleTime: 5 * 60_000,
  });
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  const sessions = data?.sessions || [];
  return discipline === 'swim'
    ? <Swims sessions={sessions} />
    : <Runs sessions={sessions} ceiling={data?.hr_ceiling} />;
}
