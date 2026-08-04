import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { getBodyweight, logBodyweight } from '../api/client';
import { formatDay } from '../utils/format';
import { Skeleton } from './Skeleton';

export default function BodyweightCard() {
  const qc = useQueryClient();
  const [value, setValue] = useState('');
  const { data = [], isLoading } = useQuery({
    queryKey: ['bodyweight'],
    queryFn: () => getBodyweight({ weeks: 26 }),
    staleTime: 5 * 60_000,
  });

  const save = useMutation({
    mutationFn: () => logBodyweight({ weight_kg: Number(value) }),
    onSuccess: () => {
      setValue('');
      qc.invalidateQueries({ queryKey: ['bodyweight'] });
    },
  });

  const latest = data.length ? data[data.length - 1] : null;
  const first = data.length ? data[0] : null;
  const change = latest && first && data.length > 1
    ? Math.round((latest.weight_kg - first.weight_kg) * 10) / 10
    : null;

  const parsed = Number(value);
  const valid = value !== '' && Number.isFinite(parsed) && parsed > 0 && parsed <= 500;

  return (
    <section className="border-t border-neutral-200 dark:border-neutral-800 pt-4">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="section-label">Bodyweight</h2>
        {latest && (
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            {latest.weight_kg}kg
            {change != null && (
              <span className={change > 0 ? 'text-amber-600 dark:text-amber-500' : change < 0 ? 'text-emerald-600 dark:text-emerald-500' : ''}>
                {' '}({change > 0 ? '+' : ''}{change} over {data.length} entries)
              </span>
            )}
          </span>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : data.length > 1 ? (
        <div className="h-24 -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <XAxis dataKey="date" hide />
              <YAxis domain={['dataMin - 1', 'dataMax + 1']} width={34} tick={{ fontSize: 10 }} stroke="currentColor" className="text-neutral-400" />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 6 }}
                labelFormatter={(d) => formatDay(d, { month: 'short', day: 'numeric' })}
                formatter={(v) => [`${v}kg`, 'Weight']}
              />
              <Line type="monotone" dataKey="weight_kg" stroke="#8E51D0" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-sm text-neutral-500 dark:text-neutral-400 py-2">
          {data.length === 1 ? 'One entry so far — log again to see a trend.' : 'No weigh-ins logged yet.'}
        </p>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(); }}
        className="flex gap-2 mt-3"
      >
        <input
          type="number" inputMode="decimal" step="0.1" min="0"
          placeholder="kg"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="input flex-1 py-1.5"
          aria-label="Bodyweight in kilograms"
        />
        <button type="submit" disabled={!valid || save.isPending} className="btn-secondary px-4">
          {save.isPending ? '…' : 'Log'}
        </button>
      </form>
      {save.isError && (
        <p className="text-xs text-red-600 dark:text-red-400 mt-1">Couldn’t save that weigh-in.</p>
      )}
      <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1">
        One entry per day — logging again replaces today’s.
      </p>
    </section>
  );
}
