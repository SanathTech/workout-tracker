import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getStats, getRecentWorkouts } from '../api/client';

function StatCard({ label, value, unit, color = 'blue' }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-green-50 text-green-700',
    purple: 'bg-purple-50 text-purple-700',
    orange: 'bg-orange-50 text-orange-700',
  };
  return (
    <div className="card flex flex-col gap-1">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-3xl font-bold ${colors[color].split(' ')[1]}`}>
        {value ?? '—'}
        {unit && <span className="text-lg font-normal ml-1 text-gray-500">{unit}</span>}
      </p>
    </div>
  );
}

function WorkoutRow({ workout }) {
  return (
    <Link
      to={`/workouts/${workout.id}`}
      className="flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 transition-colors group"
    >
      <div>
        <p className="font-medium group-hover:text-blue-600 transition-colors">{workout.name}</p>
        <p className="text-sm text-gray-500">
          {new Date(workout.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          {workout.exercise_count ? ` · ${workout.exercise_count} exercises` : ''}
          {workout.plan_name ? ` · ${workout.plan_name}` : ''}
        </p>
      </div>
      {workout.duration_minutes && (
        <span className="badge bg-gray-100 text-gray-600">{workout.duration_minutes} min</span>
      )}
    </Link>
  );
}

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['stats'],
    queryFn: getStats,
  });

  const { data: recent, isLoading: recentLoading } = useQuery({
    queryKey: ['recent-workouts'],
    queryFn: getRecentWorkouts,
  });

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <Link to="/log" className="btn-primary">
          + Log Workout
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Workouts" value={statsLoading ? '…' : stats?.total_workouts} color="blue" />
        <StatCard label="This Week" value={statsLoading ? '…' : stats?.workouts_this_week} color="green" />
        <StatCard label="Total Sets" value={statsLoading ? '…' : stats?.total_sets} color="purple" />
        <StatCard
          label="Total Volume"
          value={statsLoading ? '…' : stats ? Math.round(stats.total_volume_kg).toLocaleString() : '—'}
          unit="kg"
          color="orange"
        />
      </div>

      {/* Recent Workouts */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Recent Workouts</h2>
          <Link to="/log" className="text-sm text-blue-600 hover:underline">
            View all →
          </Link>
        </div>
        {recentLoading ? (
          <p className="text-gray-400 text-sm py-4 text-center">Loading…</p>
        ) : recent?.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <p className="text-4xl mb-2">💪</p>
            <p>No workouts yet. Log your first one!</p>
            <Link to="/log" className="btn-primary mt-4 inline-flex">
              Log Workout
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {recent?.map((w) => <WorkoutRow key={w.id} workout={w} />)}
          </div>
        )}
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { to: '/plans', icon: '📋', title: 'Workout Plans', desc: 'Create and manage templates' },
          { to: '/progress', icon: '📈', title: 'Progress', desc: 'Track your strength over time' },
          { to: '/exercises', icon: '🏋️', title: 'Exercise Library', desc: '35+ exercises by muscle group' },
        ].map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="card hover:shadow-md transition-shadow flex items-center gap-4 no-underline"
          >
            <span className="text-3xl">{item.icon}</span>
            <div>
              <p className="font-semibold">{item.title}</p>
              <p className="text-sm text-gray-500">{item.desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
