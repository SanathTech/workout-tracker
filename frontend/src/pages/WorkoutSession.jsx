import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { getWorkout, updateWorkout, completeWorkout, getExercises, getLastByExercise } from '../api/client';

function groupByMuscle(exercises) {
  return exercises.reduce((acc, ex) => {
    (acc[ex.muscle_group] = acc[ex.muscle_group] || []).push(ex);
    return acc;
  }, {});
}

function SetRow({ set, previousSet, onChange, onRemove }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-neutral-500 dark:text-neutral-400 w-6 text-center">{set.set_number}</span>
      <div className="flex-1 grid grid-cols-2 gap-2">
        <div>
          <input
            type="number" inputMode="decimal" min="0" step="0.5"
            placeholder="kg"
            value={set.weight_kg ?? ''}
            onChange={(e) => onChange({ ...set, weight_kg: e.target.value })}
            className="input"
          />
          {previousSet?.weight_kg != null && (
            <span className="block text-[10px] text-neutral-500 dark:text-neutral-500 mt-0.5 pl-1">prev {previousSet.weight_kg}kg</span>
          )}
        </div>
        <div>
          <input
            type="number" inputMode="numeric" min="0"
            placeholder="reps"
            value={set.reps ?? ''}
            onChange={(e) => onChange({ ...set, reps: e.target.value })}
            className="input"
          />
          {previousSet?.reps != null && (
            <span className="block text-[10px] text-neutral-500 dark:text-neutral-500 mt-0.5 pl-1">prev {previousSet.reps} reps</span>
          )}
        </div>
      </div>
      <button onClick={onRemove} className="btn-ghost px-2">×</button>
    </div>
  );
}

function ExerciseBlock({ block, allExercises, workoutId, onChange, onRemove }) {
  const [swapping, setSwapping] = useState(false);
  const grouped = useMemo(() => groupByMuscle(allExercises), [allExercises]);

  const { data: previous } = useQuery({
    queryKey: ['last-by-exercise', block.exercise_id, workoutId],
    queryFn: () => getLastByExercise(block.exercise_id, { exclude: workoutId }),
    enabled: !!block.exercise_id,
  });
  const prevBySet = useMemo(() => {
    const m = {};
    for (const s of previous?.sets || []) m[s.set_number] = s;
    return m;
  }, [previous]);

  const target = block.target;
  const repRange = target && (target.rep_range_low || target.rep_range_high)
    ? `${target.rep_range_low || '?'}–${target.rep_range_high || '?'}`
    : null;

  const addSet = () => {
    const nextNum = (block.sets[block.sets.length - 1]?.set_number || 0) + 1;
    onChange({ ...block, sets: [...block.sets, { set_number: nextNum, reps: null, weight_kg: null }] });
  };
  const updateSet = (i, u) => onChange({ ...block, sets: block.sets.map((s, j) => j === i ? u : s) });
  const removeSet = (i) => onChange({
    ...block,
    sets: block.sets.filter((_, j) => j !== i).map((s, j) => ({ ...s, set_number: j + 1 })),
  });

  return (
    <div className="card space-y-4">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          {swapping ? (
            <select
              autoFocus
              className="input"
              value={block.exercise_id}
              onChange={(e) => {
                const newId = parseInt(e.target.value);
                const found = allExercises.find((x) => x.id === newId);
                onChange({ ...block, exercise_id: newId, exercise_name: found?.name, muscle_group: found?.muscle_group });
                setSwapping(false);
              }}
              onBlur={() => setSwapping(false)}
            >
              {Object.entries(grouped).map(([g, exs]) => (
                <optgroup key={g} label={g}>
                  {exs.map((ex) => <option key={ex.id} value={ex.id}>{ex.name}</option>)}
                </optgroup>
              ))}
            </select>
          ) : (
            <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">{block.exercise_name}</h3>
          )}
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            {target?.target_sets && `target ${target.target_sets} sets`}
            {repRange && ` · ${repRange} reps`}
            {target?.target_rir != null && ` · RIR ${target.target_rir}`}
            {target?.rest_seconds && ` · ${target.rest_seconds}s rest`}
          </p>
          {block.notes && <p className="text-xs text-neutral-500 italic mt-1">{block.notes}</p>}
        </div>
        <div className="flex gap-1 shrink-0">
          <button onClick={() => setSwapping((s) => !s)} className="btn-ghost text-xs">Sub</button>
          <button onClick={onRemove} className="btn-ghost text-xs">Remove</button>
        </div>
      </div>

      <div className="space-y-4">
        {block.sets.map((s, i) => (
          <SetRow
            key={i}
            set={s}
            previousSet={prevBySet[s.set_number]}
            onChange={(u) => updateSet(i, u)}
            onRemove={() => removeSet(i)}
          />
        ))}
        <button onClick={addSet} className="btn-secondary w-full justify-center">Add set</button>
      </div>
    </div>
  );
}

