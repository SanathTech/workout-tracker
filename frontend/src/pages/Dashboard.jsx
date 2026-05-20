import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  getStats, getRecentWorkouts, getActiveProgram, getInProgressWorkout, startWorkout,
} from '../api/client';

function StatCard({ label, value, unit, color = 'blue' }) {
  const colors = {
    blue: 'text-blue-700',
    green: 'text-green-700',
    purple: 'text-purple-700',
    orange: 'text-orange-700',
  };
  return (
    <div className="card flex flex-col gap-1">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-3xl font-bold ${colors[color]}`}>
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
        <p className="font-medium group-hover:text-blue-600 transition-colors">
          {workout.routine_name || 'Workout'}
        </p>
        <p className="text-sm text-gray-500">
          {new Date(workout.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          {workout.exercise_count ? ` · ${workout.exercise_count} exercises` : ''}
          {workout.program_name ? ` · ${workout.program_name}` : ''}
        </p>
      </div>
      {workout.duration_minutes && (
        <span className="badge bg-gray-100 text-gray-600">{workout.duration_minutes} min</span>
      )}
    </Link>
  );
}

function NextWorkoutCard({ program }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const start = useMutation({
    mutationFn: (routineId) => startWorkout({ routine_id: routineId }),
    onSuccess: (w) => {
      qc.invalidateQueries({ queryKey: ['in-progress-workout'] });
      navigate(`/session/${w.id}`);
    },
  });

  const progress = program.progress;
  if (!progress?.next_routine) {
    return (
      <div className="card text-center py-8">
        <p className="text-2xl">🎉</p>
        <p className="font-semibold mt-2">Program complete!</p>
        <p className="text-sm text-gray-500 mt-1">
          {progress?.completed_workouts}/{progress?.total_workouts} workouts done. Start a new program when you're ready.
        </p>
        <Link to="/program" className="btn-primary mt-4 inline-flex">Set up a new program</Link>
      </div>
    );
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-400">Up next</p>
          <h2 className="text-2xl font-bold mt-0.5">{progress.next_routine.name}</h2>
          <p className="text-sm text-gray-500">
            {program.name} · Week {progress.week} of {program.total_weeks}
          </p>
        </div>
        <span className="badge bg-blue-100 text-blue-700">
          {progress.completed_workouts}/{progress.total_workouts} done
        </span>
      </div>

      <div className="text-sm text-gray-500">
        {progress.next_routine.exercises.length} exercises:{' '}
        {progress.next_routine.exercises.slice(0, 4).map((e) => e.exercise_name).join(', ')}
        {progress.next_routine.exercises.length > 4 && '…'}
      </div>

      <button
        onClick={() => start.mutate(progress.next_routine.id)}
        disabled={start.isPending}
        className="btn-primary w-full justify-center py-3"
      >
        {start.isPending ? 'Starting…' : `▶ Start ${progress.next_routine.name}`}
      </button>
    </div>
  );
}

function InProgressCard({ workout }) {
  return (
    <Link to={`/session/${workout.id}`} className="card block hover:shadow-md transition-shadow">
      <p className="text-xs uppercase tracking-wide text-orange-500">In progress</p>
      <h2 className="text-xl font-bold mt-0.5">{workout.routine_name || 'Workout'}</h2>
      <p className="text-sm text-gray-500">
        Started {new Date(workout.created_at).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
        {' · '}tap to continue
      </p>
    </Link>
  );
}

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useQuery({ queryKey: ['stats'], queryFn: getStats });
  const { data: recent, isLoading: recentLoading } = useQuery({ queryKey: ['recent-workouts'], queryFn: getRecentWorkouts });
  const { data: active } = useQuery({ queryKey: ['active-program'], queryFn: getActiveProgram });
  const { data: inProgress } = useQuery({ queryKey: ['in-progress-workout'], queryFn: getInProgressWorkout });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {inProgress && <InProgressCard workout={inProgress} />}

      {!active ? (
        <div className="card text-center py-10">
          <p className="text-4xl mb-2">📋</p>
          <p className="font-semibold">No active program</p>
          <p className="text-sm text-gray-500 mt-1">
            Set up a program (e.g. 12-week split with Upper/Lower routines), then start it to track workouts.
          </p>
          <Link to="/program" className="btn-primary mt-4 inline-flex">Set up a program</Link>
        </div>
      ) : (
        !inProgress && <NextWorkoutCard program={active} />
      )}

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
        <h2 className="text-lg font-semibold mb-2">Recent Workouts</h2>
        {recentLoading ? (
          <p className="text-gray-400 text-sm py-4 text-center">Loading…</p>
        ) : recent?.length === 0 ? (
          <p className="text-gray-400 text-center py-6">No workouts logged yet.</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {recent?.map((w) => <WorkoutRow key={w.id} workout={w} />)}
          </div>
        )}
      </div>
    </div>
  );
}
