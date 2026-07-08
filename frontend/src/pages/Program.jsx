import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  getActiveProgram, getPrograms, getProgram, createProgram, updateProgram,
  deleteProgram, startProgram, endProgram, getExercises, startWorkout,
} from '../api/client';
import { Skeleton } from '../components/Skeleton';
import ExercisePickerSheet from '../components/ExercisePickerSheet';
import { CloseIcon, ChevronIcon } from '../components/icons';
import { useHideMobileNav } from '../hooks/useMobileNavVisibility';
import { formatRest, parseIntOrNull } from '../utils/format';

const dashedAddBtn = 'w-full text-center py-2 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200 border border-dashed border-neutral-200 dark:border-neutral-800 rounded hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors';
const iconBtn = 'text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 p-1 shrink-0';

const genId = () => crypto.randomUUID();

function emptyExercise() {
  return {
    client_id: genId(),
    exercise_id: '',
    target_sets: null,
    rep_range_low: null,
    rep_range_high: null,
    target_rir_per_set: [],
    rest_seconds: null,
    notes: '',
    substitutes: [],
  };
}

const selectOnFocus = (e) => e.target.select();
function emptyRoutine(name = '') {
  return { client_id: genId(), name, exercises: [emptyExercise()] };
}

function formatRirArray(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  if (arr.every((v) => v == null)) return null;
  return arr.map((v) => v == null ? '–' : v).join('/');
}

function summarizeExercise(ex) {
  const chips = [];
  if (ex.target_sets) chips.push(`${ex.target_sets} sets`);
  if (ex.rep_range_low || ex.rep_range_high) {
    chips.push(`${ex.rep_range_low ?? '?'}–${ex.rep_range_high ?? '?'} reps`);
  }
  const rirStr = formatRirArray(ex.target_rir_per_set);
  if (rirStr) chips.push(`RIR ${rirStr}`);
  if (ex.rest_seconds != null) chips.push(`${formatRest(ex.rest_seconds)} rest`);
  return chips;
}

function handleEditorEnter(e) {
  if (e.key !== 'Enter') return;
  if (e.nativeEvent?.isComposing) return;
  if (!(e.target instanceof HTMLElement)) return;
  if (e.target.dataset.editorInput !== 'true') return;
  e.preventDefault();
  const root = e.currentTarget;
  const inputs = Array.from(root.querySelectorAll('[data-editor-input="true"]:not(:disabled)'));
  const idx = inputs.indexOf(e.target);
  if (idx === -1) return;
  const next = inputs[idx + 1];
  if (next) {
    next.focus();
    next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } else {
    e.target.blur();
  }
}

