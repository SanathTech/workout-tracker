import { useQuery } from '@tanstack/react-query';
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { getLoadHistory } from '../api/client';
import { Skeleton } from './Skeleton';
import { formatDay } from '../utils/format';

// The intervals.icu view, which is the one chart in endurance training worth the space:
// fitness (CTL, a 42-day weighted average of training stress) against fatigue (ATL, the
// same over 7 days). Their difference is form (TSB) — carried in the tooltip rather than
// given a third line, because on a phone a third series is noise and the number he
// actually acts on already sits in the today strip.
//
// This component is imported lazily by the Trends page: it pulls in Recharts, and its
// data query lives here so the download and the fetch happen together, behind the
// numbers above it rather than in front of them.
export default function FitnessChart({ days = 90 }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['load-history', days],
    queryFn: () => getLoadHistory({ days }),
    staleTime: 5 * 60_000,
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (data.length < 2) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Not enough training-load history yet — intervals.icu needs a few days of activities.
      </p>
    );
  }

  const rows = data.map((r) => ({
    date: r.date,
    ctl: Number(r.ctl),
    atl: Number(r.atl),
    tsb: Number(r.tsb),
  }));
  const latest = rows[rows.length - 1];

  return (
    <>
      <div className="h-40 -ml-2">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
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
              width={28}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
              labelFormatter={(d) => formatDay(d, { weekday: 'short', month: 'short', day: 'numeric' })}
              formatter={(value, name) => [value, name]}
            />
            <Area
              type="monotone" dataKey="ctl" name="Fitness"
              stroke="#14b8a6" fill="#14b8a6" fillOpacity={0.15} strokeWidth={2}
              dot={false} isAnimationActive={false}
            />
            <Line
              type="monotone" dataKey="atl" name="Fatigue"
              stroke="#a78bfa" strokeWidth={1.5} dot={false} isAnimationActive={false}
            />
            {/* No series for TSB. Rendering it invisibly to get it into the tooltip
                pulled the shared Y axis down to -10 to accommodate negative form, so
                fitness and fatigue were squashed into the top two-thirds of a chart
                whose empty lower third meant nothing. Form is a single number he acts
                on, and it is already stated twice: the today strip and the line below. */}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1 tabular-nums">
        <span className="text-teal-600 dark:text-teal-400">● Fitness {latest.ctl}</span>
        {' · '}
        <span className="text-violet-500 dark:text-violet-400">● Fatigue {latest.atl}</span>
        {' · '}
        Form {latest.tsb > 0 ? '+' : ''}{latest.tsb}
      </p>
    </>
  );
}
