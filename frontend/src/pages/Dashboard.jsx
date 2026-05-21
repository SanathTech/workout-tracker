import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  getStats, getRecentWorkouts, getActiveProgram, getInProgressWorkout, startWorkout,
} from '../api/client';

function StatCard({ label, value, unit }) {
  return (
    <div className="card">
      <p className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{label}</p>
      <p className="text-2xl font-semibold mt-1 text-neutral-900 dark:text-neutral-100">
        {value ?? '—'}
        {unit && <span className="text-sm font-normal ml-1 text-neutral-500 dark:text-neutral-500">{unit}</span>}
      </p>
    </div>
  );
}

function WorkoutRow({ workout }) {
  return (
    <Link
      to={`/workouts/${workout.id}`}
      className="flex items-center justify-between py-3 group"
    >
      <div>
        <p className="font-medium group-hover:underline text-neutral-900 dark:text-neutral-100">
          {workout.routine_name || 'Workout'}
        </p>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          {new Date(workout.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          {workout.exercise_count ? ` · ${workout.exercise_count} exercises` : ''}
          {workout.program_name ? ` · ${workout.program_name}` : ''}
        </p>
      </div>
      {workout.duration_minutes && (
        <span className="text-xs text-neutral-500 dark:text-neutral-400">{workout.duration_minutes} min</span>
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
      <div className="card">
        <p className="text-xs uppercase tracking-wide text-neutral-500">Program complete</p>
        <p className="text-lg font-semibold mt-1">
          {progress?.completed_workouts}/{progress?.total_workouts} workouts done
        </p>
        <p className="text-sm text-neutral-500 mt-1">Start a new program when you're ready.</p>
        <Link to="/program" className="btn-primary mt-4 inline-flex">New program</Link>
      </div>
    );
  }

  return (
    <div className="card space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Up next</p>
        <h2 className="text-2xl font-semibold mt-1 tracking-tight">{progress.next_routine.name}</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
          {program.name} · Week {progress.week} of {program.total_weeks} · {progress.completed_workouts}/{progress.total_workouts} done
        </p>
      </div>

      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        {progress.next_routine.exercises.length} exercises:{' '}
        {progress.next_routine.exercises.slice(0, 4).map((e) => e.exercise_name).join(', ')}
        {progress.next_routine.exercises.length > 4 && '…'}
      </p>

      <button
        onClick={() => start.mutate(progress.next_routine.id)}
        disabled={start.isPending}
        className="btn-primary w-full justify-center py-3"
      >
        {start.isPending ? 'Starting…' : `Start ${progress.next_routine.name}`}
      </button>
    </div>
  );
}

function InProgressCard({ workout }) {
  return (
    <Link to={`/session/${workout.id}`} className="card block hover:border-neutral-300 dark:hover:border-neutral-700 transition-colors">
      <p className="text-xs uppercase tracking-wide text-neutral-500">In progress</p>
      <p className="text-lg font-semibold mt-1">{workout.routine_name || 'Workout'}</p>
      <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
        Started {new Date(workout.created_at).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })} · tap to continue
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
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {inProgress && <InProgressCard workout={inProgress} />}

      {!active ? (
        <div className="card">
          <p className="font-semibold">No active program</p>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
            Set up a program (e.g. 12-week split with Upper/Lower routines), then start it to track workouts.
          </p>
          <Link to="/program" className="btn-primary mt-4 inline-flex">Set up a program</Link>
        </div>
      ) : (
        !inProgress && <NextWorkoutCard program={active} />
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total workouts" value={statsLoading ? '…' : stats?.total_workouts} />
        <StatCard label="This week" value={statsLoading ? '…' : stats?.workouts_this_week} />
        <StatCard label="Total sets" value={statsLoading ? '…' : stats?.total_sets} />
        <StatCard
          label="Total volume"
          value={statsLoading ? '…' : stats ? Math.round(stats.total_volume_kg).toLocaleString() : '—'}
          unit="kg"
        />
      </div>

      <div className="card">
        <h2 className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mb-2">Recent workouts</h2>
        {recentLoading ? (
          <p className="text-sm text-neutral-500 py-4">Loading…</p>
        ) : recent?.length === 0 ? (
          <p className="text-sm text-neutral-500 py-4">No workouts logged yet.</p>
        ) : (
          <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {recent?.map((w) => <WorkoutRow key={w.id} workout={w} />)}
          </div>
        )}
      </div>
    </div>
  );
}
