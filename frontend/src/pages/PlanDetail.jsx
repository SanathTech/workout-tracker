import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { getPlan } from '../api/client';

const muscleColors = {
  Chest: 'bg-red-100 text-red-700',
  Back: 'bg-blue-100 text-blue-700',
  Shoulders: 'bg-yellow-100 text-yellow-700',
  Legs: 'bg-green-100 text-green-700',
  Arms: 'bg-purple-100 text-purple-700',
  Core: 'bg-orange-100 text-orange-700',
};

export default function PlanDetail() {
  const { id } = useParams();
  const { data: plan, isLoading } = useQuery({
    queryKey: ['plan', id],
    queryFn: () => getPlan(id),
  });

  if (isLoading) return <p className="text-center text-gray-400 py-20">Loading…</p>;
  if (!plan) return <p className="text-center text-gray-400 py-20">Plan not found.</p>;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <Link to="/plans" className="text-sm text-gray-400 hover:text-gray-600">← Plans</Link>
        <h1 className="text-2xl font-bold mt-1">{plan.name}</h1>
        {plan.description && <p className="text-gray-500 mt-1">{plan.description}</p>}
      </div>

      <div className="flex gap-3">
        <Link to="/log" state={{ planId: plan.id }} className="btn-primary">
          💪 Start Workout
        </Link>
      </div>

      <div className="space-y-3">
        <h2 className="font-semibold">Exercises ({plan.exercises?.length ?? 0})</h2>
        {plan.exercises?.map((pe, idx) => (
          <div key={pe.id} className="card flex items-center gap-4">
            <span className="text-2xl font-bold text-gray-200 w-8">{idx + 1}</span>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">{pe.exercise_name}</span>
                <span className={`badge ${muscleColors[pe.muscle_group] || 'bg-gray-100 text-gray-600'}`}>
                  {pe.muscle_group}
                </span>
              </div>
              {(pe.target_sets || pe.target_reps) && (
                <p className="text-sm text-gray-500 mt-0.5">
                  {[pe.target_sets && `${pe.target_sets} sets`, pe.target_reps && `${pe.target_reps} reps`]
                    .filter(Boolean)
                    .join(' × ')}
                </p>
              )}
              {pe.notes && <p className="text-xs text-gray-400 mt-0.5">{pe.notes}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