function ExerciseEditor({ ex, allExercises, expanded, onToggle, onChange, onRemove }) {
  const [picker, setPicker] = useState(null); // { kind: 'primary' } | { kind: 'sub', subIndex }
  const byId = useMemo(() => {
    const m = {};
    for (const e of allExercises) m[String(e.id)] = e;
    return m;
  }, [allExercises]);

  const primary = ex.exercise_id ? byId[String(ex.exercise_id)] : null;
  const chips = summarizeExercise(ex);

  const handleSelect = (picked) => {
    if (picker?.kind === 'primary') {
      onChange({ ...ex, exercise_id: String(picked.id) });
    } else if (picker?.kind === 'sub') {
      const subs = ex.substitutes.map((s, j) => j === picker.subIndex ? { ...s, exercise_id: String(picked.id) } : s);
      onChange({ ...ex, substitutes: subs });
    }
  };

  const pickerTitle = picker?.kind === 'primary'
    ? (primary ? `Replace ${primary.name}` : 'Pick an exercise')
    : 'Pick substitute';

  return (
    <div>
      {/* Header row — always visible, tappable to expand/collapse */}
      <div className="flex items-start gap-2 py-2">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-start gap-2 flex-1 min-w-0 text-left -mx-1 px-1 py-1 rounded hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
        >
          <span className="text-neutral-400 dark:text-neutral-500 shrink-0 mt-1">
            <ChevronIcon open={expanded} />
          </span>
          <div className="flex-1 min-w-0">
            <div className={`truncate ${primary ? 'font-medium text-neutral-900 dark:text-neutral-200' : 'text-neutral-500 dark:text-neutral-500'}`}>
              {primary ? primary.name : 'Pick an exercise'}
            </div>
            {!expanded && chips.length > 0 && (
              <div className="text-xs text-neutral-500 dark:text-neutral-500 mt-0.5 truncate">
                {chips.join(' · ')}
              </div>
            )}
          </div>
        </button>
        <button type="button" onClick={onRemove} aria-label="Remove exercise" className={`${iconBtn} mt-1`}>
          <CloseIcon />
        </button>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div data-editor-root className="pl-7 pr-1 pb-3 space-y-3" onKeyDown={handleEditorEnter}>
          <button
            type="button"
            onClick={() => setPicker({ kind: 'primary' })}
            className="flex items-center gap-1.5 text-left w-full min-w-0 px-3 py-2 rounded border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
          >
            <span className={`flex-1 min-w-0 truncate ${primary ? 'text-neutral-900 dark:text-neutral-200' : 'text-neutral-500 dark:text-neutral-500'}`}>
              {primary ? primary.name : 'Pick an exercise'}
            </span>
            <span className="text-neutral-400 dark:text-neutral-500 shrink-0"><ChevronIcon /></span>
          </button>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="label">Sets</label>
              <input
                data-editor-input="true"
                type="number" inputMode="numeric" min="1" placeholder="3" className="input"
                value={ex.target_sets ?? ''}
                onFocus={selectOnFocus}
                onChange={(e) => {
                  const v = parseIntOrNull(e.target.value);
                  const rir = Array.isArray(ex.target_rir_per_set) ? ex.target_rir_per_set : [];
                  let nextRir = rir;
                  if (typeof v === 'number' && v > 0) {
                    if (rir.length < v) nextRir = [...rir, ...Array(v - rir.length).fill(null)];
                    else if (rir.length > v) nextRir = rir.slice(0, v);
                  } else if (v == null) {
                    nextRir = [];
                  }
                  onChange({ ...ex, target_sets: v, target_rir_per_set: nextRir });
                }}
              />
            </div>
            <div>
              <label className="label">Reps low</label>
              <input
                data-editor-input="true"
                type="number" inputMode="numeric" min="1" placeholder="8" className="input"
                value={ex.rep_range_low ?? ''}
                onFocus={selectOnFocus}
                onChange={(e) => onChange({ ...ex, rep_range_low: parseIntOrNull(e.target.value) })}
              />
            </div>
            <div>
              <label className="label">Reps high</label>
              <input
                data-editor-input="true"
                type="number" inputMode="numeric" min="1" placeholder="12" className="input"
                value={ex.rep_range_high ?? ''}
                onFocus={selectOnFocus}
                onChange={(e) => onChange({ ...ex, rep_range_high: parseIntOrNull(e.target.value) })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Rest (min)</label>
              <input
                data-editor-input="true"
                type="number" inputMode="decimal" min="0" step="0.25" placeholder="2" className="input"
                value={ex.rest_seconds == null ? '' : (ex.rest_seconds / 60)}
                onFocus={selectOnFocus}
                onChange={(e) => {
                  if (e.target.value === '') return onChange({ ...ex, rest_seconds: null });
                  const mins = parseFloat(e.target.value);
                  onChange({ ...ex, rest_seconds: Number.isFinite(mins) ? Math.round(mins * 60) : null });
                }}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">RIR per set</span>
            {!ex.target_sets ? (
              <p className="text-xs text-neutral-500 dark:text-neutral-500">Set the number of sets to define per-set RIR.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: ex.target_sets }, (_, i) => {
                  const value = ex.target_rir_per_set?.[i];
                  return (
                    <label key={i} className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-500">
                      <span className="w-9 text-right">Set {i + 1}</span>
                      <input
                        data-editor-input="true"
                        type="number" inputMode="numeric" min="0" placeholder="1"
                        className="input w-14 py-1.5 text-center"
                        value={value == null ? '' : value}
                        onFocus={selectOnFocus}
                        onChange={(e) => {
                          const v = parseIntOrNull(e.target.value);
                          const arr = Array.isArray(ex.target_rir_per_set)
                            ? [...ex.target_rir_per_set]
                            : Array(ex.target_sets).fill(null);
                          arr[i] = v;
                          onChange({ ...ex, target_rir_per_set: arr });
                        }}
                      />
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <input
            data-editor-input="true"
            className="input" placeholder="Notes (optional)" value={ex.notes || ''}
            onChange={(e) => onChange({ ...ex, notes: e.target.value })}
          />

          <div className="space-y-2">
            <span className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Preset substitutes</span>
            {ex.substitutes.map((sub, i) => {
              const subEx = sub.exercise_id ? byId[String(sub.exercise_id)] : null;
              return (
                <div key={i} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPicker({ kind: 'sub', subIndex: i })}
                    className="flex items-center gap-1.5 text-left flex-1 min-w-0 px-3 py-1.5 rounded border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
                  >
                    <span className={`flex-1 min-w-0 truncate text-sm ${subEx ? 'text-neutral-900 dark:text-neutral-200' : 'text-neutral-500 dark:text-neutral-500'}`}>
                      {subEx ? subEx.name : 'Pick substitute'}
                    </span>
                    <span className="text-neutral-400 dark:text-neutral-500 shrink-0"><ChevronIcon /></span>
                  </button>
                  <button
                    type="button"
                    aria-label="Remove substitute"
                    onClick={() => onChange({ ...ex, substitutes: ex.substitutes.filter((_, j) => j !== i) })}
                    className={iconBtn}
                  >
                    <CloseIcon />
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => onChange({ ...ex, substitutes: [...ex.substitutes, { exercise_id: '' }] })}
              className={`${dashedAddBtn} text-xs py-1.5`}
            >
              + Add substitute
            </button>
          </div>

          <ExercisePickerSheet
            open={!!picker}
            onClose={() => setPicker(null)}
            onSelect={handleSelect}
            title={pickerTitle}
            currentExerciseId={picker?.kind === 'primary' ? (ex.exercise_id ? parseInt(ex.exercise_id) : null) : null}
          />
        </div>
      )}
    </div>
  );
}

function RoutineEditor({ routine, allExercises, onChange, onRemove }) {
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

function ProgramEditor({ initial, onCancel, onSaved }) {
  useHideMobileNav();
  const qc = useQueryClient();
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [totalWeeks, setTotalWeeks] = useState(
    initial?.total_weeks === undefined ? 12 : (initial.total_weeks ?? '')
  );
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
              notes: re.notes || '',
              substitutes: (re.substitutes || []).map((s) => ({ exercise_id: String(s.exercise_id) })),
            };
          }),
        }))
      : [emptyRoutine('Upper 1'), emptyRoutine('Lower 1')]
  );

  const { data: allExercises = [] } = useQuery({ queryKey: ['exercises'], queryFn: getExercises });

  const save = useMutation({
    mutationFn: (payload) => initial?.id ? updateProgram(initial.id, payload) : createProgram(payload),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['active-program'] });
      qc.invalidateQueries({ queryKey: ['programs'] });
      onSaved(data);
    },
  });

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return alert('Program name required');
    if (!routines.length) return alert('Add at least one routine');
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
            notes: ex.notes || null,
            substitutes: ex.substitutes
              .filter((s) => s.exercise_id)
              .map((s) => ({ exercise_id: parseInt(s.exercise_id) })),
          };
        }),
    }));
    const weeks = totalWeeks === '' || totalWeeks == null ? null : parseInt(totalWeeks);
    save.mutate({ name, description, total_weeks: Number.isFinite(weeks) ? weeks : null, routines: cleaned });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="card space-y-3">
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
          <input type="number" min="1" className="input" value={totalWeeks}
            placeholder="ongoing"
            onChange={(e) => setTotalWeeks(e.target.value)} />
          <p className="text-xs text-neutral-500 dark:text-neutral-500 mt-1">Leave blank for an ongoing program.</p>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="font-semibold">Routines</h2>
        {routines.map((r, i) => (
          <RoutineEditor
            key={r.client_id}
            routine={r}
            allExercises={allExercises}
            onChange={(u) => setRoutines(routines.map((x, j) => j === i ? u : x))}
            onRemove={() => setRoutines(routines.filter((_, j) => j !== i))}
          />
        ))}
        <button
          type="button"
          onClick={() => setRoutines([...routines, emptyRoutine()])}
          className={dashedAddBtn}
        >
          + Add routine
        </button>
      </div>

      <div className="h-20" aria-hidden="true" />
      <div className="fixed bottom-0 inset-x-0 z-20 bg-white dark:bg-neutral-950 border-t border-neutral-200 dark:border-neutral-900 pb-[env(safe-area-inset-bottom)]">
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

