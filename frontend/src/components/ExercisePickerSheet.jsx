import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getExercises } from '../api/client';

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" />
      <line x1="6" y1="18" x2="18" y2="6" strokeLinecap="round" />
    </svg>
  );
}

function groupByMuscle(exercises) {
  return exercises.reduce((acc, ex) => {
    (acc[ex.muscle_group] = acc[ex.muscle_group] || []).push(ex);
    return acc;
  }, {});
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
  const { data: exercises = [] } = useQuery({ queryKey: ['exercises'], queryFn: getExercises });

  useEffect(() => {
    if (!open) return;
    setQuery('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

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

  if (!open) return null;

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
        <div className="flex items-center justify-between px-4 h-12 border-b border-neutral-200 dark:border-neutral-900 shrink-0">
          <h2 className="font-semibold text-neutral-900 dark:text-neutral-200 truncate">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200 p-1"
          >
            <CloseIcon />
          </button>
        </div>

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
          {presetSubstitutes.length > 0 && !query && (
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
            <p className="px-4 py-8 text-center text-sm text-neutral-500 dark:text-neutral-500">No exercises match.</p>
          ) : (
            Object.entries(grouped).map(([group, exs]) => (
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
            ))
          )}
          <div className="h-[env(safe-area-inset-bottom)]" />
        </div>
      </div>
    </div>
  );
}
