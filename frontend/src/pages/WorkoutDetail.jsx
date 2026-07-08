import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getWorkout, deleteWorkout } from '../api/client';
import { Skeleton } from '../components/Skeleton';

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
      qc.invalidateQueries({ queryKey: ['stats'] });
      navigate('/dashboard');
    },
  });

  if (isLoading) return <WorkoutDetailSkeleton />;
  if (!workout) return <p className="text-center text-neutral-500 py-20">Workout not found.</p>;

  const totalVolume = workout.exercises?.reduce(
    (sum, ex) => sum + ex.sets.reduce((s2, set) => s2 + (set.weight_kg || 0) * (set.reps || 0), 0),
    0
  );

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link to="/dashboard" className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">← Back</Link>
          <h1 className="text-2xl font-semibold tracking-tight mt-1">{workout.routine_name || 'Workout'}</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {new Date(workout.date).toLocaleDateString('en-US', {
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
          <button
            onClick={() => { if (confirm('Delete this workout?')) remove(); }}
            className="btn-danger"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Exercises', value: workout.exercises?.length ?? 0 },
          { label: 'Total sets', value: workout.exercises?.reduce((s, ex) => s + ex.sets.length, 0) ?? 0 },
          { label: 'Volume (kg)', value: Math.round(totalVolume).toLocaleString() },
          ...(workout.duration_minutes ? [{ label: 'Duration', value: `${workout.duration_minutes} min` }] : []),
        ].map((s) => (
          <div key={s.label} className="card">
            <p className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{s.label}</p>
            <p className="text-xl font-semibold mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {workout.notes && (
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mb-1">Notes</p>
          <p className="text-sm text-neutral-700 dark:text-neutral-300">{workout.notes}</p>
        </div>
      )}

      <div className="space-y-3">
        {workout.exercises?.map((ex) => (
          <div key={ex.exercise_id} className="card space-y-3">
            <div>
              <h3 className="font-semibold">{ex.exercise_name}</h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">{ex.muscle_group}</p>
            </div>
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
                {ex.sets.map((set) => (
                  <tr key={set.id} className="border-t border-neutral-200 dark:border-neutral-800">
                    <td className="py-2 text-neutral-500">{set.set_number}</td>
                    <td className="py-2">{set.weight_kg != null ? `${set.weight_kg} kg` : '—'}</td>
                    <td className="py-2">{set.reps ?? '—'}</td>
                    <td className="py-2">{set.rir ?? '—'}</td>
                    <td className="py-2 text-right text-neutral-500 dark:text-neutral-400">
                      {set.weight_kg && set.reps ? `${set.weight_kg * set.reps} kg` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