function ProgramView({ program, onEdit, onDeleted }) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['active-program'] });
    qc.invalidateQueries({ queryKey: ['programs'] });
    qc.invalidateQueries({ queryKey: ['program', program.id] });
    qc.invalidateQueries({ queryKey: ['in-progress-workout'] });
  };

  const startMut = useMutation({ mutationFn: () => startProgram(program.id), onSuccess: invalidateAll });
  const endMut = useMutation({ mutationFn: () => endProgram(program.id), onSuccess: invalidateAll });
  const deleteMut = useMutation({
    mutationFn: () => deleteProgram(program.id),
    onSuccess: () => {
      invalidateAll();
      qc.removeQueries({ queryKey: ['program', program.id] });
      onDeleted?.();
    },
  });

  const startWorkoutMut = useMutation({
    mutationFn: (routineId) => startWorkout({ routine_id: routineId }),
    onSuccess: (w) => {
      qc.invalidateQueries({ queryKey: ['in-progress-workout'] });
      navigate(`/session/${w.id}`);
    },
  });

  const isActive = program.status === 'active';
  const nextRoutine = isActive ? program.progress?.next_routine : null;

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{program.name}</h1>
            {program.description && <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">{program.description}</p>}
            <p className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mt-2">
              {program.total_weeks ? `${program.total_weeks} weeks` : 'Ongoing'} · {program.routines.length} routines · {program.status}
            </p>
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            <button onClick={onEdit} className="btn-secondary">Edit</button>
            {!isActive && program.status !== 'completed' && (
              <button onClick={() => startMut.mutate()} className="btn-primary">
                {startMut.isPending ? '…' : 'Start program'}
              </button>
            )}
            {isActive && (
              <button
                onClick={() => { if (confirm('End this program early? It will be archived.')) endMut.mutate(); }}
                className="btn-secondary"
              >End</button>
            )}
            {program.status !== 'active' && (
              <button
                onClick={() => { if (confirm(`Delete "${program.name}"? Any unfinished workout will be discarded. Completed history is kept.`)) deleteMut.mutate(); }}
                className="btn-ghost"
              >Delete</button>
            )}
          </div>
        </div>

        {isActive && nextRoutine && (
          <button
            onClick={() => startWorkoutMut.mutate(nextRoutine.id)}
            disabled={startWorkoutMut.isPending}
            className="btn-primary w-full justify-center py-3"
          >
            {startWorkoutMut.isPending ? 'Starting…' : `Start ${nextRoutine.name} · Week ${program.progress.week}`}
          </button>
        )}
      </div>

      {program.routines.map((r, i) => (
        <div
          key={r.id}
          className={`card ${nextRoutine?.id === r.id ? 'border-neutral-900 dark:border-neutral-100' : ''}`}
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm text-neutral-400 w-6">{String(i + 1).padStart(2, '0')}</span>
            <h2 className="font-semibold">{r.name}</h2>
            {nextRoutine?.id === r.id && <span className="badge-solid ml-1">Next</span>}
            <span className="text-xs text-neutral-500 dark:text-neutral-400 ml-auto">{r.exercises.length} exercises</span>
          </div>
          <div className="space-y-2">
            {r.exercises.map((ex) => (
              <div key={ex.id} className="flex items-start gap-3 text-sm border-t border-neutral-200 dark:border-neutral-800 pt-2">
                <div className="flex-1">
                  <p className="font-medium text-neutral-900 dark:text-neutral-100">{ex.exercise_name}</p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    {ex.target_sets} sets
                    {(ex.rep_range_low || ex.rep_range_high) && ` · ${ex.rep_range_low || '?'}–${ex.rep_range_high || '?'} reps`}
                    {Array.isArray(ex.target_rir_per_set) && ex.target_rir_per_set.some((v) => v != null) && ` · RIR ${ex.target_rir_per_set.map((v) => v == null ? '–' : v).join('/')}`}
                    {ex.rest_seconds != null && ` · ${formatRest(ex.rest_seconds)} rest`}
                  </p>
                  {ex.notes && <p className="text-xs text-neutral-500 italic mt-0.5">{ex.notes}</p>}
                  {ex.substitutes?.length > 0 && (
                    <p className="text-xs text-neutral-500 mt-0.5">
                      Subs: {ex.substitutes.map((s) => s.exercise_name).join(', ')}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Program() {
  const [editing, setEditing] = useState(null);
  const [viewingId, setViewingId] = useState(null);

  const { data: active, isLoading: activeLoading } = useQuery({
    queryKey: ['active-program'],
    queryFn: getActiveProgram,
  });
  const { data: allPrograms = [], isLoading: allLoading } = useQuery({
    queryKey: ['programs'],
    queryFn: getPrograms,
  });
  const { data: selected } = useQuery({
    queryKey: ['program', viewingId],
    queryFn: () => getProgram(viewingId),
    enabled: !!viewingId,
  });

  useEffect(() => {
    if (viewingId || editing) return;
    if (active?.id) {
      setViewingId(active.id);
    } else if (allPrograms.length) {
      setViewingId(allPrograms[0].id);
    }
  }, [active, allPrograms, viewingId, editing]);

  if (editing) {
    return (
      <div className="space-y-3">
        <button onClick={() => setEditing(null)} className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">← Back</button>
        <h1 className="text-2xl font-semibold tracking-tight">{editing === 'new' ? 'New program' : 'Edit program'}</h1>
        <ProgramEditor
          initial={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={(p) => { setEditing(null); setViewingId(p.id); }}
        />
      </div>
    );
  }

  const stillResolving = activeLoading || allLoading;
  const noPrograms = !stillResolving && allPrograms.length === 0;
  const displayed = selected && active && selected.id === active.id
    ? { ...selected, progress: active.progress }
    : (selected || active);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Program</h1>
        <button onClick={() => setEditing('new')} className="btn-primary">New program</button>
      </div>

      {noPrograms && (
        <div className="card">
          <p className="font-semibold">No programs yet</p>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">Create one to get started.</p>
          <button onClick={() => setEditing('new')} className="btn-primary mt-4">Create your first program</button>
        </div>
      )}

      {allPrograms.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {allPrograms.map((p) => (
            <button
              key={p.id}
              onClick={() => setViewingId(p.id)}
              className={
                (displayed?.id === p.id)
                  ? 'badge-solid cursor-pointer'
                  : 'badge cursor-pointer hover:text-neutral-900 dark:hover:text-neutral-100'
              }
            >
              {p.name}{p.status === 'active' ? ' · active' : ''}
            </button>
          ))}
        </div>
      )}

      {displayed && <ProgramView program={displayed} onEdit={() => setEditing(displayed)} onDeleted={() => setViewingId(null)} />}
      {!displayed && !noPrograms && <ProgramSkeleton />}
    </div>
  );
}

function ProgramSkeleton() {
  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-3 w-40" />
        </div>
        <Skeleton className="h-11 w-full" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="card space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-3 w-44" />
        </div>
      ))}
    </div>
  );
}
