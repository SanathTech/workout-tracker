import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { getWorkout, updateWorkout, completeWorkout, skipWorkout, getLastByExercise } from '../api/client';
import { Skeleton } from '../components/Skeleton';
import ExercisePickerSheet from '../components/ExercisePickerSheet';
import MainBadge from '../components/MainBadge';
import { CloseIcon, ChevronIcon, InfoIcon } from '../components/icons';
import { formatRestRange, formatWarmup, formatDay } from '../utils/format';

function TargetChip({ children }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-[10px] uppercase tracking-wide font-medium text-neutral-600 dark:text-neutral-400">
      {children}
    </span>
  );
}

function SetRow({ set, previousSet, showPrev, targetRir, onChange, onRemove }) {
  const prevWeight = previousSet?.weight_kg != null ? Number(previousSet.weight_kg) : null;
  const prevLabel = prevWeight != null && previousSet?.reps != null
    ? `${prevWeight}×${previousSet.reps}`
    : previousSet?.reps != null
      ? `—×${previousSet.reps}`
      : '—';
  const prevTitle = previousSet?.rir != null ? `${prevLabel} @ RIR ${previousSet.rir}` : prevLabel;
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-neutral-500 dark:text-neutral-500 w-5 text-center">{set.set_number}</span>
      {showPrev && (
        <span className="text-[11px] text-neutral-500 dark:text-neutral-500 w-14 truncate" title={prevTitle}>{prevLabel}</span>
      )}
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
      <input
        type="number" inputMode="numeric" min="0" step="1"
        placeholder={targetRir != null ? `${targetRir}` : 'rir'}
        title={targetRir != null ? `Reps in reserve — target ${targetRir}` : 'Reps in reserve'}
        value={set.rir ?? ''}
        onChange={(e) => onChange({ ...set, rir: e.target.value })}
        className="input w-14 py-1.5 text-center"
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
  const [showNote, setShowNote] = useState(false);
  // Collapse the note when the exercise is swapped for a different one.
  useEffect(() => { setShowNote(false); }, [block.exercise_id]);
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
  const hasPrev = (previous?.sets?.length || 0) > 0;

  const target = block.target;
  const isMain = target?.is_main === true;
  const repRange = target && (target.rep_range_low || target.rep_range_high)
    ? `${target.rep_range_low || '?'}–${target.rep_range_high || '?'}`
    : null;
  const warmupLabel = formatWarmup(target?.warmup_sets_low, target?.warmup_sets_high);

  const addSet = () => {
    const nextNum = (block.sets[block.sets.length - 1]?.set_number || 0) + 1;
    onChange({ ...block, sets: [...block.sets, { set_number: nextNum, reps: null, weight_kg: null, rir: null }] });
  };
  const updateSet = (i, u) => onChange({ ...block, sets: block.sets.map((s, j) => j === i ? u : s) });
  const removeSet = (i) => onChange({
    ...block,
    sets: block.sets.filter((_, j) => j !== i).map((s, j) => ({ ...s, set_number: j + 1 })),
  });

  return (
    <div className={`card space-y-3 ${isMain ? 'border-l-2 border-l-amber-400 dark:border-l-amber-500/60' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onOpenPicker}
          className="flex items-center gap-1.5 text-left flex-1 min-w-0 -mx-1 px-1 py-0.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
        >
          <span className="font-semibold text-neutral-900 dark:text-neutral-200 truncate">
            {block.exercise_name || 'Pick an exercise'}
          </span>
          {isMain && <MainBadge className="shrink-0" />}
          <span className="text-neutral-400 dark:text-neutral-500 shrink-0">
            <ChevronIcon open={false} />
          </span>
        </button>
        <div className="flex items-center gap-1 shrink-0">
          {target?.notes && (
            <button
              type="button"
              onClick={() => setShowNote((v) => !v)}
              aria-label={showNote ? 'Hide exercise notes' : 'Show exercise notes'}
              aria-expanded={showNote}
              className={`p-1 transition-colors ${showNote ? 'text-neutral-900 dark:text-neutral-200' : 'text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'}`}
            >
              <InfoIcon />
            </button>
          )}
          <button
            onClick={onRemove}
            aria-label="Remove exercise"
            className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 p-1"
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      {target && (
        <div className="flex flex-wrap gap-1.5">
          {warmupLabel && <TargetChip>{warmupLabel}</TargetChip>}
          {target.target_sets && <TargetChip>{target.target_sets} sets</TargetChip>}
          {repRange && <TargetChip>{repRange} reps</TargetChip>}
          {(target.rest_seconds != null || target.rest_seconds_high != null) && <TargetChip>{formatRestRange(target.rest_seconds, target.rest_seconds_high)} rest</TargetChip>}
        </div>
      )}

      {target?.notes && showNote && (
        <p className="text-xs text-neutral-600 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-900 rounded p-2 border border-neutral-200 dark:border-neutral-800 whitespace-pre-line">
          {target.notes}
        </p>
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
              showPrev={hasPrev}
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

// Build the editable set rows for an exercise. Empty sets are dropped on save, so
// a logged-then-reloaded exercise comes back with fewer rows than its target —
// pad back up to target_sets (or the highest logged set) so every prescribed set
// is always present. NUMERIC weights ("40.00") are normalized to plain numbers.
function hydrateSets(e) {
  const byNum = {};
  let maxNum = 0;
  for (const s of e.sets) {
    byNum[s.set_number] = s;
    if (s.set_number > maxNum) maxNum = s.set_number;
  }
  const count = Math.max(maxNum, e.target?.target_sets || 0, 1);
  return Array.from({ length: count }, (_, i) => {
    const num = i + 1;
    const s = byNum[num];
    return s
      ? { set_number: num, reps: s.reps, weight_kg: s.weight_kg == null ? null : Number(s.weight_kg), rir: s.rir }
      : { set_number: num, reps: null, weight_kg: null, rir: null };
  });
}

// Parse to a finite number or null — drops empty and mid-edit values like "." or "-".
const toInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const toFloat = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

// Pure builder shared by autosave, Save now, and Finish so they persist identically.
function serializePayload(exercises, notes) {
  return {
    notes: notes || null,
    exercises: exercises
      .filter((ex) => ex.exercise_id)
      .map((ex) => {
        const targetRir = Array.isArray(ex.target?.target_rir_per_set) ? ex.target.target_rir_per_set : [];
        return {
          exercise_id: ex.exercise_id,
          notes: ex.notes || null,
          sets: ex.sets
            .map((s, i) => {
              const reps = toInt(s.reps);
              const weight_kg = toFloat(s.weight_kg);
              const enteredRir = toInt(s.rir);
              const logged = reps !== null || weight_kg !== null || enteredRir !== null;
              // A blank RIR on a set you've actually logged records the routine's
              // target RIR for that set position; fully-empty sets stay dropped.
              const rir = enteredRir !== null ? enteredRir : (logged ? (targetRir[i] ?? null) : null);
              return { set_number: s.set_number, reps, weight_kg, rir, logged };
            })
            .filter((s) => s.logged)
            .map(({ logged, ...s }) => s),
        };
      }),
  };
}

export default function WorkoutSession() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // staleTime 0 + refetch-on-mount so a reload pulls the freshest workout (the
  // persisted localStorage cache may lag the last autosave by the persist throttle).
  const { data: workout, isLoading, isFetchedAfterMount, isError } = useQuery({
    queryKey: ['workout', id],
    queryFn: () => getWorkout(id),
    staleTime: 0,
  });

  const [exercises, setExercises] = useState([]);
  const [notes, setNotes] = useState('');
  const [picker, setPicker] = useState(null); // { mode: 'replace' | 'add', forIndex?: number }
  const [autosave, setAutosave] = useState('idle'); // idle | unsaved | saving | saved | error
  const [doneError, setDoneError] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const lastSavedRef = useRef(null);   // JSON of the last payload the server confirmed
  const pendingRef = useRef(null);     // JSON of the latest payload wanting to be saved
  const flushingRef = useRef(null);    // in-flight flush promise, or null
  const retryRef = useRef(null);       // pending auto-retry timeout, or null
  const flushRef = useRef(null);       // latest flush(), for the retry timer to call
  const mountedRef = useRef(true);
  useEffect(() => {
    // Set on mount too, not just the ref initializer — otherwise a remount (React
    // StrictMode, or any re-mount) leaves it false and silently freezes the save
    // status, so a later failed save never surfaces as an error.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
    };
  }, []);
  const setAutosaveIfMounted = useCallback((v) => { if (mountedRef.current) setAutosave(v); }, []);

  // Hydrate local state once from the fresh mount-fetch. If that fetch errored but
  // cached data exists (e.g. offline), hydrate from cache instead of hanging on the
  // skeleton. A later background refetch must not clobber in-progress edits.
  useEffect(() => {
    if (!workout || (!isFetchedAfterMount && !isError) || hydrated) return;
    const rows = workout.exercises.map((e) => ({
      client_id: crypto.randomUUID(),
      exercise_id: e.exercise_id,
      exercise_name: e.exercise_name,
      muscle_group: e.muscle_group,
      notes: e.notes || '',
      target: e.target,
      sets: hydrateSets(e),
    }));
    setExercises(rows);
    setNotes(workout.notes || '');
    lastSavedRef.current = JSON.stringify(serializePayload(rows, workout.notes || ''));
    pendingRef.current = lastSavedRef.current;
    setHydrated(true);
  }, [workout, isFetchedAfterMount, isError, hydrated]);

  // Serialized flush: at most one PUT in flight, and the loop always re-reads the
  // latest pending payload — so a slow response can never revert a newer edit, and
  // callers can await the single in-flight run.
  const flush = useCallback(() => {
    if (flushingRef.current) return flushingRef.current;
    if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
    const run = (async () => {
      try {
        while (pendingRef.current && pendingRef.current !== lastSavedRef.current) {
          const snapshot = pendingRef.current;
          setAutosaveIfMounted('saving');
          try {
            const updated = await updateWorkout(id, JSON.parse(snapshot));
            qc.setQueryData(['workout', id], updated); // keep the in-memory cache in sync
            lastSavedRef.current = snapshot;
          } catch {
            setAutosaveIfMounted('error');
            // Auto-retry so a transient failure heals itself instead of silently
            // leaving data unsaved until the next manual edit.
            if (mountedRef.current && !retryRef.current) {
              retryRef.current = setTimeout(() => { retryRef.current = null; flushRef.current?.(); }, 3000);
            }
            return; // stop this run; the retry (or a new edit/Finish) will resume
          }
        }
        // Only report "saved" once the server truly has the latest payload.
        if (pendingRef.current === lastSavedRef.current) setAutosaveIfMounted('saved');
      } finally {
        flushingRef.current = null;
      }
    })();
    flushingRef.current = run;
    return run;
  }, [id, qc, setAutosaveIfMounted]);
  flushRef.current = flush;

  // Debounced autosave: record the latest payload, mark it unsaved right away so the
  // status is honest during the debounce window, then flush after a pause.
  useEffect(() => {
    if (!hydrated) return;
    pendingRef.current = JSON.stringify(serializePayload(exercises, notes));
    if (pendingRef.current === lastSavedRef.current) return;
    if (autosave !== 'saving') setAutosaveIfMounted('unsaved');
    const t = setTimeout(flush, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercises, notes, hydrated, flush]);

  // Guard against losing unsaved edits to a refresh or accidental navigation.
  useEffect(() => {
    const handler = (e) => {
      if (pendingRef.current && pendingRef.current !== lastSavedRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const saveNow = useCallback(() => {
    pendingRef.current = JSON.stringify(serializePayload(exercises, notes));
    return flush();
  }, [exercises, notes, flush]);

  const finish = useMutation({
    mutationFn: async () => {
      await saveNow(); // ensure the latest edits are persisted before completing
      if (pendingRef.current !== lastSavedRef.current) {
        throw new Error('Could not save your latest changes — check your connection and try again.');
      }
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

  const skip = useMutation({
    mutationFn: async () => {
      // Flush first so sets typed inside the autosave debounce survive on the row.
      // Unlike Finish, a failed save doesn't abort the skip — you're bailing out,
      // and the sets count for nothing either way.
      await saveNow();
      return skipWorkout(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['active-program'] });
      qc.invalidateQueries({ queryKey: ['recent-workouts'] });
      qc.invalidateQueries({ queryKey: ['workouts-history'] });
      qc.invalidateQueries({ queryKey: ['in-progress-workout'] });
      qc.invalidateQueries({ queryKey: ['workout', id] });
      navigate('/dashboard');
    },
  });

  if (isError && !workout) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center space-y-3">
        <p className="text-neutral-500 dark:text-neutral-400">Couldn’t load this workout. Check your connection and try again.</p>
        <button onClick={() => navigate(-1)} className="btn-secondary">← Back</button>
      </div>
    );
  }
  if (isLoading || !workout) return <WorkoutSessionSkeleton />;
  if (!hydrated) return <WorkoutSessionSkeleton />;

  // A skipped session logs nothing, so there's nothing to edit or finish here —
  // reachable by going back after skipping, or from a stale link.
  if (workout.status === 'skipped') return <Navigate to={`/workouts/${id}`} replace />;

  // A completed workout can be reopened for editing (from its detail page). Edits
  // save in place without changing its completed status or the program sequence.
  const isCompleted = workout.status === 'completed';
  const doneEditing = async () => {
    setDoneError('');
    await saveNow();
    // flush() swallows errors, so confirm the server actually has the latest
    // payload before leaving — otherwise the user would exit with unsaved edits.
    if (pendingRef.current !== lastSavedRef.current) {
      setDoneError('Could not save your latest changes — check your connection and try again.');
      return;
    }
    navigate(`/workouts/${id}`);
  };

  const handlePickerSelect = (ex) => {
    if (picker?.mode === 'replace') {
      setExercises((prev) => prev.map((x, j) =>
        j === picker.forIndex
          ? { ...x, exercise_id: ex.id, exercise_name: ex.name, muscle_group: ex.muscle_group }
          : x
      ));
    } else if (picker?.mode === 'add') {
      setExercises((prev) => [...prev, {
        client_id: crypto.randomUUID(),
        exercise_id: ex.id,
        exercise_name: ex.name,
        muscle_group: ex.muscle_group,
        notes: '',
        target: null,
        sets: [{ set_number: 1, reps: null, weight_kg: null, rir: null }],
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
        <div className="flex items-center justify-between gap-3">
          <button onClick={() => navigate(-1)} className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200">← Back</button>
          {!isCompleted && (
            <button
              onClick={() => {
                if (confirm('Skip this workout? It keeps its place in the program sequence, and anything logged here stops counting.')) skip.mutate();
              }}
              disabled={skip.isPending || finish.isPending}
              className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200"
            >
              {skip.isPending ? 'Skipping…' : 'Skip workout'}
            </button>
          )}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">{workout.routine_name || 'Workout'}</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-500">
          {workout.program_name && `${workout.program_name} · `}
          {workout.program_week && `Week ${workout.program_week} · `}
          {formatDay(workout.date, { weekday: 'long', month: 'short', day: 'numeric' })}
        </p>
        {isCompleted && (
          <p className="text-xs mt-0.5 text-neutral-500 dark:text-neutral-400">Editing a completed workout — changes save automatically.</p>
        )}
        {autosave !== 'idle' && (
          <p className={`text-xs mt-0.5 ${
            autosave === 'error' ? 'text-red-600 dark:text-red-400'
              : autosave === 'unsaved' ? 'text-amber-600 dark:text-amber-500'
              : 'text-neutral-400 dark:text-neutral-500'
          }`}>
            {autosave === 'saving' ? 'Saving…'
              : autosave === 'saved' ? 'All changes saved'
              : autosave === 'unsaved' ? 'Unsaved changes…'
              : 'Couldn’t save — retrying…'}
          </p>
        )}
      </div>

      <div className="space-y-3">
        {exercises.map((ex, i) => (
          <ExerciseBlock
            key={ex.client_id}
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
        {(finish.isError || skip.isError || doneError) && (
          <p className="max-w-2xl mx-auto px-4 pt-2 text-xs text-red-600 dark:text-red-400">
            {doneError
              || (skip.isError ? 'Could not skip the workout.' : null)
              || finish.error?.message
              || 'Could not finish the workout.'}
          </p>
        )}
        <div className="max-w-2xl mx-auto px-4 py-3 flex gap-2">
          <button
            onClick={() => saveNow()}
            disabled={autosave === 'saving' || finish.isPending}
            className="btn-secondary flex-1 justify-center"
          >
            {autosave === 'saving' ? 'Saving…' : 'Save now'}
          </button>
          {isCompleted ? (
            <button
              onClick={doneEditing}
              disabled={autosave === 'saving'}
              className="btn-primary flex-1 justify-center"
            >
              {autosave === 'saving' ? 'Saving…' : 'Done'}
            </button>
          ) : (
            <button
              onClick={() => { if (confirm('Finish this workout?')) finish.mutate(); }}
              disabled={finish.isPending || skip.isPending}
              className="btn-primary flex-1 justify-center"
            >
              {finish.isPending ? '…' : 'Finish workout'}
            </button>
          )}
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
