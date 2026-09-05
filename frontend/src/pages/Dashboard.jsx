import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  getStats, getRecentWorkouts, getActiveProgram, getInProgressWorkout, startWorkout,
  skipUpcomingWorkout,
} from '../api/client';
import { Skeleton } from '../components/Skeleton';
import StatusBadge from '../components/StatusBadge';
import CheckinCard from '../components/CheckinCard';
import WeekPlan from '../components/WeekPlan';
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
        <span className="text-xs text-neutral-500 dark:text-neutral-400 shrink-0 ml-3 whitespace-nowrap tabular-nums">{workout.duration_minutes} min</span>
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
      <section>
        <p className="section-label">Program complete</p>
        <p className="text-lg font-semibold mt-1">
          {progress?.completed_workouts}{progress?.total_workouts ? `/${progress.total_workouts}` : ''} workouts done
          {progress?.skipped_workouts ? ` · ${progress.skipped_workouts} skipped` : ''}
        </p>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">Start a new program when you're ready.</p>
        <Link to="/program" className="btn-primary mt-4 inline-flex">New program</Link>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div>
        <p className="section-label">Up next</p>
        <h2 className="text-2xl font-semibold mt-1 tracking-tight">{progress.next_routine.name}</h2>
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          <span className="tag">Week {progress.week}{program.total_weeks ? ` of ${program.total_weeks}` : ''}</span>
          {progress.total_workouts
            ? <span className="tag">{progress.completed_workouts}/{progress.total_workouts} done</span>
            : <span className="tag">{progress.completed_workouts} done</span>}
          {progress.skipped_workouts > 0 && <span className="tag">{progress.skipped_workouts} skipped</span>}
        </div>
      </div>

      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        {progress.next_routine.exercises.length} exercises:{' '}
        {progress.next_routine.exercises.slice(0, 4).map((e) => e.exercise_name).join(', ')}
        {progress.next_routine.exercises.length > 4 && '…'}
      </p>

      <div className="space-y-2 pt-1">
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
    </section>
  );
}

function confirmSkip(program, progress) {
  const after = program.routines[progress.position_in_cycle % program.routines.length];
  return `Skip ${progress.next_routine.name}? Nothing gets logged${after ? `, and ${after.name} moves up next` : ''}.`;
}

function NextWorkoutSkeleton() {
  return (
    <div className="space-y-4">
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
    <Link
      to={`/session/${workout.id}`}
      className="block -mx-2 px-2 py-2 rounded-lg border-l-2 border-l-emerald-500 pl-3 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
    >
      <p className="section-label text-emerald-700 dark:text-emerald-400">In progress</p>
      <p className="text-lg font-semibold mt-0.5">{workout.routine_name || 'Workout'}</p>
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
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
        <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
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
        <section>
          <p className="font-semibold">No active program</p>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
            Set up a program (e.g. 12-week split with Upper/Lower routines), then start it to track workouts.
          </p>
          <Link to="/program" className="btn-primary mt-4 inline-flex">Set up a program</Link>
        </section>
      ) : (
        !inProgress && <NextWorkoutCard program={active} />
      )}

      {/* Layout consolidation, 2026-09-05. Two weeks of app_events said the nightly visit
          was Home (2.5s) -> Week (4s) -> Trends, scroll to the bottom, check in — three
          taps to reach the one thing done every day. So the check-in and the week live
          here, directly under the session you're about to start. Trends keeps the
          reading; Home keeps the doing. */}
      <CheckinCard />
      <WeekPlan />

      <section className="border-t border-neutral-200 dark:border-neutral-800 pt-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="section-label">Recent workouts</h2>
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
      </section>
    </div>
  );
}
