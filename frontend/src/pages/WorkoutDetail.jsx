import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getWorkout, deleteWorkout } from '../api/client';
import { Skeleton } from '../components/Skeleton';
import MainBadge from '../components/MainBadge';
import StatusBadge from '../components/StatusBadge';
import { formatDay, formatKg } from '../utils/format';

export default function WorkoutDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: workout, isLoading } = useQuery({
    queryKey: ['workout', id],
    queryFn: () => getWorkout(id),
  });

  const { mutate: remove } = useMutation({
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

  if (isLoading) return <WorkoutDetailSkeleton />;
  if (!workout) return <p className="text-center text-neutral-500 dark:text-neutral-400 py-20">Workout not found.</p>;

  const isSkipped = workout.status === 'skipped';
  const hasExercises = workout.exercises?.length > 0;
  const totalVolume = workout.exercises?.reduce(
    (sum, ex) => sum + ex.sets.reduce((s2, set) => s2 + (set.weight_kg || 0) * (set.reps || 0), 0),
    0
  );

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link to="/dashboard" className="text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 inline-flex items-center min-h-11 md:min-h-0 -ml-1 pl-1">← Back</Link>
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
        <div className="flex flex-col gap-2 shrink-0">
          {workout.status === 'in_progress' && (
            <Link to={`/session/${id}`} className="btn-primary">Resume</Link>
          )}
          {workout.status === 'completed' && (
            <Link to={`/session/${id}`} className="btn-secondary">Edit</Link>
          )}
          <button
            onClick={() => {
              const prompt = isSkipped
                ? `Undo this skip? The program sequence moves back to this routine${hasExercises ? ', and anything logged on it is deleted' : ''}.`
                : 'Delete this workout?';
              if (confirm(prompt)) remove();
            }}
            className="btn-danger"
          >
            {isSkipped ? 'Undo skip' : 'Delete'}
          </button>
        </div>
      </div>

      {isSkipped && (
        <div className="card">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            You skipped this session. It holds its place in the program sequence but counts toward no stats.
          </p>
        </div>
      )}

      {hasExercises && !isSkipped && (
        // Two across on a phone: at three, every label wrapped to two lines, and a fourth
        // tile (Duration) left an orphan on its own row.
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Exercises', value: workout.exercises.length },
            { label: 'Total sets', value: workout.exercises.reduce((s, ex) => s + ex.sets.length, 0) },
            { label: 'Volume (kg)', value: Math.round(totalVolume).toLocaleString() },
            ...(workout.duration_minutes ? [{ label: 'Duration', value: `${workout.duration_minutes} min` }] : []),
          ].map((s) => (
            <div key={s.label} className="card">
              <p className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{s.label}</p>
              <p className="text-xl font-semibold mt-1">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {workout.notes && (
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mb-1">Notes</p>
          <p className="text-sm text-neutral-700 dark:text-neutral-300">{workout.notes}</p>
        </div>
      )}

      <div className="space-y-3">
        {workout.exercises?.map((ex) => (
          <div key={ex.exercise_id} className={`card space-y-3 ${ex.target?.is_main ? 'border-l-2 border-l-amber-400 dark:border-l-amber-500/60' : ''}`}>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">{ex.exercise_name}</h3>
                {ex.target?.is_main && <MainBadge />}
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">{ex.muscle_group}</p>
            </div>
            {ex.sets.length === 0 ? (
              // A full table header over zero rows read as a rendering fault. Say it plainly.
              <p className="text-sm text-neutral-500 dark:text-neutral-400">Not logged.</p>
            ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-neutral-500 dark:text-neutral-400 text-left text-xs uppercase tracking-wide">
                  <th className="pb-2 font-medium w-8">Set</th>
                  <th className="pb-2 font-medium">Weight</th>
                  <th className="pb-2 font-medium">Reps</th>
                  <th className="pb-2 font-medium">RIR</th>
                  <th className="pb-2 font-medium text-right">Volume</th>
                </tr>
              </thead>
              <tbody>
                {ex.sets.map((set) => {
                  // Fall back to the routine's per-set target RIR when none was
                  // logged manually, so older workouts don't show a blank RIR.
                  const targetRir = Array.isArray(ex.target?.target_rir_per_set) ? ex.target.target_rir_per_set : [];
                  const rir = set.rir ?? targetRir[set.set_number - 1] ?? null;
                  return (
                    <tr key={set.id} className="border-t border-neutral-200 dark:border-neutral-800">
                      <td className="py-2 text-neutral-500 dark:text-neutral-400">{set.set_number}</td>
                      <td className="py-2">{formatKg(set.weight_kg)}</td>
                      <td className="py-2">{set.reps ?? '—'}</td>
                      <td className="py-2">{rir ?? '—'}</td>
                      <td className="py-2 text-right text-neutral-500 dark:text-neutral-400">
                        {set.weight_kg && set.reps ? formatKg(set.weight_kg * set.reps) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            )}
          </div>
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
          <div key={i} className="card space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-12" />
          </div>
        ))}
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="card space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </div>
      ))}
    </div>
  );
}
