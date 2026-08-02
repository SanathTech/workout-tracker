import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { getWorkout, updateWorkout, completeWorkout, skipWorkout, getLastByExercise, getSuggestions } from '../api/client';
import { Skeleton } from '../components/Skeleton';
import ExercisePickerSheet from '../components/ExercisePickerSheet';
import MainBadge from '../components/MainBadge';
import { CloseIcon, ChevronIcon, InfoIcon, CheckIcon } from '../components/icons';
import RestTimer, { useRestTimer } from '../components/RestTimer';
import { selectOnFocus, handleEditorEnter } from './program/helpers';
import { formatRestRange, formatWarmup, formatDay } from '../utils/format';
import { saveDraft, saveSnapshot, readDraft, clearDraft, pruneDrafts } from '../utils/draft';

function TargetChip({ children }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-[10px] uppercase tracking-wide font-medium text-neutral-600 dark:text-neutral-400">
      {children}
    </span>
  );
}

const isBlank = (v) => v === '' || v == null;

const SAVE_TONE = {
  saving: 'bg-neutral-400 dark:bg-neutral-500 animate-pulse',
  saved: 'bg-emerald-500',
  unsaved: 'bg-amber-500',
  error: 'bg-red-500',
};
const SAVE_LABEL = {
  saving: 'Saving',
  saved: 'All changes saved',
  unsaved: 'Unsaved changes',
  error: 'Could not save — retrying',
};

// The full sentence lives in the page body; the pinned strip only has room to say
// whether the server has your sets.
function SaveStatusDot({ status }) {
  if (status === 'idle') return null;
  return (
    <span
      className={`shrink-0 w-2.5 h-2.5 rounded-full ${SAVE_TONE[status]}`}
      role="status"
      aria-label={SAVE_LABEL[status]}
      title={SAVE_LABEL[status]}
    />
  );
}

// The set-number cell doubles as the type control rather than adding another tap target.
// Tapping cycles it.
const SET_TYPE_CYCLE = ['working', 'warmup', 'drop', 'failure'];
const SET_TYPE_LABEL = { working: null, warmup: 'W', drop: 'D', failure: 'F' };
const SET_TYPE_TITLE = {
  working: 'Working set — counts toward volume',
  warmup: 'Warm-up — excluded from volume, 1RM and PRs',
  drop: 'Drop set — counts as a working set',
  failure: 'Taken to failure — counts as a working set',
};
const nextSetType = (t) =>
  SET_TYPE_CYCLE[(SET_TYPE_CYCLE.indexOf(t || 'working') + 1) % SET_TYPE_CYCLE.length];

