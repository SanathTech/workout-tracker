import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getExercises, getPlans, getPlan, createWorkout } from '../api/client';

function SetRow({ set, onChange, onRemove }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-400 w-6 text-center">{set.set_number}</span>
      <input
        type="number"
        min="0"
        placeholder="kg"
        value={set.weight_kg}
        onChange={(e) => onChange({ ...set, weight_kg: e.target.value })}
        className="input w-24"
      />
      <input
        type="number"
        min="1"
        placeholder="reps"
        value={set.reps}
        onChange={(e) => onChange({ ...set, reps: e.target.value })}
        className="input w-24"
      />
      <button onClick={onRemove} className="btn-ghost text-red-400 hover:text-red-600 px-2">
        ✕
      </button>
    </div>
  );
}

function ExerciseBlock({ block, allExercises, onChange, onRemove }) {
  const addSet = () => {
    const nextNum = block.sets.length + 1;
    onChange({ ...block, sets: [...block.sets, { set_number: nextNum, reps: '', weight_kg: '' }] });
  };
  const updateSet = (idx, updated) => {
    const sets = block.sets.map((s, i) => (i === idx ? updated : s));
    onChange({ ...block, sets });
  };
  const removeSet = (idx) => {
    const sets = block.sets
      .filter((_, i) => i !== idx)
      .map((s, i) => ({ ...s, set_number: i + 1 }));
    onChange({ ...block, sets });
  };

  return (
    <div className="border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <select
          value={block.exercise_id}
          onChange={(e) => onChange({ ...block, exercise_id: e.target.value })}
          className="input flex-1"
        >
          <option value="">Select exercise…</option>
          {Object.entries(
            allExercises.reduce((acc, ex) => {
              (acc[ex.muscle_group] = acc[ex.muscle_group] || []).push(ex);
              return acc;
            }, {})
          ).map(([group, exs]) => (
            <optgroup key={group} label={group}>
              {exs.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button onClick={onRemove} className="btn-ghost text-red-400 px-2">
          🗑️
        </button>
      </div>

      <div className="space-y-2">
        <div className="flex gap-2 text-xs text-gray-400 pl-6">
          <span className="w-24">Weight (kg)</span>
          <span className="w-24">Reps</span>
        </div>
        {block.sets.map((set, idx) => (
          <SetRow key={idx} set={set} onChange={(u) => updateSet(idx, u)} onRemove={() => removeSet(idx)} />
        ))}
      </div>
      <button onClick={addSet} className="btn-ghost text-sm text-blue-600">
        + Add set
      </button>
    </div>
  );
}

export default function LogWorkout() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [name, setName] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [duration, setDuration] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [exercises, setExercises] = useState([]);

  const { data: allExercises = [] } = useQuery({ queryKey: ['exercises'], queryFn: getExercises });
  const { data: plans = [] } = useQuery({ queryKey: ['plans'], queryFn: getPlans });

  const { mutate: loadPlan } = useMutation({
    mutationFn: (id) => getPlan(id),
    onSuccess: (plan) => {
      setName(plan.name);
      setExercises(
        plan.exercises.map((pe) => ({
          exercise_id: String(pe.exercise_id),
          sets: Array.from({ length: pe.target_sets || 3 }, (_, i) => ({
            set_number: i + 1,
            reps: pe.target_reps || '',
            weight_kg: '',
          })),
        }))
      );
    },
  });

  const { mutate: save, isPending } = useMutation({
    mutationFn: createWorkout,
    onSuccess: (workout) => {
      qc.invalidateQueries({ queryKey: ['recent-workouts'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      navigate(`/workouts/${workout.id}`);
    },
  });

  const addExercise = () =>
    setExercises([
      ...exercises,
      {
        exercise_id: '',
        sets: [{ set_number: 1, reps: '', weight_kg: '' }],
      },
    ]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name) return alert('Please enter a workout name.');
    if (exercises.some((ex) => !ex.exercise_id)) return alert('Please select an exercise for all blocks.');

    save({
      name,
      date,
      duration_minutes: duration ? parseInt(duration) : null,
      notes: notes || null,
      plan_id: selectedPlanId ? parseInt(selectedPlanId) : null,
      exercises: exercises.map((ex) => ({
        exercise_id: parseInt(ex.exercise_id),
        sets: ex.sets
          .filter((s) => s.reps)
          .map((s) => ({
            set_number: s.set_number,
            reps: parseInt(s.reps),
            weight_kg: s.weight_kg ? parseFloat(s.weight_kg) : null,
          })),
      })),
    });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Log Workout</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Meta */}
        <div className="card space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Workout Name *</label>
              <input
                className="input"
                placeholder="e.g. Push Day"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">Date</label>
              <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label className="label">Duration (min)</label>
              <input
                type="number"
                className="input"
                placeholder="60"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="label">Load from Plan</label>
            <div className="flex gap-2">
              <select
                className="input flex-1"
                value={selectedPlanId}
                onChange={(e) => setSelectedPlanId(e.target.value)}
              >
                <option value="">Select a plan…</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-secondary"
                disabled={!selectedPlanId}
                onClick={() => loadPlan(selectedPlanId)}
              >
                Load
              </button>
            </div>
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea
              className="input resize-none"
              rows={2}
              placeholder="How did it go?"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        {/* Exercises */}
        <div className="space-y-4">
          <h2 className="font-semibold text-lg">Exercises</h2>
          {exercises.map((ex, idx) => (
            <ExerciseBlock
              key={idx}
              block={ex}
              allExercises={allExercises}
              onChange={(updated) => setExercises(exercises.map((e, i) => (i === idx ? updated : e)))}
              onRemove={() => setExercises(exercises.filter((_, i) => i !== idx))}
            />
          ))}
          <button type="button" onClick={addExercise} className="btn-secondary w-full">
            + Add Exercise
          </button>
        </div>

        <button type="submit" disabled={isPending} className="btn-primary w-full justify-center py-3">
          {isPending ? 'Saving…' : '💾 Save Workout'}
        </button>
      </form>
    </div>
  );
}
