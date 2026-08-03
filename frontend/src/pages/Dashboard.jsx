import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  getStats, getRecentWorkouts, getActiveProgram, getInProgressWorkout, startWorkout,
  skipUpcomingWorkout,
} from '../api/client';
import { Skeleton } from '../components/Skeleton';
import StatusBadge from '../components/StatusBadge';
import { formatDay } from '../utils/format';

function WorkoutRow({ workout }) {
  return (
    <Link
      to={`/workouts/${workout.id}`}
      className="flex items-center justify-between py-3 group"
    >
      <div>
        <p className="font-medium group-hover:underline text-neutral-900 dark:text-neutral-100">
          {workout.routine_name || 'Workout'}
          <StatusBadge status={workout.status} className="ml-2" />
        </p>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          {formatDay(workout.date, { weekday: 'short', month: 'short', day: 'numeric' })}
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

function WorkoutRowSkeleton() {
  return (
    <div className="py-3 space-y-1.5">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-3 w-48" />
    </div>
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
  const skip = useMutation({
    mutationFn: (routineId) => skipUpcomingWorkout({ routine_id: routineId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['active-program'] });
      qc.invalidateQueries({ queryKey: ['programs'] });
      qc.invalidateQueries({ queryKey: ['program', program.id] });
      qc.invalidateQueries({ queryKey: ['recent-workouts'] });
      qc.invalidateQueries({ queryKey: ['workouts-history'] });
    },
  });

  const progress = program.progress;
  if (!progress?.next_routine) {
    return (
      <div className="card">
        <p className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Program complete</p>
        <p className="text-lg font-semibold mt-1">
          {progress?.completed_workouts}{progress?.total_workouts ? `/${progress.total_workouts}` : ''} workouts done
          {progress?.skipped_workouts ? ` · ${progress.skipped_workouts} skipped` : ''}
        </p>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">Start a new program when you're ready.</p>
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
          {program.name} · Week {progress.week}{program.total_weeks ? ` of ${program.total_weeks}` : ''}
          {' · '}
          {progress.completed_workouts}{progress.total_workouts ? `/${progress.total_workouts}` : ''} done
          {progress.skipped_workouts ? ` · ${progress.skipped_workouts} skipped` : ''}
        </p>
      </div>

      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        {progress.next_routine.exercises.length} exercises:{' '}
        {progress.next_routine.exercises.slice(0, 4).map((e) => e.exercise_name).join(', ')}
        {progress.next_routine.exercises.length > 4 && '…'}
      </p>

      <div className="space-y-2">
        <button
          onClick={() => start.mutate(progress.next_routine.id)}
          disabled={start.isPending || skip.isPending}
          className="btn-primary w-full justify-center py-3"
        >
          {start.isPending ? 'Starting…' : `Start ${progress.next_routine.name}`}
        </button>
        <button
          onClick={() => { if (confirm(confirmSkip(program, progress))) skip.mutate(progress.next_routine.id); }}
          disabled={start.isPending || skip.isPending}
          className="btn-ghost w-full justify-center"
        >
          {skip.isPending ? 'Skipping…' : 'Skip this workout'}
        </button>
      </div>
      {skip.isError && (
        <p className="text-xs text-red-600 dark:text-red-400">Could not skip this workout. Try again.</p>
      )}
    </div>
  );
}

function confirmSkip(program, progress) {
  const after = program.routines[progress.position_in_cycle % program.routines.length];
  return `Skip ${progress.next_routine.name}? Nothing gets logged${after ? `, and ${after.name} moves up next` : ''}.`;
}

function NextWorkoutSkeleton() {
  return (
    <div className="card space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-3 w-56" />
      </div>
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-11 w-full" />
    </div>
  );
}

function InProgressCard({ workout }) {
  return (
    <Link to={`/session/${workout.id}`} className="card block hover:border-neutral-300 dark:hover:border-neutral-700 transition-colors">
      <p className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">In progress</p>
      <p className="text-lg font-semibold mt-1">{workout.routine_name || 'Workout'}</p>
      <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
        Started {new Date(workout.created_at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })} · tap to continue
      </p>
    </Link>
  );
}

// The manifest's "Start next workout" shortcut lands here with ?start=next. An unfinished
// session wins over starting a new one, and the param is stripped either way so a refresh
// (or the back button) can't start a second workout.
function useStartNextShortcut({ active, inProgress, resolved }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const firedRef = useRef(false);

  useEffect(() => {
    if (params.get('start') !== 'next' || !resolved || firedRef.current) return;
    firedRef.current = true;
    setParams({}, { replace: true });

    if (inProgress) { navigate(`/session/${inProgress.id}`); return; }
    const routineId = active?.progress?.next_routine?.id;
    if (!routineId) return;
    startWorkout({ routine_id: routineId })
      .then((w) => {
        qc.invalidateQueries({ queryKey: ['in-progress-workout'] });
        navigate(`/session/${w.id}`);
      })
      .catch(() => { /* stay on the dashboard; the Start button is right there */ });
  }, [params, resolved, inProgress, active, navigate, qc, setParams]);
}

export default function Dashboard() {
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: getStats, staleTime: 10 * 60_000 });
  const { data: recent, isLoading: recentLoading } = useQuery({ queryKey: ['recent-workouts'], queryFn: getRecentWorkouts, staleTime: 10 * 60_000 });
  const { data: active, isLoading: activeLoading } = useQuery({ queryKey: ['active-program'], queryFn: getActiveProgram });
  const { data: inProgress, isLoading: inProgressLoading } = useQuery({
    queryKey: ['in-progress-workout'],
    queryFn: getInProgressWorkout,
    staleTime: 0,
  });

  const programResolved = !activeLoading;
  useStartNextShortcut({ active, inProgress, resolved: programResolved && !inProgressLoading });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
          {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          {/* The four totals live on Progress; the only one that changes what you do
              today is how many sessions this week already has. */}
          {stats && ` · ${stats.workouts_this_week} ${stats.workouts_this_week === 1 ? 'workout' : 'workouts'} this week`}
        </p>
      </div>

      {inProgress && <InProgressCard workout={inProgress} />}

      {!programResolved || inProgressLoading ? (
        <NextWorkoutSkeleton />
      ) : !active ? (
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

      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Recent workouts</h2>
          {recent?.length > 0 && (
            <Link to="/history" className="text-xs font-medium text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 inline-flex items-center min-h-11 md:min-h-0 pl-3">See all →</Link>
          )}
        </div>
        {recentLoading ? (
          <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
            <WorkoutRowSkeleton />
            <WorkoutRowSkeleton />
            <WorkoutRowSkeleton />
          </div>
        ) : recent?.length === 0 ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400 py-4">No workouts logged yet.</p>
        ) : (
          <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {recent?.map((w) => <WorkoutRow key={w.id} workout={w} />)}
          </div>
        )}
      </div>
    </div>
  );
}