// Two lines per set. At 390px a single line left the two inputs that matter — weight and
// reps — 33px wide (26px on an SE) once the prev hint and RIR had taken their fixed cut,
// and every control sat under the 44px touch minimum. Splitting the row gives weight and
// reps ~135px each and lets the secondary controls hit 44px without stealing from them.
function SetRow({ set, previousSet, showPrev, targetRir, onChange, onRemove, onDone }) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const prevWeight = previousSet?.weight_kg != null ? Number(previousSet.weight_kg) : null;
  const prevLabel = prevWeight != null && previousSet?.reps != null
    ? `${prevWeight}×${previousSet.reps}`
    : previousSet?.reps != null
      ? `—×${previousSet.reps}`
      : '—';
  const prevTitle = previousSet?.rir != null ? `${prevLabel} @ RIR ${previousSet.rir}` : prevLabel;

  // A set counts as done once it carries data — the same test that decides whether it
  // persists — so the tick survives a reload without needing a column to store it in.
  const done = !isBlank(set.weight_kg) || !isBlank(set.reps);

  // One tap for the common case: you did the set at last session's numbers, so fill them
  // in and start the rest. Anything already typed is left alone.
  const markDone = () => {
    const next = { ...set };
    if (isBlank(next.weight_kg) && prevWeight != null) next.weight_kg = prevWeight;
    if (isBlank(next.reps) && previousSet?.reps != null) next.reps = previousSet.reps;
    if (next.weight_kg !== set.weight_kg || next.reps !== set.reps) onChange(next);
    onDone();
  };

  // Removal is one tap away from the Done tick on a phone, and an accidental one silently
  // renumbers every set below it — so it asks first, and forgets it was asked.
  useEffect(() => {
    if (!confirmRemove) return undefined;
    const t = setTimeout(() => setConfirmRemove(false), 4000);
    return () => clearTimeout(t);
  }, [confirmRemove]);

  const typeLabel = SET_TYPE_LABEL[set.set_type || 'working'] ?? set.set_number;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange({ ...set, set_type: nextSetType(set.set_type) })}
          title={SET_TYPE_TITLE[set.set_type || 'working']}
          aria-label={`Set ${set.set_number}: ${set.set_type || 'working'} — tap to change type`}
          className={`shrink-0 h-11 min-w-[3.25rem] px-2 -ml-1 rounded text-xs font-medium text-left transition-colors ${
            set.set_type === 'warmup'
              ? 'text-amber-600 dark:text-amber-500'
              : set.set_type === 'drop' || set.set_type === 'failure'
                ? 'text-purple-600 dark:text-purple-400'
                : 'text-neutral-500 dark:text-neutral-400'
          }`}
        >
          Set {typeLabel}
        </button>
        <span
          className="flex-1 min-w-0 truncate text-[11px] text-neutral-500 dark:text-neutral-400"
          title={showPrev ? prevTitle : undefined}
        >
          {showPrev ? `prev ${prevLabel}` : ''}
        </span>
        <label className="shrink-0 flex items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
          <span>RIR</span>
          <input
            data-editor-input="true"
            type="number" inputMode="numeric" min="0" step="1"
            enterKeyHint="next"
            placeholder={targetRir != null ? `${targetRir}` : '–'}
            title={targetRir != null ? `Reps in reserve — target ${targetRir}` : 'Reps in reserve'}
            aria-label={`Set ${set.set_number} reps in reserve`}
            value={set.rir ?? ''}
            onFocus={selectOnFocus}
            onChange={(e) => onChange({ ...set, rir: e.target.value })}
            className="input w-14 h-11 py-0 text-center"
          />
        </label>
        {confirmRemove ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Confirm removing set ${set.set_number}`}
            className="shrink-0 h-11 px-2 rounded text-xs font-medium text-red-600 dark:text-red-400"
          >
            Remove?
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmRemove(true)}
            aria-label={`Remove set ${set.set_number}`}
            className="shrink-0 w-11 h-11 -mr-1 flex items-center justify-center rounded text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
          >
            <CloseIcon />
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          data-editor-input="true"
          type="number" inputMode="decimal" min="0" step="0.5"
          enterKeyHint="next"
          placeholder="kg"
          aria-label={`Set ${set.set_number} weight in kilograms`}
          value={set.weight_kg ?? ''}
          onFocus={selectOnFocus}
          onChange={(e) => onChange({ ...set, weight_kg: e.target.value })}
          className="input flex-1 min-w-0 h-12"
        />
        <input
          data-editor-input="true"
          type="number" inputMode="numeric" min="0"
          enterKeyHint="next"
          placeholder="reps"
          aria-label={`Set ${set.set_number} reps`}
          value={set.reps ?? ''}
          onFocus={selectOnFocus}
          onChange={(e) => onChange({ ...set, reps: e.target.value })}
          className="input flex-1 min-w-0 h-12"
        />
        <button
          type="button"
          onClick={markDone}
          aria-label={done ? `Set ${set.set_number} done — restart rest` : `Mark set ${set.set_number} done and start rest`}
          title={done ? 'Restart rest' : 'Done — start rest'}
          className={`shrink-0 w-12 h-12 rounded-lg border flex items-center justify-center transition-colors ${
            done
              ? 'bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700'
              : 'border-neutral-300 dark:border-neutral-700 text-neutral-400 hover:border-emerald-500 hover:text-emerald-600'
          }`}
        >
          <CheckIcon size={18} />
        </button>
      </div>
    </div>
  );
}

function ExerciseBlock({ block, workoutId, onOpenPicker, onChange, onRemove, onRest, suggestion }) {
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
    onChange({ ...block, sets: [...block.sets, { set_number: nextNum, reps: null, weight_kg: null, rir: null, set_type: 'working' }] });
  };
  const updateSet = (i, u) => onChange({ ...block, sets: block.sets.map((s, j) => j === i ? u : s) });
  const removeSet = (i) => onChange({
    ...block,
    sets: block.sets.filter((_, j) => j !== i).map((s, j) => ({ ...s, set_number: j + 1 })),
  });

  return (
    <div className={`card space-y-3 ${isMain ? 'border-l-2 border-l-amber-400 dark:border-l-amber-500/60' : ''}`}>
      <div className="flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={onOpenPicker}
          className="flex items-center gap-1.5 text-left flex-1 min-w-0 -mx-2 px-2 min-h-11 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
        >
          {/* Wraps rather than truncates: "Barbell Overhead Press" cut to "Barbell
              Overhea…" is worse than a second line. */}
          <span className="font-semibold text-neutral-900 dark:text-neutral-200 min-w-0">
            {block.exercise_name || 'Pick an exercise'}
          </span>
          {isMain && <MainBadge className="shrink-0" />}
          <span className="text-neutral-400 dark:text-neutral-400 shrink-0">
            <ChevronIcon open={false} />
          </span>
        </button>
        <div className="flex items-center shrink-0">
          {target?.notes && (
            <button
              type="button"
              onClick={() => setShowNote((v) => !v)}
              aria-label={showNote ? 'Hide exercise notes' : 'Show exercise notes'}
              aria-expanded={showNote}
              className={`w-11 h-11 flex items-center justify-center rounded transition-colors ${showNote ? 'text-neutral-900 dark:text-neutral-200' : 'text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'}`}
            >
              <InfoIcon />
            </button>
          )}
          <button
            onClick={onRemove}
            aria-label={`Remove ${block.exercise_name || 'exercise'}`}
            className="w-11 h-11 -mr-2 flex items-center justify-center rounded text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
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

      {suggestion && suggestion.action !== 'no_history' && suggestion.action !== 'no_target' && (
        <p className={`text-xs rounded p-2 border ${
          suggestion.action === 'increase'
            ? 'text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900'
            : 'text-neutral-600 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800'
        }`}>
          <span className="font-medium">
            {suggestion.action === 'increase' ? 'Add load' : 'Hold'}
          </span>
          {suggestion.suggested_weight_kg != null && (
            <> · {suggestion.suggested_weight_kg}kg × {suggestion.suggested_reps_low}–{suggestion.suggested_reps_high}</>
          )}
          <span className="block mt-0.5 opacity-80">{suggestion.reason}</span>
        </p>
      )}

      {target?.notes && showNote && (
        <p className="text-xs text-neutral-600 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-900 rounded p-2 border border-neutral-200 dark:border-neutral-800 whitespace-pre-line">
          {target.notes}
        </p>
      )}

      {block.notes && (
        <p className="text-xs text-neutral-500 dark:text-neutral-400 italic">{block.notes}</p>
      )}

      <div className="space-y-3">
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
              // Rest the minimum of the prescribed range — the upper bound is a ceiling,
              // not the thing you wait for. Falls back to 2 min when nothing is set.
              onDone={() => onRest(target?.rest_seconds ?? target?.rest_seconds_high ?? 120)}
            />
          );
        })}
        <button
          type="button"
          onClick={addSet}
          className="w-full text-center h-11 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 border border-dashed border-neutral-200 dark:border-neutral-800 rounded hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
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
      ? { set_number: num, reps: s.reps, weight_kg: s.weight_kg == null ? null : Number(s.weight_kg), rir: s.rir, set_type: s.set_type || 'working' }
      : { set_number: num, reps: null, weight_kg: null, rir: null, set_type: 'working' };
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
              return { set_number: s.set_number, reps, weight_kg, rir, set_type: s.set_type || 'working', logged };
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
  const { data: fetched, isLoading, isFetchedAfterMount, isError } = useQuery({
    queryKey: ['workout', id],
    queryFn: () => getWorkout(id),
    staleTime: 0,
  });

  // Offline after a cold start there's no server response and no persisted query cache,
  // so fall back to the snapshot stored beside the draft. Server data always wins when
  // it's there; this only fills the gap where there is none.
  const offlineSnapshot = useMemo(
    () => (fetched || !isError ? null : readDraft(id)?.workout || null),
    [fetched, isError, id]
  );
  const workout = fetched || offlineSnapshot;
  const usingSnapshot = !fetched && !!offlineSnapshot;

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

  // Reflects the last *completed* session, so the workout being logged right now doesn't
  // move the goalposts underneath itself.
  const { data: suggestions = [] } = useQuery({
    queryKey: ['suggestions'],
    queryFn: getSuggestions,
    staleTime: 5 * 60_000,
  });
  const suggestionByExercise = useMemo(
    () => Object.fromEntries((suggestions || []).map((s) => [s.exercise_id, s])),
    [suggestions]
  );

  const rest = useRestTimer();
  const [recovered, setRecovered] = useState(false);

  // The fixed action bar changes height (rest timer, save error), and content has to be
  // able to scroll clear of whatever it currently is.
  const barRef = useRef(null);
  const [barHeight, setBarHeight] = useState(80);
  useEffect(() => {
    const el = barRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setBarHeight(entry.target.offsetHeight));
    ro.observe(el);
    setBarHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, [hydrated]);

  const { loggedSets, plannedSets } = useMemo(() => {
    let logged = 0;
    let planned = 0;
    for (const ex of exercises) {
      for (const s of ex.sets) {
        planned += 1;
        if (!isBlank(s.weight_kg) || !isBlank(s.reps)) logged += 1;
      }
    }
    return { loggedSets: logged, plannedSets: planned };
  }, [exercises]);

  // Hydrate local state once from the fresh mount-fetch. If that fetch errored but
  // cached data exists (e.g. offline), hydrate from cache instead of hanging on the
  // skeleton. A later background refetch must not clobber in-progress edits.
  useEffect(() => {
    if (!workout || (!isFetchedAfterMount && !isError) || hydrated) return;

    // A draft only outlives its own save when the save never landed, so anything found
    // here is unsaved work — newer than whatever the server returned. Merge it over the
    // server rows by set_number rather than replacing them, so the routine's targets and
    // exercise names (which the draft doesn't carry) survive.
    const draft = readDraft(id);
    const draftSets = {};
    if (draft?.payload) {
      try {
        for (const ex of JSON.parse(draft.payload).exercises || []) {
          draftSets[ex.exercise_id] = ex.sets || [];
        }
      } catch { /* corrupt draft — fall through to server data */ }
    }
    const usedDraft = Object.keys(draftSets).length > 0;

    const rows = workout.exercises.map((e) => {
      const base = hydrateSets(e);
      const fromDraft = draftSets[e.exercise_id];
      const sets = fromDraft
        ? base.map((s) => {
            const d = fromDraft.find((x) => x.set_number === s.set_number);
            return d ? { ...s, reps: d.reps, weight_kg: d.weight_kg, rir: d.rir } : s;
          })
        : base;
      return {
        client_id: crypto.randomUUID(),
        exercise_id: e.exercise_id,
        exercise_name: e.exercise_name,
        muscle_group: e.muscle_group,
        notes: e.notes || '',
        target: e.target,
        sets,
      };
    });

    setExercises(rows);
    setNotes(workout.notes || '');
    // Baseline is the *server's* state, so recovered edits register as unsaved and get
    // flushed as soon as there's a connection again.
    lastSavedRef.current = JSON.stringify(serializePayload(
      workout.exercises.map((e) => ({ ...e, sets: hydrateSets(e) })),
      workout.notes || ''
    ));
    pendingRef.current = JSON.stringify(serializePayload(rows, workout.notes || ''));
    setRecovered(usedDraft && pendingRef.current !== lastSavedRef.current);
    setHydrated(true);
    // Keep the shape the page was built from, so a cold reload with no network can render
    // it. Skipped when this render *is* the snapshot — rewriting it would be a no-op.
    if (!usingSnapshot) saveSnapshot(id, workout);
    pruneDrafts();
  }, [workout, isFetchedAfterMount, isError, hydrated, id, usingSnapshot]);

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
        // Only report "saved" once the server truly has the latest payload — and that's
        // the one moment the local draft is redundant.
        if (pendingRef.current === lastSavedRef.current) {
          setAutosaveIfMounted('saved');
          clearDraft(id);
        }
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
    // Written before the network is even attempted: the point is to survive the app
    // being killed while offline, which is exactly when the PUT won't land.
    saveDraft(id, pendingRef.current);
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
      rest.stop();
      clearDraft(id);
      qc.invalidateQueries({ queryKey: ['active-program'] });
      qc.invalidateQueries({ queryKey: ['recent-workouts'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['suggestions'] });
      qc.invalidateQueries({ queryKey: ['muscle-volume'] });
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
      rest.stop();
      // A skip doesn't block on the save, so a draft can outlive it. Nothing logged here
      // counts any more, and leaving it would resurrect those sets on a later visit.
      clearDraft(id);
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
        sets: [{ set_number: 1, reps: null, weight_kg: null, rir: null, set_type: 'working' }],
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
      {/* Replaces the global header on mobile (hidden by Navbar during a session): the
          pinned strip carries the routine, how far through you are and the save state,
          rather than the app's own name. */}
      <div className="md:hidden sticky top-0 z-10 -mx-4 px-4 h-12 flex items-center gap-3 bg-white/95 dark:bg-neutral-950/95 backdrop-blur border-b border-neutral-200 dark:border-neutral-900">
        <button
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="shrink-0 -ml-2 w-11 h-11 flex items-center justify-center text-neutral-500 dark:text-neutral-400"
        >
          ←
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate text-neutral-900 dark:text-neutral-200">
            {workout.routine_name || 'Workout'}
          </p>
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
            {loggedSets} of {plannedSets} sets logged
          </p>
        </div>
        <SaveStatusDot status={autosave} />
      </div>

      <div>
        <div className="hidden md:flex items-center justify-between gap-3">
          <button onClick={() => navigate(-1)} className="text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200">← Back</button>
        </div>
        {/* The pinned strip already names the routine on mobile. */}
        <h1 className="hidden md:block text-2xl font-semibold tracking-tight mt-1">{workout.routine_name || 'Workout'}</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          {workout.program_name && `${workout.program_name} · `}
          {workout.program_week && `Week ${workout.program_week} · `}
          {formatDay(workout.date, { weekday: 'long', month: 'short', day: 'numeric' })}
        </p>
        {isCompleted && (
          <p className="text-xs mt-0.5 text-neutral-500 dark:text-neutral-400">Editing a completed workout — changes save automatically.</p>
        )}
        {usingSnapshot && (
          <p className="text-xs mt-1 text-amber-700 dark:text-amber-500">
            Offline — showing this session from your device. Keep logging; it saves when you reconnect.
          </p>
        )}
        {recovered && !usingSnapshot && autosave !== 'saved' && (
          <p className="text-xs mt-1 text-amber-700 dark:text-amber-500">
            Restored sets that hadn’t reached the server. They’ll save once you’re back online.
          </p>
        )}
        {autosave !== 'idle' && (
          <p className={`text-xs mt-0.5 ${
            autosave === 'error' ? 'text-red-600 dark:text-red-400'
              : autosave === 'unsaved' ? 'text-amber-600 dark:text-amber-500'
              : 'text-neutral-400 dark:text-neutral-400'
          }`}>
            {autosave === 'saving' ? 'Saving…'
              : autosave === 'saved' ? 'All changes saved'
              : autosave === 'unsaved' ? 'Unsaved changes…'
              : 'Couldn’t save — retrying…'}
          </p>
        )}
      </div>

      <div className="space-y-3" data-editor-root onKeyDown={handleEditorEnter}>
        {exercises.map((ex, i) => (
          <ExerciseBlock
            key={ex.client_id}
            block={ex}
            workoutId={id}
            onOpenPicker={() => setPicker({ mode: 'replace', forIndex: i })}
            onChange={(u) => setExercises(exercises.map((x, j) => j === i ? u : x))}
            onRemove={() => setExercises(exercises.filter((_, j) => j !== i))}
            onRest={rest.start}
            suggestion={suggestionByExercise[ex.exercise_id]}
          />
        ))}

        <button
          type="button"
          onClick={() => setPicker({ mode: 'add' })}
          className="w-full h-12 text-sm font-medium text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 border border-dashed border-neutral-200 dark:border-neutral-800 rounded hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
        >
          + Add exercise
        </button>
      </div>

      <div className="card">
        <label className="label" htmlFor="wt-workout-notes">Workout notes</label>
        <textarea
          id="wt-workout-notes"
          className="input resize-none"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {!isCompleted && (
        <button
          onClick={() => {
            if (confirm('Skip this workout? It keeps its place in the program sequence, and anything logged here stops counting.')) skip.mutate();
          }}
          disabled={skip.isPending || finish.isPending}
          className="btn-ghost w-full justify-center h-11"
        >
          {skip.isPending ? 'Skipping…' : 'Skip this workout'}
        </button>
      )}

      {/* Sized to whatever the fixed bar currently is, so the last set can always be
          scrolled clear of it — the bar grows when the rest timer or an error is in it. */}
      <div style={{ height: barHeight }} aria-hidden="true" />
      <div
        ref={barRef}
        className="fixed bottom-0 inset-x-0 z-20 bg-white dark:bg-neutral-950 border-t border-neutral-200 dark:border-neutral-900 pb-[env(safe-area-inset-bottom)]"
      >
        <div className="max-w-2xl mx-auto px-4">
          {(finish.isError || skip.isError || doneError) && (
            <p className="pt-2 text-xs text-red-600 dark:text-red-400">
              {doneError
                || (skip.isError ? 'Could not skip the workout.' : null)
                || finish.error?.message
                || 'Could not finish the workout.'}
            </p>
          )}
          <RestTimer
            remaining={rest.remaining}
            target={rest.target}
            onStop={rest.stop}
            onAdjust={rest.adjust}
          />
          <div className="py-3 flex gap-2">
            {autosave === 'error' && (
              <button
                onClick={() => saveNow()}
                className="btn-secondary justify-center h-12 shrink-0"
              >
                Retry save
              </button>
            )}
            {isCompleted ? (
              <button
                onClick={doneEditing}
                disabled={autosave === 'saving'}
                className="btn-primary flex-1 justify-center h-12"
              >
                {autosave === 'saving' ? 'Saving…' : 'Done'}
              </button>
            ) : (
              <button
                onClick={() => { if (confirm('Finish this workout?')) finish.mutate(); }}
                disabled={finish.isPending || skip.isPending}
                className="btn-primary flex-1 justify-center h-12"
              >
                {finish.isPending ? '…' : 'Finish workout'}
              </button>
            )}
          </div>
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
