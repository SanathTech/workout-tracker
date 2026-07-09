import { useState } from 'react';
import { CloseIcon, ChevronIcon } from '../../components/icons';
import ExerciseEditor from './ExerciseEditor';
import { emptyExercise, dashedAddBtn, iconBtn } from './helpers';

export default function RoutineEditor({ routine, allExercises, onChange, onRemove, onMoveUp, onMoveDown }) {
  const [expandedIdx, setExpandedIdx] = useState(() => {
    const i = routine.exercises.findIndex((ex) => !ex.exercise_id);
    return i >= 0 ? i : null;
  });

  const updateExercise = (i, updated) => onChange({
    ...routine,
    exercises: routine.exercises.map((e, j) => j === i ? updated : e),
  });

  const removeExercise = (i) => {
    onChange({
      ...routine,
      exercises: routine.exercises.filter((_, j) => j !== i),
    });
    setExpandedIdx((cur) => {
      if (cur == null) return cur;
      if (cur === i) return null;
      if (cur > i) return cur - 1;
      return cur;
    });
  };

  const addExercise = () => {
    const newIdx = routine.exercises.length;
    onChange({ ...routine, exercises: [...routine.exercises, emptyExercise()] });
    setExpandedIdx(newIdx);
  };

  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2">
        <input
          className="input font-medium"
          value={routine.name}
          placeholder="Routine name (e.g. Upper 1)"
          onChange={(e) => onChange({ ...routine, name: e.target.value })}
        />
        <button
          type="button"
          onClick={onMoveUp}
          disabled={!onMoveUp}
          aria-label="Move routine up"
          className={`${iconBtn} disabled:opacity-30 disabled:hover:text-neutral-400`}
        >
          <ChevronIcon open />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={!onMoveDown}
          aria-label="Move routine down"
          className={`${iconBtn} disabled:opacity-30 disabled:hover:text-neutral-400`}
        >
          <ChevronIcon />
        </button>
        <button type="button" onClick={onRemove} aria-label="Remove routine" className={iconBtn}>
          <CloseIcon />
        </button>
      </div>

      <div>
        {routine.exercises.map((ex, i) => (
          <div key={ex.client_id} className={i > 0 ? 'border-t border-neutral-200 dark:border-neutral-800' : ''}>
            <ExerciseEditor
              ex={ex}
              allExercises={allExercises}
              expanded={expandedIdx === i}
              onToggle={() => setExpandedIdx((cur) => cur === i ? null : i)}
              onChange={(updated) => updateExercise(i, updated)}
              onRemove={() => removeExercise(i)}
            />
          </div>
        ))}
      </div>

      <button type="button" onClick={addExercise} className={dashedAddBtn}>
        + Add exercise
      </button>
    </div>
  );
}
