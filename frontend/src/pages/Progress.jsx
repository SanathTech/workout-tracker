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
import { formatDay } from '../utils/format';
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
    <div className="card">
      <p className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{label}</p>
      {loading ? (
        <Skeleton className="h-7 w-16 mt-2" />
      ) : (
        <p className="text-2xl font-semibold mt-1">
          {value}
          {unit && <span className="text-sm font-normal text-neutral-500 ml-1">{unit}</span>}
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
        <h1 className="text-2xl font-semibold tracking-tight">Progress</h1>
        <select className="input w-40" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
          <option value={4}>Last 4 weeks</option>
          <option value={8}>Last 8 weeks</option>
          <option value={12}>Last 12 weeks</option>
          <option value={24}>Last 24 weeks</option>
          <option value={52}>Last 52 weeks</option>
        </select>
      </div>

      <MuscleVolume />
      <BodyweightCard />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total workouts" value={stats?.total_workouts} loading={statsLoading} />
        <StatCard label="This week" value={stats?.workouts_this_week} loading={statsLoading} />
        <StatCard label="Total sets" value={stats?.total_sets} loading={statsLoading} />
        <StatCard label="Total volume" value={stats ? Math.round(stats.total_volume_kg / 1000).toLocaleString() : '—'} unit="t" loading={statsLoading} />
      </div>

      <div className="card">
        <h2 className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mb-4">Weekly training volume (kg)</h2>
        {volumeLoading ? (
          <Skeleton className="h-[240px] w-full" />
        ) : volumeData.length === 0 ? (
          <p className="text-center text-neutral-500 py-12 text-sm">Log workouts to see volume trends.</p>
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
      </div>

      <div className="card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400 shrink-0">Exercise progress</h2>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-1.5 text-left min-w-0 max-w-[60%] px-3 py-1.5 rounded border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
          >
            <span className={`flex-1 min-w-0 truncate text-sm ${selectedExerciseId ? 'text-neutral-900 dark:text-neutral-200' : 'text-neutral-500 dark:text-neutral-500'}`}>
              {selectedExerciseId
                ? allExercises.find((e) => String(e.id) === String(selectedExerciseId))?.name || 'Pick an exercise'
                : 'Pick an exercise'}
            </span>
            <span className="text-neutral-400 dark:text-neutral-500 shrink-0"><ChevronIcon /></span>
          </button>
        </div>
        {!selectedExerciseId ? (
          <p className="text-center text-neutral-500 py-12 text-sm">Select an exercise to see your progress.</p>
        ) : exerciseProgressLoading ? (
          <Skeleton className="h-[240px] w-full" />
        ) : exerciseProgress.length === 0 ? (
          <p className="text-center text-neutral-500 py-12 text-sm">No data for this exercise in the selected period.</p>
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
      </div>

      <div className="card">
        <h2 className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mb-3">Personal bests</h2>
        {pbsLoading ? (
          <div className="space-y-2 py-2">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-7 w-full" />)}
          </div>
        ) : pbs.length === 0 ? (
          <p className="text-center text-neutral-500 py-8 text-sm">Log workouts to see your personal bests.</p>
        ) : (
          <div className="overflow-x-auto">
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
                    <td className="py-2 font-semibold">{pb.best_weight != null ? `${pb.best_weight} kg` : 'BW'}</td>
                    <td className="py-2">{pb.reps}</td>
                    <td className="py-2 text-neutral-500 dark:text-neutral-400">{pb.est_1rm != null ? `${pb.est_1rm} kg` : '—'}</td>
                    <td className="py-2 text-neutral-500 dark:text-neutral-400">
                      {formatDay(pb.date, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
