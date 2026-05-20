import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getWorkout, deleteWorkout } from '../api/client';

const muscleColors = {
  Chest: 'bg-red-100 text-red-700',
  Back: 'bg-blue-100 text-blue-700',
  Shoulders: 'bg-yellow-100 text-yellow-700',
  Legs: 'bg-green-100 text-green-700',
  Arms: 'bg-purple-100 text-purple-700',
  Core: 'bg-orange-100 text-orange-700',
};

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

  if (isLoading) return <p className="text-center text-gray-400 py-20">Loading…</p>;
  if (!workout) return <p className="text-center text-gray-400 py-20">Workout not found.</p>;

  const totalVolume = workout.exercises?.reduce(
    (sum, ex) => sum + ex.sets.reduce((s2, set) => s2 + (set.weight_kg || 0) * (set.reps || 0), 0),
    0
  );

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link to="/dashboard" className="text-sm text-gray-400 hover:text-gray-600">
            ← Back
          </Link>
          <h1 className="text-2xl font-bold mt-1">{workout.routine_name || 'Workout'}</h1>
          <p className="text-gray-500 text-sm">
            {new Date(workout.date).toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
            {workout.program_name && ` · ${workout.program_name}`}
            {workout.program_week && ` · Week ${workout.program_week}`}
          </p>
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          {workout.status === 'in_progress' && (
            <Link to={`/session/${id}`} className="btn-primary text-sm">Resume</Link>
          )}
          <button
            onClick={() => {
              if (confirm('Delete this workout?')) remove();
            }}
            className="btn-danger text-sm"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Exercises', value: workout.exercises?.length ?? 0 },
          { label: 'Total Sets', value: workout.exercises?.reduce((s, ex) => s + ex.sets.length, 0) ?? 0 },
          { label: 'Volume (kg)', value: Math.round(totalVolume).toLocaleString() },
          ...(workout.duration_minutes ? [{ label: 'Duration', value: `${workout.duration_minutes} min` }] : []),
        ].map((s) => (
          <div key={s.label} className="card text-center py-4">
            <p className="text-2xl font-bold text-blue-600">{s.value}</p>
            <p className="text-xs text-gray-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {workout.notes && (
        <div className="card bg-yellow-50 border-yellow-100">
          <p className="text-sm text-yellow-800">📝 {workout.notes}</p>
        </div>
      )}

      {/* Exercise blocks */}
      <div className="space-y-4">
        {workout.exercises?.map((ex) => (
          <div key={ex.exercise_id} className="card space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-base">{ex.exercise_name}</h3>
              <span className={`badge ${muscleColors[ex.muscle_group] || 'bg-gray-100 text-gray-600'}`}>
                {ex.muscle_group}
              </span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-left">
                  <th className="pb-1 font-medium w-8">Set</th>
                  <th className="pb-1 font-medium">Weight (kg)</th>
                  <th className="pb-1 font-medium">Reps</th>
                  <th className="pb-1 font-medium text-right">Volume</th>
                </tr>
              </thead>
              <tbody>
                {ex.sets.map((set) => (
                  <tr key={set.id} className="border-t border-gray-50">
                    <td className="py-1.5 text-gray-400">{set.set_number}</td>
                    <td className="py-1.5">{set.weight_kg ?? '—'}</td>
                    <td className="py-1.5">{set.reps ?? '—'}</td>
                    <td className="py-1.5 text-right text-gray-500">
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
