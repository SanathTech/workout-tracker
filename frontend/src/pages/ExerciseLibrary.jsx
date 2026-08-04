import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getExercises, getExerciseGroups, deleteExercise } from '../api/client';
import { Skeleton } from '../components/Skeleton';
import CreateExerciseForm from '../components/CreateExerciseForm';
import MoreMenu from '../components/MoreMenu';

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

function ExerciseRow({ ex, onDelete }) {
  return (
    <div className="flex items-center gap-2 py-1.5">
      <div className="flex-1 min-w-0">
        <p className="font-medium">{ex.name}</p>
        {ex.description && <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5 line-clamp-2">{ex.description}</p>}
      </div>
      <MoreMenu
        label={`Options for ${ex.name}`}
        items={[{ label: 'Delete exercise', confirm: 'Delete — sure?', danger: true, onSelect: onDelete }]}
      />
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

  const [deleteError, setDeleteError] = useState('');
  const { mutate: remove, isPending: removing } = useMutation({
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
          <section key={group}>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="section-label">{group}</h2>
              <span className="text-xs text-neutral-500 dark:text-neutral-400 tabular-nums">{exs.length}</span>
            </div>
            <div className="divide-y divide-neutral-200 dark:divide-neutral-800 border-t border-neutral-200 dark:border-neutral-800">
              {exs.map((ex) => (
                <ExerciseRow key={ex.id} ex={ex} onDelete={() => { if (!removing) remove(ex.id); }} />
              ))}
            </div>
          </section>
        ))
      )}

      {showModal && <AddExerciseModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
