import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getExercises, getExerciseGroups, deleteExercise } from '../api/client';
import { Skeleton } from '../components/Skeleton';
import CreateExerciseForm from '../components/CreateExerciseForm';

function AddExerciseModal({ onClose }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-800 w-full max-w-md">
        <div className="flex items-center justify-between px-4 pt-4">
          <h2 className="font-semibold">Add exercise</h2>
          <button onClick={onClose} className="btn-ghost px-2" aria-label="Close">×</button>
        </div>
        <CreateExerciseForm showDescription submitLabel="Add" onCancel={onClose} onCreated={onClose} />
      </div>
    </div>
  );
}

// One Delete button per row, right where a thumb rests while scrolling 80 rows, was the
// most dangerous affordance in the app — and a native confirm() is one stray tap from
// accepting. Deleting now takes a deliberate second tap on a control that isn't there
// until you ask for it.
function ExerciseRow({ ex, onDelete }) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return undefined;
    const t = setTimeout(() => setConfirming(false), 5000);
    return () => clearTimeout(t);
  }, [confirming]);

  return (
    <div className="flex items-center gap-2 p-3">
      <div className="flex-1 min-w-0">
        <p className="font-medium">{ex.name}</p>
        {ex.description && <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5 line-clamp-2">{ex.description}</p>}
      </div>
      {confirming ? (
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setConfirming(false)} className="btn-ghost text-xs px-2">Cancel</button>
          <button onClick={onDelete} className="btn-danger text-xs px-2">Delete</button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          aria-label={`More actions for ${ex.name}`}
          className="shrink-0 w-11 h-11 flex items-center justify-center rounded-md text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 dark:hover:text-neutral-200 dark:hover:bg-neutral-900"
        >
          <MoreIcon />
        </button>
      )}
    </div>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
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

  const [deleteError, setDeleteError] = useState('');
  const { mutate: remove } = useMutation({
    mutationFn: deleteExercise,
    onSuccess: () => { setDeleteError(''); qc.invalidateQueries({ queryKey: ['exercises'] }); },
    onError: (err) => setDeleteError(err?.response?.data?.error || 'Could not delete exercise.'),
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

      {/* Sticky: the library is 80-odd rows, and the search you want is at the top of a
          list you've already scrolled away from. `md:top-14` clears the desktop header,
          which is itself sticky — at top-0 this bar parked on top of the nav. */}
      <div className="sticky top-0 md:top-14 z-10 -mx-4 px-4 py-2 bg-white dark:bg-neutral-950 space-y-2">
        <input
          className="input md:max-w-xs h-11"
          placeholder="Search…"
          aria-label="Search exercises"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setFilterGroup('')}
            className={!filterGroup ? 'chip-solid' : 'chip'}
          >
            All
          </button>
          {groups.map((g) => (
            <button
              key={g}
              onClick={() => setFilterGroup(filterGroup === g ? '' : g)}
              className={filterGroup === g ? 'chip-solid' : 'chip'}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {deleteError && (
        <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-md px-3 py-2">
          {deleteError}
        </p>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      ) : exercises.length === 0 ? (
        <p className="text-center text-neutral-500 dark:text-neutral-400 py-20 text-sm">No exercises found.</p>
      ) : (
        Object.entries(grouped).map(([group, exs]) => (
          <div key={group} className="space-y-2">
            <div className="flex items-center gap-2">
              <h2 className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{group}</h2>
              <span className="text-xs text-neutral-500 dark:text-neutral-400">{exs.length}</span>
            </div>
            <div className="divide-y divide-neutral-200 dark:divide-neutral-800 border border-neutral-200 dark:border-neutral-800 rounded-md">
              {exs.map((ex) => (
                <ExerciseRow key={ex.id} ex={ex} onDelete={() => remove(ex.id)} />
              ))}
            </div>
          </div>
        ))
      )}

      {showModal && <AddExerciseModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
