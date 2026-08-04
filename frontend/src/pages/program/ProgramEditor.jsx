import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createProgram, updateProgram, getExercises } from '../../api/client';
import { useHideMobileNav } from '../../hooks/useMobileNavVisibility';
import RoutineEditor from './RoutineEditor';
import { emptyRoutine, genId, dashedAddBtn } from './helpers';

export default function ProgramEditor({ initial, onCancel, onSaved }) {
  useHideMobileNav();
  const qc = useQueryClient();
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [totalWeeks, setTotalWeeks] = useState(
    initial?.total_weeks === undefined ? 12 : (initial.total_weeks ?? '')
  );
  const [error, setError] = useState('');
  const [routines, setRoutines] = useState(
    initial?.routines?.length
      ? initial.routines.map((r) => ({
          client_id: genId(),
          name: r.name,
          exercises: r.exercises.map((re) => {
            const sets = re.target_sets ?? 0;
            const incoming = Array.isArray(re.target_rir_per_set) ? re.target_rir_per_set : [];
            const rir = Array.from({ length: sets }, (_, i) => incoming[i] ?? null);
            return {
              client_id: genId(),
              exercise_id: String(re.exercise_id),
              target_sets: re.target_sets,
              rep_range_low: re.rep_range_low,
              rep_range_high: re.rep_range_high,
              target_rir_per_set: rir,
              rest_seconds: re.rest_seconds,
              rest_seconds_high: re.rest_seconds_high ?? null,
              notes: re.notes || '',
              is_main: re.is_main === true,
              // Warm-up sets have no editor UI yet — carry them through unchanged so edits don't drop them.
              warmup_sets_low: re.warmup_sets_low ?? null,
              warmup_sets_high: re.warmup_sets_high ?? null,
              substitutes: (re.substitutes || []).map((s) => ({ exercise_id: String(s.exercise_id) })),
            };
          }),
        }))
      : [emptyRoutine('Upper 1'), emptyRoutine('Lower 1')]
  );

  const { data: allExercises = [] } = useQuery({ queryKey: ['exercises'], queryFn: getExercises });

  const moveRoutine = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= routines.length) return;
    const next = [...routines];
    [next[i], next[j]] = [next[j], next[i]];
    setRoutines(next);
  };

  const save = useMutation({
    mutationFn: (payload) => initial?.id ? updateProgram(initial.id, payload) : createProgram(payload),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['active-program'] });
      qc.invalidateQueries({ queryKey: ['programs'] });
      qc.invalidateQueries({ queryKey: ['program', data.id] });
      onSaved(data);
    },
  });

  const submit = (e) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('Give the program a name.');
    if (!routines.length) return setError('Add at least one routine.');
    const cleaned = routines.map((r) => ({
      name: r.name || 'Untitled',
      exercises: r.exercises
        .filter((ex) => ex.exercise_id)
        .map((ex) => {
          const sets = ex.target_sets && ex.target_sets > 0 ? ex.target_sets : 3;
          const rirSource = Array.isArray(ex.target_rir_per_set) ? ex.target_rir_per_set : [];
          const target_rir_per_set = Array.from({ length: sets }, (_, i) => {
            const n = Number(rirSource[i]);
            return Number.isFinite(n) ? n : null;
          });
          return {
            exercise_id: parseInt(ex.exercise_id),
            target_sets: sets,
            rep_range_low: ex.rep_range_low,
            rep_range_high: ex.rep_range_high,
            target_rir_per_set,
            rest_seconds: ex.rest_seconds,
            rest_seconds_high: ex.rest_seconds_high ?? null,
            notes: ex.notes || null,
            is_main: ex.is_main === true,
            warmup_sets_low: ex.warmup_sets_low ?? null,
            warmup_sets_high: ex.warmup_sets_high ?? null,
            substitutes: ex.substitutes
              .filter((s) => s.exercise_id)
              .map((s) => ({ exercise_id: parseInt(s.exercise_id) })),
          };
        }),
    }));
    let weeks = null;
    if (totalWeeks !== '' && totalWeeks != null) {
      const n = Number(totalWeeks);
      if (!Number.isInteger(n) || n < 1) {
        return setError('Total weeks must be a whole number ≥ 1, or blank for ongoing.');
      }
      weeks = n;
    }
    save.mutate({ name, description, total_weeks: weeks, routines: cleaned });
  };

  return (
    // noValidate: the browser's native bubbles would block submit() and the inline
    // errors below the fold would never render; `required` stays for semantics.
    <form onSubmit={submit} noValidate className="space-y-4">
      <section className="space-y-3">
        <div>
          <label className="label">Program name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Phase 2 Min-Max, 5x/week" required />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input resize-none" rows={2} value={description}
            onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="w-40">
          <label className="label">Total weeks</label>
          <input type="number" min="1" step="1" className="input" value={totalWeeks}
            placeholder="ongoing"
            onChange={(e) => setTotalWeeks(e.target.value)} />
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">Leave blank for an ongoing program.</p>
        </div>
      </section>

      <div>
        <h2 className="section-label mb-1">Routines</h2>
        <div className="divide-y divide-neutral-200 dark:divide-neutral-800 border-t border-neutral-200 dark:border-neutral-800">
        {routines.map((r, i) => (
          <RoutineEditor
            key={r.client_id}
            routine={r}
            allExercises={allExercises}
            onChange={(u) => setRoutines(routines.map((x, j) => j === i ? u : x))}
            onRemove={() => setRoutines(routines.filter((_, j) => j !== i))}
            onMoveUp={i > 0 ? () => moveRoutine(i, -1) : undefined}
            onMoveDown={i < routines.length - 1 ? () => moveRoutine(i, 1) : undefined}
          />
        ))}
        </div>
        <button
          type="button"
          onClick={() => setRoutines([...routines, emptyRoutine()])}
          className={`${dashedAddBtn} mt-3`}
        >
          + Add routine
        </button>
      </div>

      <div className="h-20" aria-hidden="true" />
      <div className="fixed bottom-0 inset-x-0 z-20 bg-white dark:bg-neutral-950 border-t border-neutral-200 dark:border-neutral-900 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-2xl mx-auto px-4">
          {(error || save.isError) && (
            <p className="pt-2 text-xs text-red-600 dark:text-red-400" role="alert">
              {error || 'Could not save the program — try again.'}
            </p>
          )}
        </div>
        <div className="max-w-2xl mx-auto px-4 py-3 flex gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary flex-1 justify-center">Cancel</button>
          <button type="submit" disabled={save.isPending} className="btn-primary flex-1 justify-center">
            {save.isPending ? 'Saving…' : initial?.id ? 'Save changes' : 'Create program'}
          </button>
        </div>
      </div>
    </form>
  );
}
