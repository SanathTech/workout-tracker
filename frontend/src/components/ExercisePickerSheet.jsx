import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getExercises } from '../api/client';
import { CloseIcon } from './icons';
import CreateExerciseForm from './CreateExerciseForm';

function groupByMuscle(exercises) {
  return exercises.reduce((acc, ex) => {
    (acc[ex.muscle_group] = acc[ex.muscle_group] || []).push(ex);
    return acc;
  }, {});
}

function BackArrowIcon({ size = 18 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="15 18 9 12 15 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlusIcon({ size = 16 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19" strokeLinecap="round" />
      <line x1="5" y1="12" x2="19" y2="12" strokeLinecap="round" />
    </svg>
  );
}

export default function ExercisePickerSheet({
  open,
  onClose,
  onSelect,
  title,
  presetSubstitutes = [],
  currentExerciseId = null,
}) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('list'); // 'list' | 'create'
  const [createPrefill, setCreatePrefill] = useState('');
  const { data: exercises = [] } = useQuery({ queryKey: ['exercises'], queryFn: getExercises });

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setMode('list');
    setCreatePrefill('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (mode === 'create') setMode('list');
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, mode]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return exercises;
    return exercises.filter((e) => e.name.toLowerCase().includes(q));
  }, [exercises, query]);
  const grouped = useMemo(() => groupByMuscle(filtered), [filtered]);

  const handleSelect = (ex) => {
    if (currentExerciseId && ex.id === currentExerciseId) {
      onClose();
      return;
    }
    onSelect(ex);
    onClose();
  };

  const handleCreated = (created) => {
    onSelect(created);
    onClose();
  };

  const openCreate = (prefill = '') => {
    setCreatePrefill(prefill);
    setMode('create');
  };

  if (!open) return null;

  const inCreate = mode === 'create';

  return (
    <div
      className="fixed inset-0 z-30 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm animate-[fadeIn_120ms_ease-out]"
      onClick={onClose}
    >
      <div
        className="w-full md:max-w-md h-[85vh] h-[85dvh] md:h-auto md:max-h-[80vh] flex flex-col bg-white dark:bg-neutral-950 border-t md:border border-neutral-200 dark:border-neutral-800 rounded-t-xl md:rounded-xl shadow-xl animate-[slideUp_180ms_ease-out] md:animate-[fadeIn_120ms_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-12 border-b border-neutral-200 dark:border-neutral-900 shrink-0 gap-2">
          {inCreate ? (
            <button
              onClick={() => setMode('list')}
              aria-label="Back"
              className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200 p-1 -ml-1 flex items-center gap-1"
            >
              <BackArrowIcon />
              <span className="font-semibold text-neutral-900 dark:text-neutral-200">New exercise</span>
            </button>
          ) : (
            <h2 className="font-semibold text-neutral-900 dark:text-neutral-200 truncate">{title}</h2>
          )}
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200 p-1 shrink-0"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        {inCreate ? (
          <div className="flex-1 overflow-y-auto overscroll-contain">
            <CreateExerciseForm
              initialName={createPrefill}
              onCancel={() => setMode('list')}
              onCreated={handleCreated}
            />
          </div>
        ) : (
          <>
            {/* Search */}
            <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-900 shrink-0">
              <input
                type="text"
                placeholder="Search exercises…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="input"
              />
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              {presetSubstitutes.length > 0 && !query.trim() && (
                <section>
                  <h3 className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wide font-medium text-neutral-500 dark:text-neutral-500">
                    Substitutes
                  </h3>
                  <ul>
                    {presetSubstitutes.map((s) => (
                      <li key={`sub-${s.exercise_id}`}>
                        <button
                          type="button"
                          onClick={() => handleSelect({ id: s.exercise_id, name: s.exercise_name, muscle_group: s.muscle_group })}
                          className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-neutral-100 dark:hover:bg-neutral-900 transition-colors"
                        >
                          <span className="text-neutral-900 dark:text-neutral-200">{s.exercise_name}</span>
                          <span className="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-500">{s.muscle_group}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="border-t border-neutral-200 dark:border-neutral-900 mt-2" />
                </section>
              )}

              {Object.keys(grouped).length === 0 ? (
                <div className="px-4 py-8 space-y-3 text-center">
                  <p className="text-sm text-neutral-500 dark:text-neutral-500">
                    {query.trim() ? `No exercises match "${query.trim()}".` : 'No exercises match.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => openCreate(query.trim())}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-dashed border-neutral-300 dark:border-neutral-700 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-900 transition-colors"
                  >
                    <PlusIcon />
                    {query.trim() ? <>Create &ldquo;{query.trim()}&rdquo;</> : 'Create new exercise'}
                  </button>
                </div>
              ) : (
                <>
                  {Object.entries(grouped).map(([group, exs]) => (
                    <section key={group}>
                      <h3 className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wide font-medium text-neutral-500 dark:text-neutral-500">
                        {group}
                      </h3>
                      <ul>
                        {exs.map((ex) => {
                          const isCurrent = currentExerciseId === ex.id;
                          return (
                            <li key={ex.id}>
                              <button
                                type="button"
                                onClick={() => handleSelect(ex)}
                                className={`w-full text-left px-4 py-3 flex items-center justify-between transition-colors ${
                                  isCurrent
                                    ? 'bg-neutral-100 dark:bg-neutral-900'
                                    : 'hover:bg-neutral-100 dark:hover:bg-neutral-900'
                                }`}
                              >
                                <span className="text-neutral-900 dark:text-neutral-200">{ex.name}</span>
                                {isCurrent && (
                                  <span className="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-500">Current</span>
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  ))}
                  <div className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => openCreate(query.trim())}
                      className="w-full flex items-center justify-center gap-1.5 py-2 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200 border border-dashed border-neutral-200 dark:border-neutral-800 rounded hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
                    >
                      <PlusIcon />
                      Create new exercise
                    </button>
                  </div>
                </>
              )}
              <div className="h-[env(safe-area-inset-bottom)]" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