export default function WorkoutSession() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: workout, isLoading } = useQuery({ queryKey: ['workout', id], queryFn: () => getWorkout(id) });
  const { data: allExercises = [] } = useQuery({ queryKey: ['exercises'], queryFn: getExercises });

  const [exercises, setExercises] = useState([]);
  const [notes, setNotes] = useState('');
  const [duration, setDuration] = useState('');

  useEffect(() => {
    if (workout) {
      setExercises(workout.exercises.map((e) => ({
        exercise_id: e.exercise_id,
        exercise_name: e.exercise_name,
        muscle_group: e.muscle_group,
        notes: e.notes || '',
        target: e.target,
        sets: e.sets.length ? e.sets : [{ set_number: 1, reps: null, weight_kg: null }],
      })));
      setNotes(workout.notes || '');
      setDuration(workout.duration_minutes || '');
    }
  }, [workout]);

  const saveDraft = useMutation({
    mutationFn: (payload) => updateWorkout(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workout', id] }),
  });

  const finish = useMutation({
    mutationFn: async (payload) => {
      await updateWorkout(id, payload);
      return completeWorkout(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['active-program'] });
      qc.invalidateQueries({ queryKey: ['recent-workouts'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['in-progress-workout'] });
      navigate(`/workouts/${id}`);
    },
  });

  if (isLoading || !workout) return <p className="text-center text-neutral-500 py-20">Loading…</p>;
  if (workout.status === 'completed') {
    navigate(`/workouts/${id}`, { replace: true });
    return null;
  }

  const buildPayload = () => ({
    notes: notes || null,
    duration_minutes: duration ? parseInt(duration) : null,
    exercises: exercises.map((ex) => ({
      exercise_id: ex.exercise_id,
      notes: ex.notes || null,
      sets: ex.sets
        .filter((s) => s.reps !== '' && s.reps != null)
        .map((s) => ({
          set_number: s.set_number,
          reps: parseInt(s.reps),
          weight_kg: s.weight_kg !== '' && s.weight_kg != null ? parseFloat(s.weight_kg) : null,
        })),
    })),
  });

  const addAdHocExercise = (exerciseId) => {
    const ex = allExercises.find((e) => e.id === parseInt(exerciseId));
    if (!ex) return;
    setExercises((prev) => [...prev, {
      exercise_id: ex.id,
      exercise_name: ex.name,
      muscle_group: ex.muscle_group,
      notes: '',
      target: null,
      sets: [{ set_number: 1, reps: null, weight_kg: null }],
    }]);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <button onClick={() => navigate(-1)} className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">← Back</button>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">{workout.routine_name || 'Workout'}</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          {workout.program_name && `${workout.program_name} · `}
          {workout.program_week && `Week ${workout.program_week} · `}
          {new Date(workout.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
        </p>
      </div>

      <div className="space-y-3">
        {exercises.map((ex, i) => (
          <ExerciseBlock
            key={i}
            block={ex}
            allExercises={allExercises}
            workoutId={id}
            onChange={(u) => setExercises(exercises.map((x, j) => j === i ? u : x))}
            onRemove={() => setExercises(exercises.filter((_, j) => j !== i))}
          />
        ))}
      </div>

      <div className="card space-y-2">
        <label className="label">Add ad-hoc exercise</label>
        <select className="input" value="" onChange={(e) => { addAdHocExercise(e.target.value); e.target.value = ''; }}>
          <option value="">Pick an exercise…</option>
          {Object.entries(groupByMuscle(allExercises)).map(([g, exs]) => (
            <optgroup key={g} label={g}>
              {exs.map((ex) => <option key={ex.id} value={ex.id}>{ex.name}</option>)}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="card space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Duration (min)</label>
            <input type="number" min="0" className="input" value={duration} onChange={(e) => setDuration(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Workout notes</label>
          <textarea className="input resize-none" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      <div className="flex gap-2 sticky bottom-2 pt-2 bg-gradient-to-t from-white to-transparent dark:from-neutral-950">
        <button
          onClick={() => saveDraft.mutate(buildPayload())}
          disabled={saveDraft.isPending}
          className="btn-secondary flex-1 justify-center"
        >
          {saveDraft.isPending ? 'Saving…' : 'Save draft'}
        </button>
        <button
          onClick={() => {
            if (confirm('Finish this workout?')) finish.mutate(buildPayload());
          }}
          disabled={finish.isPending}
          className="btn-primary flex-1 justify-center"
        >
          {finish.isPending ? '…' : 'Finish workout'}
        </button>
      </div>
    </div>
  );
}
