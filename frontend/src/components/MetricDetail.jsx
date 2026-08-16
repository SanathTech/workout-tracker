import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts';
import { formatDay } from '../utils/format';

// The expanded view behind a sparkline row: the same series, 90 days instead of 30,
// with axes, a mean line and the range it actually moved through.
//
// It shares the Recharts chunk the fitness chart already pulls in, so opening a row
// costs nothing once that chart has rendered — which it has, since it sits above these.
//
// Nulls are passed through as nulls rather than filtered out. Recharts breaks the line
// at a null with connectNulls off, which is the same rule the sparklines follow: an
// untracked night is a gap, not a straight line between the readings either side.
export default function MetricDetail({ label, data, field, stroke, unit }) {
  const rows = data.map((d) => ({
    date: d.date,
    value: d[field] == null || d[field] === '' ? null : Number(d[field]),
  }));
  const present = rows.map((r) => r.value).filter((v) => v != null && Number.isFinite(v));
  if (present.length < 2) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400 py-2">
        Not enough {label.toLowerCase()} readings yet.
      </p>
    );
  }

  const min = Math.min(...present);
  const max = Math.max(...present);
  const mean = present.reduce((a, b) => a + b, 0) / present.length;
  const fmt = (n) => (field === 'steps' ? Math.round(n).toLocaleString() : Math.round(n));
  const tracked = present.length;

  return (
    <div className="pb-2">
      <div className="h-44 -ml-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="currentColor" className="text-neutral-200 dark:text-neutral-800" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10 }}
              stroke="currentColor"
              className="text-neutral-400 dark:text-neutral-600"
              tickFormatter={(d) => formatDay(d, { month: 'short', day: 'numeric' })}
              minTickGap={40}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              stroke="currentColor"
              className="text-neutral-400 dark:text-neutral-600"
              width={field === 'steps' ? 40 : 28}
              domain={['dataMin - 2', 'dataMax + 2']}
              tickFormatter={fmt}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
              labelFormatter={(d) => formatDay(d, { weekday: 'short', month: 'short', day: 'numeric' })}
              formatter={(v) => [v == null ? 'not tracked' : `${fmt(v)}${unit ? ` ${unit}` : ''}`, label]}
            />
            <ReferenceLine
              y={mean}
              stroke="currentColor"
              className="text-neutral-400 dark:text-neutral-600"
              strokeDasharray="4 4"
            />
            <Area
              type="monotone" dataKey="value" name={label}
              stroke={stroke} fill={stroke} fillOpacity={0.12} strokeWidth={2}
              dot={false} connectNulls={false} isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-1.5">
        <span className="tag">avg {fmt(mean)}</span>
        <span className="tag">low {fmt(min)}</span>
        <span className="tag">high {fmt(max)}</span>
        <span className="tag">{tracked} of {rows.length} days tracked</span>
      </div>
    </div>
  );
}
