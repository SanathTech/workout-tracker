import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { getStats, getVolumeProgress, getExerciseProgress, getPersonalBests, getExercises } from '../api/client';

function StatCard({ label, value, unit }) {
  return (
    <div className="card text-center">
      <p className="text-3xl font-bold text-blue-600">
        {value}
        {unit && <span className="text-base font-normal text-gray-400 ml-1">{unit}</span>}
      </p>
      <p className="text-sm text-gray-500 mt-1">{label}</p>
    </div>
  );
}

export default function Progress() {
  const [weeks, setWeeks] = useState(12);
  const [selectedExerciseId, setSelectedExerciseId] = useState('');

  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: getStats });
  const { data: volumeData = [] } = useQuery({
    queryKey: ['volume-progress', weeks],
    queryFn: () => getVolumeProgress({ weeks }),
  });
  const { data: allExercises = [] } = useQuery({ queryKey: ['exercises'], queryFn: getExercises });
  const { data: exerciseProgress = [] } = useQuery({
    queryKey: ['exercise-progress', selectedExerciseId, weeks],
    queryFn: () => getExerciseProgress(selectedExerciseId, { weeks }),
    enabled: !!selectedExerciseId,
  });
  const { data: pbs = [] } = useQuery({ queryKey: ['personal-bests'], queryFn: getPersonalBests });

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Progress</h1>
        <select
          className="input w-40"
          value={weeks}
          onChange={(e) => setWeeks(Number(e.target.value))}
        >
          <option value={4}>Last 4 weeks</option>
          <option value={8}>Last 8 weeks</option>
          <option value={12}>Last 12 weeks</option>
          <option value={24}>Last 24 weeks</option>
          <option value={52}>Last 52 weeks</option>
        </select>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Workouts" value={stats.total_workouts} />
          <StatCard label="This Week" value={stats.workouts_this_week} />
          <StatCard label="Total Sets" value={stats.total_sets} />
          <StatCard label="Total Volume" value={Math.round(stats.total_volume_kg / 1000).toLocaleString()} unit="t" />
        </div>
      )}

      {/* Weekly Volume Chart */}
      <div className="card">
        <h2 className="font-semibold mb-4">Weekly Training Volume (kg)</h2>
        {volumeData.length === 0 ? (
          <p className="text-center text-gray-400 py-12">Log workouts to see volume trends.</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={volumeData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="week_start" tickFormatter={formatDate} tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip
                labelFormatter={formatDate}
                formatter={(v) => [`${Math.round(v).toLocaleString()} kg`, 'Volume']}
              />
              <Bar dataKey="total_volume" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Volume (kg)" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Exercise Progress Chart */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-semibold">Exercise Progress</h2>
          <select
            className="input w-56"
            value={selectedExerciseId}
            onChange={(e) => setSelectedExerciseId(e.target.value)}
          >
            <option value="">Select an exercise…</option>
            {Object.entries(
              allExercises.reduce((acc, ex) => {
                (acc[ex.muscle_group] = acc[ex.muscle_group] || []).push(ex);
                return acc;
              }, {})
            ).map(([group, exs]) => (
              <optgroup key={group} label={group}>
                {exs.map((ex) => <option key={ex.id} value={ex.id}>{ex.name}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        {!selectedExerciseId ? (
          <p className="text-center text-gray-400 py-12">Select an exercise to see your progress.</p>
        ) : exerciseProgress.length === 0 ? (
          <p className="text-center text-gray-400 py-12">No data for this exercise in the selected period.</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={exerciseProgress} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip labelFormatter={formatDate} />
              <Legend />
              <Line type="monotone" dataKey="max_weight" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} name="Max Weight (kg)" />
              <Line type="monotone" dataKey="total_reps" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} name="Total Reps" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Personal Bests */}
      <div className="card">
        <h2 className="font-semibold mb-4">Personal Bests 🏆</h2>
        {pbs.length === 0 ? (
          <p className="text-center text-gray-400 py-8">Log workouts to see your personal bests.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-100">
                  <th className="pb-2 font-medium">Exercise</th>
                  <th className="pb-2 font-medium">Muscle Group</th>
                  <th className="pb-2 font-medium">Best Weight</th>
                  <th className="pb-2 font-medium">Reps</th>
                  <th className="pb-2 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {pbs.map((pb) => (
                  <tr key={pb.exercise_id} className="border-t border-gray-50">
                    <td className="py-2 font-medium">{pb.exercise_name}</td>
                    <td className="py-2 text-gray-500">{pb.muscle_group}</td>
                    <td className="py-2 text-blue-600 font-semibold">{pb.best_weight} kg</td>
                    <td className="py-2">{pb.reps}</td>
                    <td className="py-2 text-gray-400">
                      {new Date(pb.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
