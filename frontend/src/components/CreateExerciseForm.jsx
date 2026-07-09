import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createExercise } from '../api/client';

const MUSCLE_GROUPS = ['Chest', 'Back', 'Shoulders', 'Legs', 'Arms', 'Core'];

// Shared "create an exercise" form used by both the exercise picker sheet and the
// library's add-exercise modal, so the two stay consistent.
export default function CreateExerciseForm({
  initialName = '',
  showDescription = false,
  submitLabel = 'Save & pick',
  onCancel,
  onCreated,
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(initialName);
  const [group, setGroup] = useState('');
  const [description, setDescription] = useState('');

  const mutation = useMutation({
    mutationFn: () => createExercise({ name: name.trim(), muscle_group: group, description: description.trim() || null }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['exercises'] });
      qc.invalidateQueries({ queryKey: ['exercise-groups'] });
      onCreated?.(created);
    },
  });

  const canSubmit = name.trim().length > 0 && group && !mutation.isPending;
  const submit = () => { if (canSubmit) mutation.mutate(); };

  return (
    <div className="p-4 space-y-4">
      <div>
        <label className="label">Name</label>
        <input
          autoFocus
          type="text"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !showDescription) { e.preventDefault(); submit(); } }}
          placeholder="e.g. Bulgarian Split Squat"
        />
      </div>

      <div>
        <label className="label">Muscle group</label>
        <div className="flex flex-wrap gap-2">
          {MUSCLE_GROUPS.map((g) => {
            const selected = group === g;
            return (
              <button
                key={g}
                type="button"
                aria-pressed={selected}
                onClick={() => setGroup(g)}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  selected
                    ? 'bg-neutral-900 text-white border-neutral-900 dark:bg-neutral-200 dark:text-neutral-900 dark:border-neutral-200'
                    : 'bg-transparent text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-900'
                }`}
              >
                {g}
              </button>
            );
          })}
        </div>
      </div>

      {showDescription && (
        <div>
          <label className="label">Description</label>
          <textarea
            className="input resize-none"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional"
          />
        </div>
      )}

      {mutation.isError && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {mutation.error?.response?.data?.error || 'Could not create exercise.'}
        </p>
      )}

      <button type="button" onClick={submit} disabled={!canSubmit} className="btn-primary w-full justify-center">
        {mutation.isPending ? 'Creating…' : submitLabel}
      </button>
      <button type="button" onClick={() => onCancel?.()} className="btn-ghost w-full justify-center">
        Cancel
      </button>
    </div>
  );
}
