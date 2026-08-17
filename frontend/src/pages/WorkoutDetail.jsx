import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { getWorkout, deleteWorkout, getPersonalBests } from '../api/client';
import { Skeleton } from '../components/Skeleton';
import MainBadge from '../components/MainBadge';
import StatusBadge from '../components/StatusBadge';
import MoreMenu from '../components/MoreMenu';
import SessionFeel from '../components/SessionFeel';
import { useSmartBack } from '../hooks/useSmartBack';
import { formatDay, formatKg } from '../utils/format';

export default function WorkoutDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const goBack = useSmartBack();
  const location = useLocation();
  const justFinished = location.state?.justFinished === true;
  const qc = useQueryClient();

  const { data: workout, isLoading } = useQuery({
    queryKey: ['workout', id],
    queryFn: () => getWorkout(id),
  });

  const { mutate: remove, isPending: removing } = useMutation({
    mutationFn: () => deleteWorkout(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recent-workouts'] });
      qc.invalidateQueries({ queryKey: ['workouts-history'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      // Removing a workout frees its slot, so the next-up routine shifts back —
      // and a program that auto-completed on that session becomes active again.
      qc.invalidateQueries({ queryKey: ['active-program'] });
      qc.invalidateQueries({ queryKey: ['programs'] });
      navigate('/dashboard');
    },
  });

  // PRs set in this workout, derived from the personal-bests list — a best whose date is
  // this workout's day, for an exercise this workout contains, was set here. No new
  // backend surface needed.
  const { data: pbs = [] } = useQuery({
    queryKey: ['personal-bests'],
    queryFn: getPersonalBests,
    enabled: justFinished,
    staleTime: 0,
  });

  if (isLoading) return <WorkoutDetailSkeleton />;
  if (!workout) return <p className="text-center text-neutral-500 dark:text-neutral-400 py-20">Workout not found.</p>;

  const isSkipped = workout.status === 'skipped';
  const isCompleted = workout.status === 'completed';
  const hasExercises = workout.exercises?.length > 0;
  const totalVolume = workout.exercises?.reduce(
    (sum, ex) => sum + ex.sets.reduce((s2, set) => s2 + (set.weight_kg || 0) * (set.reps || 0), 0),
    0
  );

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <button type="button" onClick={goBack} className="text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 inline-flex items-center min-h-11 md:min-h-0 -ml-1 pl-1">← Back</button>
          <h1 className="text-2xl font-semibold tracking-tight mt-1">
            {workout.routine_name || 'Workout'}
            <StatusBadge status={workout.status} className="ml-2 align-middle" />
          </h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {formatDay(workout.date, {
              weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            })}
            {workout.program_name && ` · ${workout.program_name}`}
            {workout.program_week && ` · Week ${workout.program_week}`}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {workout.status === 'in_progress' && (
            <Link to={`/session/${id}`} className="btn-primary">Resume</Link>
          )}
          {workout.status === 'completed' && (
            <Link to={`/session/${id}`} className="btn-secondary">Edit</Link>
          )}
          <MoreMenu
            label="Workout options"
            items={[
              isSkipped
                ? { label: 'Undo skip', confirm: hasExercises ? 'Undo — logged sets go too?' : 'Undo skip — sure?', danger: true, onSelect: () => { if (!removing) remove(); } }
                : { label: 'Delete workout', confirm: 'Delete — sure?', danger: true, onSelect: () => { if (!removing) remove(); } },
            ]}
          />
        </div>
      </div>

      {isSkipped && (
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          You skipped this session. It holds its place in the program sequence but counts toward no stats.
        </p>
      )}

      {justFinished && !isSkipped && (
        <section className="border-l-2 border-l-emerald-500 pl-3 py-1.5">
          <p className="section-label text-emerald-700 dark:text-emerald-400">Workout complete</p>
          {(() => {
            const ids = new Set((workout.exercises || []).map((e) => e.exercise_id));
            const prs = pbs.filter((pb) => pb.date === workout.date && ids.has(pb.exercise_id));
            return prs.length > 0 ? (
              <p className="text-sm mt-0.5">
                {prs.length === 1 ? 'New personal best' : `${prs.length} new personal bests`}:{' '}
                {prs.map((pr) => `${pr.exercise_name} ${formatKg(pr.best_weight)} × ${pr.reps}`).join(', ')}
              </p>
            ) : (
              <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-0.5">Logged and saved. See you next session.</p>
            );
          })()}
        </section>
      )}

      {/* The rating is asked for on Finish now, in a sheet that cannot be scrolled past.
          This is the fallback for a session that was skipped or rated on another device:
          it shows for any completed workout, and flags itself when there is no rating
          yet — the old band rendered only on the just-finished view, so a missed rating
          could never be filled in afterwards. */}
      {isCompleted && !isSkipped && (
        <SessionFeel workoutId={id} workoutNotes={workout.notes} />
      )}

      {hasExercises && !isSkipped && (
        // The four summary numbers as tags — matching the session's meta chips — instead
        // of a grid of stat cards.
        <div className="flex flex-wrap gap-1.5">
          <span className="tag">{workout.exercises.length} exercises</span>
          <span className="tag">{workout.exercises.reduce((s, ex) => s + ex.sets.length, 0)} sets</span>
          <span className="tag">{Math.round(totalVolume).toLocaleString()} kg</span>
          {workout.duration_minutes && <span className="tag">{workout.duration_minutes} min</span>}
        </div>
      )}

      {workout.notes && (
        <section>
          <p className="section-label mb-1">Notes</p>
          <p className="text-sm text-neutral-700 dark:text-neutral-300">{workout.notes}</p>
        </section>
      )}

      <div className="divide-y divide-neutral-200 dark:divide-neutral-800 border-t border-neutral-200 dark:border-neutral-800">
        {workout.exercises?.map((ex) => (
          <section key={ex.exercise_id} className="py-3 space-y-2">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">{ex.exercise_name}</h3>
                {ex.target?.is_main && <MainBadge />}
                <span className="tag ml-auto">{ex.muscle_group}</span>
              </div>
            </div>
            {ex.sets.length === 0 ? (
              // A full table header over zero rows read as a rendering fault. Say it plainly.
              <p className="text-sm text-neutral-500 dark:text-neutral-400">Not logged.</p>
            ) : (
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  <th className="pb-1 font-semibold w-8">Set</th>
                  <th className="pb-1 font-semibold">Weight</th>
                  <th className="pb-1 font-semibold">Reps</th>
                  <th className="pb-1 font-semibold">RIR</th>
                  <th className="pb-1 font-semibold text-right">Vol</th>
                </tr>
              </thead>
              <tbody>
                {ex.sets.map((set) => {
                  // Fall back to the routine's per-set target RIR when none was
                  // logged manually, so older workouts don't show a blank RIR.
                  const targetRir = Array.isArray(ex.target?.target_rir_per_set) ? ex.target.target_rir_per_set : [];
                  const rir = set.rir ?? targetRir[set.set_number - 1] ?? null;
                  return (
                    <tr key={set.id}>
                      <td className="py-1.5 text-xs text-neutral-500 dark:text-neutral-400">{set.set_number}</td>
                      <td className="py-1.5">{formatKg(set.weight_kg)}</td>
                      <td className="py-1.5">{set.reps ?? '—'}</td>
                      <td className="py-1.5">{rir ?? '—'}</td>
                      <td className="py-1.5 text-right text-neutral-500 dark:text-neutral-400">
                        {set.weight_kg && set.reps ? formatKg(set.weight_kg * set.reps) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function WorkoutDetailSkeleton() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-3 w-64" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-12" />
          </div>
        ))}
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </div>
      ))}
    </div>
  );
}
