import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getExercises, getExerciseGroups, createExercise, deleteExercise } from '../api/client';
import { Skeleton } from '../components/Skeleton';

function AddExerciseModal({ onClose }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [muscle_group, setMuscleGroup] = useState('');
  const [description, setDescription] = useState('');

  const { data: groups = [] } = useQuery({ queryKey: ['exercise-groups'], queryFn: getExerciseGroups });

  const { mutate: save, isPending } = useMutation({
    mutationFn: createExercise,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exercises'] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-800 w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Add exercise</h2>
          <button onClick={onClose} className="btn-ghost px-2">×</button>
        </div>
        <div>
          <label className="label">Exercise name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cable Fly" required />
        </div>
        <div>
          <label className="label">Muscle group</label>
          <div className="flex gap-2">
            <select className="input flex-1" value={muscle_group} onChange={(e) => setMuscleGroup(e.target.value)}>
              <option value="">Select…</option>
              {groups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <input className="input flex-1" placeholder="Or new…" value={muscle_group}
              onChange={(e) => setMuscleGroup(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input resize-none" rows={3} value={description}
            onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
        </div>
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="btn-secondary flex-1 justify-center">Cancel</button>
          <button
            disabled={!name || !muscle_group || isPending}
            onClick={() => save({ name, muscle_group, description })}
            className="btn-primary flex-1 justify-center"
          >
            {isPending ? 'Saving…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ExerciseLibrary() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [filterGroup, setFilterGroup] = useState('');
  const [showModal, setShowModal] = useState(false);

  const { data: groups = [] } = useQuery({ queryKey: ['exercise-groups'], queryFn: getExerciseGroups });
  const { data: exercises = [], isLoading } = useQuery({
    queryKey: ['exercises', { search, muscle_group: filterGroup }],
    queryFn: () => getExercises({ search: search || undefined, muscle_group: filterGroup || undefined }),
  });

  const { mutate: remove } = useMutation({
    mutationFn: deleteExercise,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['exercises'] }),
  });

  const grouped = exercises.reduce((acc, ex) => {
    (acc[ex.muscle_group] = acc[ex.muscle_group] || []).push(ex);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Exercises</h1>
        <button onClick={() => setShowModal(true)} className="btn-primary">Add exercise</button>
      </div>

      <div className="flex gap-3 flex-wrap items-center">
        <input
          className="input max-w-xs"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setFilterGroup('')}
            className={!filterGroup ? 'badge-solid cursor-pointer' : 'badge cursor-pointer'}
          >
            All
          </button>
          {groups.map((g) => (
            <button
              key={g}
              onClick={() => setFilterGroup(filterGroup === g ? '' : g)}
              className={filterGroup === g ? 'badge-solid cursor-pointer' : 'badge cursor-pointer'}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      ) : exercises.length === 0 ? (
        <p className="text-center text-neutral-500 py-20 text-sm">No exercises found.</p>
      ) : (
        Object.entries(grouped).map(([group, exs]) => (
          <div key={group} className="space-y-2">
            <div className="flex items-center gap-2">
              <h2 className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{group}</h2>
              <span className="text-xs text-neutral-500">{exs.length}</span>
            </div>
            <div className="divide-y divide-neutral-200 dark:divide-neutral-800 border border-neutral-200 dark:border-neutral-800 rounded-md">
              {exs.map((ex) => (
                <div key={ex.id} className="flex items-start gap-3 p-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{ex.name}</p>
                    {ex.description && <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5 line-clamp-2">{ex.description}</p>}
                  </div>
                  <button
                    onClick={() => { if (confirm(`Delete "${ex.name}"?`)) remove(ex.id); }}
                    className="btn-ghost text-xs shrink-0"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {showModal && <AddExerciseModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
