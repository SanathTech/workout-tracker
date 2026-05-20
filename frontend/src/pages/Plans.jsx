import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getPlans, createPlan, deletePlan, getExercises } from '../api/client';

function CreatePlanModal({ onClose }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [planExercises, setPlanExercises] = useState([]);

  const { data: allExercises = [] } = useQuery({ queryKey: ['exercises'], queryFn: getExercises });

  const { mutate: save, isPending } = useMutation({
    mutationFn: createPlan,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plans'] });
      onClose();
    },
  });

  const addExercise = () =>
    setPlanExercises([...planExercises, { exercise_id: '', target_sets: 3, target_reps: 10, notes: '' }]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name) return;
    save({
      name,
      description,
      exercises: planExercises
        .filter((pe) => pe.exercise_id)
        .map((pe) => ({
          exercise_id: parseInt(pe.exercise_id),
          target_sets: parseInt(pe.target_sets) || null,
          target_reps: parseInt(pe.target_reps) || null,
          notes: pe.notes || null,
        })),
    });
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">New Plan</h2>
          <button onClick={onClose} className="btn-ghost">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Plan Name *</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Push Day" required />
          </div>
          <div>
            <label className="label">Description</label>
            <textarea className="input resize-none" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">Exercises</label>
              <button type="button" onClick={addExercise} className="text-sm text-blue-600 hover:underline">+ Add</button>
            </div>
            {planExercises.map((pe, idx) => (
              <div key={idx} className="flex gap-2 mb-2">
                <select
                  className="input flex-1"
                  value={pe.exercise_id}
                  onChange={(e) => setPlanExercises(planExercises.map((p, i) => i === idx ? { ...p, exercise_id: e.target.value } : p))}
                >
                  <option value="">Select…</option>
                  {Object.entries(
                    allExercises.reduce((acc, ex) => {
                      (acc[ex.muscle_group] = acc[ex.muscle_group] || []).push(ex);
                      return acc;
                    }, {})
                  ).map(([group, exs]) => (
                    <optgroup key={group} label={group}>
                      {exs.map((ex) => <option key={ex.id} value={ex.id}>{ex.name}</option>)}
                    </optgroup>
                  ))}
                </select>
                <input type="number" className="input w-16" placeholder="Sets" value={pe.target_sets}
                  onChange={(e) => setPlanExercises(planExercises.map((p, i) => i === idx ? { ...p, target_sets: e.target.value } : p))} />
                <input type="number" className="input w-16" placeholder="Reps" value={pe.target_reps}
                  onChange={(e) => setPlanExercises(planExercises.map((p, i) => i === idx ? { ...p, target_reps: e.target.value } : p))} />
                <button type="button" onClick={() => setPlanExercises(planExercises.filter((_, i) => i !== idx))}
                  className="btn-ghost text-red-400 px-2">✕</button>
              </div>
            ))}
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={isPending || !name} className="btn-primary flex-1">
              {isPending ? 'Saving…' : 'Create Plan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Plans() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);

  const { data: plans = [], isLoading } = useQuery({ queryKey: ['plans'], queryFn: getPlans });

  const { mutate: remove } = useMutation({
    mutationFn: deletePlan,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plans'] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Workout Plans</h1>
        <button onClick={() => setShowModal(true)} className="btn-primary">+ New Plan</button>
      </div>

      {isLoading ? (
        <p className="text-gray-400 text-center py-20">Loading…</p>
      ) : plans.length === 0 ? (
        <div className="card text-center py-16 text-gray-400">
          <p className="text-4xl mb-2">📋</p>
          <p>No plans yet. Create one to speed up logging!</p>
          <button onClick={() => setShowModal(true)} className="btn-primary mt-4">Create Plan</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {plans.map((plan) => (
            <div key={plan.id} className="card hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold text-base truncate">{plan.name}</h2>
                  {plan.description && <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">{plan.description}</p>}
                  <p className="text-xs text-gray-400 mt-2">{plan.exercise_count} exercise{plan.exercise_count !== 1 ? 's' : ''}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Link to={`/plans/${plan.id}`} className="btn-secondary text-xs px-3 py-1.5">View</Link>
                  <button
                    onClick={() => { if (confirm(`Delete "${plan.name}"?`)) remove(plan.id); }}
                    className="btn-ghost text-red-400 px-2 py-1.5 text-xs"
                  >🗑️</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && <CreatePlanModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
