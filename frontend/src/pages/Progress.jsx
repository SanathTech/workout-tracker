import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { getStats, getVolumeProgress, getExerciseProgress, getPersonalBests, getExercises } from '../api/client';
import { Skeleton } from '../components/Skeleton';
import ExercisePickerSheet from '../components/ExercisePickerSheet';
import { ChevronIcon } from '../components/icons';
import { formatDay, formatKg } from '../utils/format';
import MuscleVolume from '../components/MuscleVolume';
import BodyweightCard from '../components/BodyweightCard';

const ACCENT_LIGHT = '#171717';   // neutral-900
const ACCENT_DARK = '#e5e5e5';    // neutral-200
const GRID_LIGHT = '#e5e5e5';
const GRID_DARK = '#262626';

function useChartTheme() {
  const [dark, setDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setDark(el.classList.contains('dark')));
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return {
    accent: dark ? ACCENT_DARK : ACCENT_LIGHT,
    accentAlt: dark ? '#a3a3a3' : '#737373',
    grid: dark ? GRID_DARK : GRID_LIGHT,
    text: dark ? '#a3a3a3' : '#737373',
  };
}

function StatCard({ label, value, unit, loading }) {
  return (
    <div>
      <p className="section-label">{label}</p>
      {loading ? (
        <Skeleton className="h-7 w-16 mt-2" />
      ) : (
        <p className="text-2xl font-semibold mt-0.5 tabular-nums">
          {value}
          {unit && <span className="text-sm font-normal text-neutral-500 dark:text-neutral-400 ml-1">{unit}</span>}
        </p>
      )}
    </div>
  );
}

