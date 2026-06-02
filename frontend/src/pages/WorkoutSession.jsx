import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { getWorkout, updateWorkout, completeWorkout, getLastByExercise } from '../api/client';
import { Skeleton } from '../components/Skeleton';
import ExercisePickerSheet from '../components/ExercisePickerSheet';
import { CloseIcon, ChevronIcon } from '../components/icons';

function formatRest(seconds) {
  if (seconds == null) return '';
  if (seconds < 60) return `${seconds}s`;
  const mins = seconds / 60;
  return Number.isInteger(mins) ? `${mins}m` : `${mins.toFixed(1)}m`;
}

function TargetChip({ children }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-[10px] uppercase tracking-wide font-medium text-neutral-600 dark:text-neutral-400">
      {children}
    </span>
  );
}

function SetRow({ set, previousSet, targetRir, onChange, onRemove }) {
  const prevLabel = previousSet?.weight_kg != null && previousSet?.reps != null
    ? `${previousSet.weight_kg}×${previousSet.reps}`
    : previousSet?.reps != null
      ? `—×${previousSet.reps}`
      : '—';
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-neutral-500 dark:text-neutral-500 w-5 text-center">{set.set_number}</span>
      <span className="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-500 w-12 text-center" title={targetRir != null ? `Target RIR ${targetRir}` : ''}>
        {targetRir != null ? `RIR ${targetRir}` : ''}
      </span>
      <span className="text-[11px] text-neutral-500 dark:text-neutral-500 w-14 truncate" title={prevLabel}>{prevLabel}</span>
      <input
        type="number" inputMode="decimal" min="0" step="0.5"
        placeholder="kg"
        value={set.weight_kg ?? ''}
        onChange={(e) => onChange({ ...set, weight_kg: e.target.value })}
        className="input flex-1 py-1.5"
      />
      <input
        type="number" inputMode="numeric" min="0"
        placeholder="reps"
        value={set.reps ?? ''}
        onChange={(e) => onChange({ ...set, reps: e.target.value })}
        className="input flex-1 py-1.5"
      />
      <button
        onClick={onRemove}
        aria-label="Remove set"
        className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 p-1"
      >
        <CloseIcon />
      </button>
    </div>
  );
}

function ExerciseBlock({ block, workoutId, onOpenPicker, onChange, onRemove }) {
  const { data: previous } = useQuery({
    queryKey: ['last-by-exercise', block.exercise_id, workoutId],
    queryFn: () => getLastByExercise(block.exercise_id, { exclude: workoutId }),
    enabled: !!block.exercise_id,
    staleTime: Infinity,
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
    <div className="card space-y-3">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onOpenPicker}
          className="flex items-center gap-1.5 text-left flex-1 min-w-0 -mx-1 px-1 py-0.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
        >
          <span className="font-semibold text-neutral-900 dark:text-neutral-200 truncate">
            {block.exercise_name || 'Pick an exercise'}
          </span>
          <span className="text-neutral-400 dark:text-neutral-500 shrink-0">
            <ChevronIcon open={false} />
          </span>
        </button>
        <button
          onClick={onRemove}
          aria-label="Remove exercise"
          className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 p-1 shrink-0"
        >
          <CloseIcon />
        </button>
      </div>

      {target && (
        <div className="flex flex-wrap gap-1.5">
          {target.target_sets && <TargetChip>{target.target_sets} sets</TargetChip>}
          {repRange && <TargetChip>{repRange} reps</TargetChip>}
          {target.rest_seconds != null && <TargetChip>{formatRest(target.rest_seconds)} rest</TargetChip>}
        </div>
      )}

      {block.notes && (
        <p className="text-xs text-neutral-500 dark:text-neutral-500 italic">{block.notes}</p>
      )}

      <div className="space-y-2">
        {block.sets.map((s, i) => {
          const targetRir = Array.isArray(target?.target_rir_per_set) ? target.target_rir_per_set[i] : null;
          return (
            <SetRow
              key={i}
              set={s}
              previousSet={prevBySet[s.set_number]}
              targetRir={targetRir ?? null}
              onChange={(u) => updateSet(i, u)}
              onRemove={() => removeSet(i)}
            />
          );
        })}
        <button
          type="button"
          onClick={addSet}
          className="w-full text-center py-2 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200 border border-dashed border-neutral-200 dark:border-neutral-800 rounded hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
        >
          + Add set
        </button>
      </div>
    </div>
  );
}

export default function WorkoutSession() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: workout, isLoading } = useQuery({ queryKey: ['workout', id], queryFn: () => getWorkout(id) });

  const [exercises, setExercises] = useState([]);
  const [notes, setNotes] = useState('');
  const [picker, setPicker] = useState(null); // { mode: 'replace' | 'add', forIndex?: number }

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

  if (isLoading || !workout) return <WorkoutSessionSkeleton />;
  if (workout.status === 'completed') {
    navigate(`/workouts/${id}`, { replace: true });
    return null;
  }

  const buildPayload = () => ({
    notes: notes || null,
    exercises: exercises
      .filter((ex) => ex.exercise_id)
      .map((ex) => ({
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

  const handlePickerSelect = (ex) => {
    if (picker?.mode === 'replace') {
      setExercises((prev) => prev.map((x, j) =>
        j === picker.forIndex
          ? { ...x, exercise_id: ex.id, exercise_name: ex.name, muscle_group: ex.muscle_group }
          : x
      ));
    } else if (picker?.mode === 'add') {
      setExercises((prev) => [...prev, {
        exercise_id: ex.id,
        exercise_name: ex.name,
        muscle_group: ex.muscle_group,
        notes: '',
        target: null,
        sets: [{ set_number: 1, reps: null, weight_kg: null }],
      }]);
    }
  };

  const pickerProps = picker
    ? picker.mode === 'replace'
      ? (() => {
          const ex = exercises[picker.forIndex];
          return {
            title: `Replace ${ex?.exercise_name || 'exercise'}`,
            presetSubstitutes: ex?.target?.substitutes || [],
            currentExerciseId: ex?.exercise_id || null,
          };
        })()
      : { title: 'Add exercise', presetSubstitutes: [], currentExerciseId: null }
    : { title: '', presetSubstitutes: [], currentExerciseId: null };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <button onClick={() => navigate(-1)} className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200">← Back</button>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">{workout.routine_name || 'Workout'}</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-500">
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
            workoutId={id}
            onOpenPicker={() => setPicker({ mode: 'replace', forIndex: i })}
            onChange={(u) => setExercises(exercises.map((x, j) => j === i ? u : x))}
            onRemove={() => setExercises(exercises.filter((_, j) => j !== i))}
          />
        ))}

        <button
          type="button"
          onClick={() => setPicker({ mode: 'add' })}
          className="w-full py-3 text-sm font-medium text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200 border border-dashed border-neutral-200 dark:border-neutral-800 rounded hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
        >
          + Add exercise
        </button>
      </div>

      <div className="card">
        <label className="label">Workout notes</label>
        <textarea
          className="input resize-none"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <div className="h-20" aria-hidden="true" />
      <div className="fixed bottom-0 inset-x-0 z-20 bg-white dark:bg-neutral-950 border-t border-neutral-200 dark:border-neutral-900 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-2xl mx-auto px-4 py-3 flex gap-2">
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

      <ExercisePickerSheet
        open={!!picker}
        onClose={() => setPicker(null)}
        onSelect={handlePickerSelect}
        {...pickerProps}
      />
    </div>
  );
}

function WorkoutSessionSkeleton() {
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-3 w-64" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="card space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-32" />
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