export default function Progress() {
  const [weeks, setWeeks] = useState(12);
  const [selectedExerciseId, setSelectedExerciseId] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const theme = useChartTheme();

  const { data: stats, isLoading: statsLoading } = useQuery({ queryKey: ['stats'], queryFn: getStats, staleTime: 10 * 60_000 });
  const { data: volumeData = [], isLoading: volumeLoading } = useQuery({
    queryKey: ['volume-progress', weeks],
    queryFn: () => getVolumeProgress({ weeks }),
  });
  const { data: allExercises = [] } = useQuery({ queryKey: ['exercises'], queryFn: getExercises });
  const { data: exerciseProgress = [], isLoading: exerciseProgressLoading } = useQuery({
    queryKey: ['exercise-progress', selectedExerciseId, weeks],
    queryFn: () => getExerciseProgress(selectedExerciseId, { weeks }),
    enabled: !!selectedExerciseId,
  });
  const { data: pbs = [], isLoading: pbsLoading } = useQuery({ queryKey: ['personal-bests'], queryFn: getPersonalBests });

  const formatDate = (dateStr) => formatDay(dateStr, { month: 'short', day: 'numeric' });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Lifts</h1>
        <select className="input w-40 h-11 py-0" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} aria-label="Time range — drives every card on this page">
          <option value={4}>Last 4 weeks</option>
          <option value={8}>Last 8 weeks</option>
          <option value={12}>Last 12 weeks</option>
          <option value={24}>Last 24 weeks</option>
          <option value={52}>Last 52 weeks</option>
        </select>
      </div>

      <MuscleVolume weeks={Math.min(weeks, 52)} />
      <BodyweightCard />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total workouts" value={stats?.total_workouts} loading={statsLoading} />
        <StatCard label="This week" value={stats?.workouts_this_week} loading={statsLoading} />
        <StatCard label="Total sets" value={stats?.total_sets} loading={statsLoading} />
        <StatCard
          label="Total volume"
          value={stats ? (stats.total_volume_kg < 1000
            ? Math.round(stats.total_volume_kg).toLocaleString()
            : (stats.total_volume_kg / 1000).toLocaleString(undefined, stats.total_volume_kg < 10000
                ? { minimumFractionDigits: 1, maximumFractionDigits: 1 }
                : { maximumFractionDigits: 0 })) : '—'}
          unit={stats ? (stats.total_volume_kg < 1000 ? 'kg' : 't') : ''}
          loading={statsLoading}
        />
      </div>

      <section className="border-t border-neutral-200 dark:border-neutral-800 pt-4">
        <h2 className="section-label mb-4">Weekly training volume (kg)</h2>
        {volumeLoading ? (
          <Skeleton className="h-[240px] w-full" />
        ) : volumeData.length === 0 ? (
          <p className="text-center text-neutral-500 dark:text-neutral-400 py-12 text-sm">Log workouts to see volume trends.</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={volumeData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
              <XAxis dataKey="week_start" tickFormatter={formatDate} tick={{ fontSize: 11, fill: theme.text }} stroke={theme.grid} />
              <YAxis tick={{ fontSize: 11, fill: theme.text }} stroke={theme.grid} />
              <Tooltip
                labelFormatter={formatDate}
                formatter={(v) => [`${Math.round(v).toLocaleString()} kg`, 'Volume']}
                contentStyle={{ background: 'rgba(0,0,0,0.85)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12 }}
              />
              <Bar dataKey="total_volume" fill={theme.accent} radius={[2, 2, 0, 0]} name="Volume (kg)" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>

      <section className="border-t border-neutral-200 dark:border-neutral-800 pt-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="section-label shrink-0">Exercise progress</h2>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-1.5 text-left min-w-0 max-w-[60%] px-3 min-h-11 md:min-h-0 md:py-1.5 rounded border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
          >
            <span className={`flex-1 min-w-0 truncate text-sm ${selectedExerciseId ? 'text-neutral-900 dark:text-neutral-200' : 'text-neutral-500 dark:text-neutral-400'}`}>
              {selectedExerciseId
                ? allExercises.find((e) => String(e.id) === String(selectedExerciseId))?.name || 'Pick an exercise'
                : 'Pick an exercise'}
            </span>
            <span className="text-neutral-400 dark:text-neutral-400 shrink-0"><ChevronIcon /></span>
          </button>
        </div>
        {!selectedExerciseId ? (
          <p className="text-center text-neutral-500 dark:text-neutral-400 py-12 text-sm">Select an exercise to see your progress.</p>
        ) : exerciseProgressLoading ? (
          <Skeleton className="h-[240px] w-full" />
        ) : exerciseProgress.length === 0 ? (
          <p className="text-center text-neutral-500 dark:text-neutral-400 py-12 text-sm">No data for this exercise in the selected period.</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={exerciseProgress} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
              <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 11, fill: theme.text }} stroke={theme.grid} />
              <YAxis yAxisId="left" tick={{ fontSize: 11, fill: theme.text }} stroke={theme.grid} />
              <YAxis yAxisId="rir" orientation="right" width={28} domain={[0, (max) => Math.max(4, Math.ceil(Number.isFinite(max) ? max : 0))]} allowDecimals={false} tick={{ fontSize: 11, fill: theme.text }} stroke={theme.grid} />
              <Tooltip
                labelFormatter={formatDate}
                contentStyle={{ background: 'rgba(0,0,0,0.85)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line yAxisId="left" type="monotone" dataKey="max_weight" stroke={theme.accent} strokeWidth={1.5} dot={{ r: 3 }} name="Max weight (kg)" />
              <Line yAxisId="left" type="monotone" dataKey="total_reps" stroke={theme.accentAlt} strokeWidth={1.5} dot={{ r: 3 }} name="Total reps" />
              <Line yAxisId="rir" type="monotone" dataKey="avg_rir" stroke={theme.accentAlt} strokeDasharray="4 2" strokeWidth={1.5} dot={{ r: 2 }} name="Avg RIR" connectNulls />
            </LineChart>
          </ResponsiveContainer>
        )}
      </section>

      <section className="border-t border-neutral-200 dark:border-neutral-800 pt-4">
        <h2 className="section-label mb-2">Personal bests</h2>
        {pbsLoading ? (
          <div className="space-y-2 py-2">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-7 w-full" />)}
          </div>
        ) : pbs.length === 0 ? (
          <p className="text-center text-neutral-500 dark:text-neutral-400 py-8 text-sm">Log workouts to see your personal bests.</p>
        ) : (
          <>
            {/* Six columns don't fit a phone, and `w-full` meant the overflow container
                never scrolled — it just squashed every cell into a two-line wrap. */}
            <ul className="md:hidden divide-y divide-neutral-200 dark:divide-neutral-800">
              {pbs.map((pb) => (
                <li key={pb.exercise_id} className="py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium truncate">{pb.exercise_name}</span>
                    <span className="font-semibold tabular-nums shrink-0">
                      {pb.best_weight != null ? formatKg(pb.best_weight) : 'BW'} × {pb.reps}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                    {pb.muscle_group}
                    {pb.est_1rm != null && ` · ${formatKg(pb.est_1rm)} e1RM`}
                    {' · '}
                    {formatDay(pb.date, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </li>
              ))}
            </ul>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-800">
                    <th className="pb-2 font-medium">Exercise</th>
                    <th className="pb-2 font-medium">Muscle</th>
                    <th className="pb-2 font-medium">Best</th>
                    <th className="pb-2 font-medium">Reps</th>
                    <th className="pb-2 font-medium">Est. 1RM</th>
                    <th className="pb-2 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {pbs.map((pb) => (
                    <tr key={pb.exercise_id} className="border-t border-neutral-200 dark:border-neutral-800">
                      <td className="py-2 font-medium">{pb.exercise_name}</td>
                      <td className="py-2 text-neutral-500 dark:text-neutral-400">{pb.muscle_group}</td>
                      <td className="py-2 font-semibold">{pb.best_weight != null ? formatKg(pb.best_weight) : 'BW'}</td>
                      <td className="py-2">{pb.reps}</td>
                      <td className="py-2 text-neutral-500 dark:text-neutral-400">{formatKg(pb.est_1rm)}</td>
                      <td className="py-2 text-neutral-500 dark:text-neutral-400">
                        {formatDay(pb.date, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <ExercisePickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(picked) => setSelectedExerciseId(String(picked.id))}
        title="Pick an exercise"
        currentExerciseId={selectedExerciseId ? parseInt(selectedExerciseId) : null}
      />
    </div>
  );
}
