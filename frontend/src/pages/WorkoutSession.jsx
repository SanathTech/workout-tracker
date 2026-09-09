import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { getWorkout, updateWorkout, completeWorkout, skipWorkout, getLastByExercise, getSuggestions, getCoachNotes, getPersonalBests, makeDefaultExercise } from '../api/client';
import { Skeleton } from '../components/Skeleton';
import ExercisePickerSheet from '../components/ExercisePickerSheet';
import MainBadge from '../components/MainBadge';
import { ChevronIcon } from '../components/icons';
import { Sheet } from '../components/ui';
import AimLine from '../components/AimLine';
import { selectOnFocus, handleEditorEnter } from './program/helpers';
import { formatRestRange, formatWarmup, formatDay } from '../util/format';
import { createSaveLoop } from '../util/saveLoop';
import FinishSheet from '../components/FinishSheet';
import { saveDraft, saveSnapshot, readDraft, clearDraft, pruneDrafts } from '../util/draft';
import MoreMenu from '../components/MoreMenu';
import { track } from '../util/telemetry';

const isBlank = (v) => v === '' || v == null;

const SAVE_TONE = {
  saving: 'bg-neutral-400 animate-pulse',
  saved: 'bg-emerald-400',
  unsaved: 'bg-amber-400',
  error: 'bg-red-400',
};
const SAVE_LABEL = {
  saving: 'Saving',
  saved: 'All changes saved',
  unsaved: 'Unsaved changes',
  error: 'Could not save — retrying',
};

// The header is the only save status there is (the sentence that used to repeat it in
// the page body is gone). A bare dot left the two states that matter indistinguishable
// without knowing the colour code, and they mean opposite things: amber is "still
// working on it", red is "your last set is not on the server". So the two states worth
// acting on carry a word; the steady-state ones stay a quiet dot. Red is also a button:
// tapping it retries, which is what the old bottom bar's "Retry save" did.
// Pin sentinel: every block collapsed (see `pinned` below).
const NONE = Symbol('none');

function SaveStatus({ status, staleMinutes, onRetry }) {
  if (status === 'idle') return null;
  const word = status === 'error' ? 'Not saved'
    : status === 'unsaved' ? (staleMinutes >= 1 ? `Not saved ${staleMinutes} min` : 'Unsaved')
    : null;
  const body = (
    <>
      <span className={`shrink-0 w-2 h-2 rounded-full ${SAVE_TONE[status]}`} />
      {word && (
        <span className={`text-[11px] font-medium whitespace-nowrap ${
          status === 'error' ? 'text-red-400' : 'text-amber-400'
        }`}>
          {word}
        </span>
      )}
    </>
  );
  if (status === 'error') {
    return (
      <button type="button" onClick={onRetry} className="shrink-0 inline-flex items-center gap-1.5" title="Retry save" aria-label="Not saved — tap to retry">
        {body}
      </button>
    );
  }
  return (
    <span className="shrink-0 inline-flex items-center gap-1.5" role="status" aria-label={SAVE_LABEL[status]} title={SAVE_LABEL[status]}>
      {body}
    </span>
  );
}

// Minutes:seconds since the workout was opened, off the same clock the server derives
// duration_minutes from (created_at). Its own component so the once-a-second tick
// re-renders one span, not the ledger. Goes quiet past six hours — the same cap the
// server applies — because by then it is a forgotten tab, not a session.
function Elapsed({ since }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const start = since ? Date.parse(since) : NaN;
  if (!Number.isFinite(start)) return null;
  const secs = Math.max(0, Math.floor((now - start) / 1000));
  if (secs > 6 * 3600) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const ss = String(secs % 60).padStart(2, '0');
  return <span>{h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`}</span>;
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

// Grid template shared by the header row and every set row, so the columns can't drift.
const LEDGER_COLS = 'grid grid-cols-[2.5rem_1fr_4rem_4rem_3.25rem] items-center';

// The ledger row — one 44px line per set, the layout Strong and Hevy converged on.
// No boxed inputs: values are bare text in tappable cells, last session's numbers sit
// in the empty cells as placeholders, and tapping PREV copies them in. Cells, not
// boxes, is where the density comes from; the row itself is still a 44px target.
// There used to be a tick column and a rest timer (removed 2026-08-10 — the owner
// rests by Garmin, and with the timer gone the tick was a second button for what the
// PREV tap already does). The green done-tint stays, keyed off the row carrying reps.
function SetRow({ set, previousSet, showPrev, targetRir, aim, onChange, onRemove }) {
  const prevWeight = previousSet?.weight_kg != null ? Number(previousSet.weight_kg) : null;
  // Either half can be null on its own — a weight-only or reps-only previous set still
  // shows the half it has rather than collapsing to a dash.
  // RIR rides along with the numbers rather than living in the title attribute. A phone
  // has no hover, so on the device this app is actually used on, last session's RIR was
  // unreachable — and it is the half of the record that decides whether to add load:
  // 8 reps at RIR3 and 8 at RIR1 are the same row here and opposite calls.
  const prevNumbers = prevWeight == null && previousSet?.reps == null
    ? '—'
    : `${prevWeight ?? '—'} × ${previousSet?.reps ?? '—'}`;
  // RIR only rides along when there is a number for it to ride on — a set with neither
  // weight nor reps would otherwise render as "— · 2", which reads as a broken cell.
  const prevLabel = previousSet?.rir != null && prevNumbers !== '—'
    ? `${prevNumbers} · ${previousSet.rir}`
    : prevNumbers;
  const prevTitle = previousSet?.rir != null
    ? `Last time: ${prevNumbers} @ RIR ${previousSet.rir} — tap to fill`
    : `Last time: ${prevNumbers} — tap to fill`;

  // Done means reps are in. Weight typed before the set is staging, not history —
  // the owner loads the bar's number in first, and a green row at that point claims a
  // set that hasn't happened. Reps only ever go in afterwards (and a bodyweight set
  // is reps-only), so reps are the honest signal. Derived, not stored — it survives
  // a reload because the data does.
  const done = !isBlank(set.reps);

  // The one-tap log for the common case: you did the set at last session's numbers,
  // so tapping PREV copies them into the blanks and the row counts as done. Anything
  // already typed is left alone.
  const fillFromPrev = () => {
    const next = { ...set };
    if (isBlank(next.weight_kg) && prevWeight != null) next.weight_kg = prevWeight;
    if (isBlank(next.reps) && previousSet?.reps != null) next.reps = previousSet.reps;
    const filled = next.weight_kg !== set.weight_kg || next.reps !== set.reps;
    // Whether the one-tap log actually earns its column. A tap that changes nothing is
    // recorded too — it means he reached for it when there was nothing to copy, which
    // is a different finding from not reaching for it at all.
    track('tap', 'prev-fill', { filled });
    if (filled) onChange(next);
  };

  // Swipe left to reveal Remove — the ledger has no room for an always-visible ✕, and
  // this keeps deletion a deliberate two-step (swipe, then tap). See useSwipeToReveal.
  const { offset, revealed, close, handlers } = useSwipeToReveal();

  // Ghost text is the AIM, not an echo of PREV (owner call, 2026-08-10 — the old
  // prev-as-placeholder duplicated the PREV column one cell over), and it echoes the
  // Aim line above the ledger and nothing else. No aim: plain unit labels.
  //
  // An engine HOLD is the one case with a per-row target: same weight, beat last time's
  // reps by one, capped at the top of the range — but only when last time's row was at
  // the SAME load. A session that ramped (45x12, then 50x8) has a working weight of 50
  // and a first row of 12 reps, and pairing them ghosted "50 x 12", a combination he
  // had never done. A coach aim is flat across the rows: "cut every set at 6" means 6,
  // not 9/8/7.
  const ghostWeight = aim?.weight_kg ?? null;
  const prevAtGhostWeight = previousSet?.weight_kg != null && ghostWeight != null
    && Number(previousSet.weight_kg) === ghostWeight;
  const ghostReps = aim == null
    ? null
    : aim.source === 'engine' && aim.action === 'hold' && prevAtGhostWeight && previousSet?.reps != null
      ? Math.min(previousSet.reps + 1, aim.reps_high ?? previousSet.reps + 1)
      : aim.reps ?? null;

  const typeLabel = SET_TYPE_LABEL[set.set_type || 'working'];
  const cellInput = 'w-full h-11 bg-transparent border-0 p-0 text-center text-base tabular-nums text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:bg-neutral-800/70 rounded-md transition-colors';

  return (
    <div className="relative overflow-hidden rounded-lg">
      {/* In the DOM only while the row is displaced (mid-swipe or revealed) — never when
          the row is at rest, so it can't bleed through the translucent done-tint above. */}
      {offset < 0 && (
        <button
          type="button"
          onClick={() => { close(); onRemove(); }}
          tabIndex={revealed ? 0 : -1}
          aria-label={`Remove set ${set.set_number}`}
          className="absolute inset-y-0 right-0 w-20 flex items-center justify-center text-sm font-medium text-white bg-red-600"
        >
          Remove
        </button>
      )}
      <div
        {...handlers}
        style={{ transform: offset ? `translateX(${offset}px)` : undefined, touchAction: 'pan-y' }}
        className={`${LEDGER_COLS} relative h-11 transition-transform duration-150 ${
          done ? 'bg-emerald-500/10 rounded-lg' : 'bg-neutral-950'
        }`}
      >
        <button
          type="button"
          onClick={() => { if (revealed) { close(); return; } onChange({ ...set, set_type: nextSetType(set.set_type) }); }}
          title={SET_TYPE_TITLE[set.set_type || 'working']}
          aria-label={`Set ${set.set_number}: ${set.set_type || 'working'} — tap to change type`}
          className={`h-11 text-xs tabular-nums text-left pl-2 rounded-md font-medium ${
            set.set_type === 'warmup'
              ? 'text-amber-400'
              : set.set_type === 'drop' || set.set_type === 'failure'
                ? 'text-purple-400'
                : 'text-neutral-400'
          }`}
        >
          {typeLabel ?? set.set_number}
        </button>
        <button
          type="button"
          onClick={showPrev ? () => { if (revealed) { close(); return; } fillFromPrev(); } : undefined}
          disabled={!showPrev}
          title={showPrev ? prevTitle : undefined}
          aria-label={showPrev ? prevTitle : 'No previous session for this exercise'}
          className="h-11 min-w-0 truncate text-left text-xs tabular-nums text-neutral-400 disabled:text-neutral-600 rounded-md"
        >
          {showPrev ? prevLabel : '—'}
        </button>
        <input
          data-editor-input="true"
          type="number" inputMode="decimal" min="0" step="0.5"
          enterKeyHint="next"
          placeholder={ghostWeight != null ? `${ghostWeight}` : 'kg'}
          aria-label={`Set ${set.set_number} weight in kilograms`}
          value={set.weight_kg ?? ''}
          onFocus={selectOnFocus}
          onChange={(e) => onChange({ ...set, weight_kg: e.target.value })}
          className={cellInput}
        />
        <input
          data-editor-input="true"
          type="number" inputMode="numeric" min="0"
          enterKeyHint="next"
          placeholder={ghostReps != null ? `${ghostReps}` : 'reps'}
          aria-label={`Set ${set.set_number} reps`}
          value={set.reps ?? ''}
          onFocus={selectOnFocus}
          onChange={(e) => onChange({ ...set, reps: e.target.value })}
          className={cellInput}
        />
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
          className={cellInput}
        />
      </div>
    </div>
  );
}

// Pointer-based swipe-left. Engages only on clearly horizontal movement so vertical
// scrolling and taps on the inputs stay native; springs shut on its own after a few
// seconds so a forgotten half-swipe doesn't leave a live Remove button on screen.
function useSwipeToReveal(width = 80) {
  const [offset, setOffset] = useState(0);
  const startRef = useRef(null); // { x, y, engaged }

  const close = useCallback(() => setOffset(0), []);
  const revealed = offset <= -width;

  useEffect(() => {
    if (!revealed) return undefined;
    const t = setTimeout(close, 5000);
    return () => clearTimeout(t);
  }, [revealed, close]);

  const handlers = {
    onPointerDown: (e) => { startRef.current = { x: e.clientX, y: e.clientY, engaged: false }; },
    onPointerMove: (e) => {
      const s = startRef.current;
      if (!s) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (!s.engaged) {
        if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        s.engaged = true;
        // Throws NotFoundError if the pointer was already released mid-gesture.
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* keep swiping uncaptured */ }
      }
      setOffset(Math.max(-width, Math.min(0, (revealed ? -width : 0) + dx)));
    },
    onPointerUp: () => {
      const s = startRef.current;
      startRef.current = null;
      if (!s?.engaged) return;
      setOffset((o) => (o < -width / 2 ? -width : 0));
    },
    onPointerCancel: () => { startRef.current = null; setOffset(0); },
  };

  return { offset, revealed, close, handlers };
}

// "40 × 8 · 7 · 6" for the collapsed line. Working sets only; one weight when the
// session held it, per-set weights when it ramped; bodyweight rows are reps alone.
function summarizeSets(sets) {
  const done = sets.filter((s) => !isBlank(s.reps) && s.set_type !== 'warmup');
  if (!done.length) return '';
  // 0 kg is bodyweight (dead hang, plank) — reps alone say it better than "0 × 37".
  const weights = done.map((s) => (isBlank(s.weight_kg) || Number(s.weight_kg) === 0 ? null : Number(s.weight_kg)));
  const uniform = weights.every((w) => w === weights[0]);
  if (uniform) {
    const reps = done.map((s) => s.reps).join(' · ');
    return weights[0] == null ? reps : `${weights[0]} × ${reps}`;
  }
  return done.map((s, i) => (weights[i] == null ? `${s.reps}` : `${weights[i]}×${s.reps}`)).join(' · ');
}

function CheckIcon({ size = 14 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Three states, decided by the page: 'done' (every set has reps) collapses to one line
// of what you did; 'next' is a muted one-liner with the prescription and the aim's
// weight so you can see what's coming; 'open' is the ledger. Typical scroll: one
// exercise. Tap a collapsed line to open it.
function ExerciseBlock({ block, workoutId, state, onToggle, onOpenPicker, onChange, onTargetChange, onRemove, suggestion, onFocusChange }) {
  const qc = useQueryClient();
  const [showNote, setShowNote] = useState(false);
  // Open the editor whenever a note already exists, so an existing note is never
  // hidden behind the menu — and stays open while typing the first one.
  const [editingNote, setEditingNote] = useState(false);
  // Collapse transient state when the exercise is swapped for a different one.
  useEffect(() => { setShowNote(false); setEditingNote(false); }, [block.exercise_id]);
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
  // A swapped-in exercise still sits in its routine slot (routine_exercise_id), so the
  // preference can be promoted from here instead of a detour through Program.
  const isSwapped = !!block.routine_exercise_id && !!target && target.exercise_id !== block.exercise_id;
  const makeDefault = useMutation({
    mutationFn: () => makeDefaultExercise(workoutId, { routine_exercise_id: block.routine_exercise_id, exercise_id: block.exercise_id }),
    onSuccess: (data) => {
      onTargetChange(data.target);
      qc.invalidateQueries({ queryKey: ['suggestions'] });
      qc.invalidateQueries({ queryKey: ['active-program'] });
      qc.invalidateQueries({ queryKey: ['program'] });
    },
    onError: (err) => alert(err?.response?.data?.error || 'Could not update the routine'),
  });
  const repRange = target && (target.rep_range_low || target.rep_range_high)
    ? `${target.rep_range_low || '?'}–${target.rep_range_high || '?'}`
    : null;
  const warmupLabel = formatWarmup(target?.warmup_sets_low, target?.warmup_sets_high);

  // The prescription, as one muted line rather than a row of chips: it is kept, it
  // just stops competing with the aim. RIR targets ride in the RIR column as ghosts
  // too; the at-a-glance version stays here by request (2026-08-22) — uniform targets
  // collapse to one number, mixed ones (mains at 2,2,1) show the sequence.
  const setsLabel = target?.target_sets
    ? (repRange ? `${target.target_sets} × ${repRange}` : `${target.target_sets} sets`)
    : (repRange ? `${repRange} reps` : null);
  const prescription = [];
  if (setsLabel) prescription.push(setsLabel);
  if (target?.rest_seconds != null || target?.rest_seconds_high != null) {
    prescription.push(`${formatRestRange(target.rest_seconds, target.rest_seconds_high)} rest`);
  }
  const rirTargets = Array.isArray(target?.target_rir_per_set) ? target.target_rir_per_set.filter((r) => r != null) : [];
  if (rirTargets.length) {
    const uniform = rirTargets.every((r) => r === rirTargets[0]);
    prescription.push(uniform ? `RIR ${rirTargets[0]}` : `RIR ${rirTargets.join('·')}`);
  }
  if (warmupLabel) prescription.push(warmupLabel);

  const aim = suggestion?.aim ?? null;
  const cues = suggestion?.cues ?? [];

  const addSet = () => {
    track('tap', 'add-set', { exercise_id: block.exercise_id });
    const nextNum = (block.sets[block.sets.length - 1]?.set_number || 0) + 1;
    onChange({ ...block, sets: [...block.sets, { set_number: nextNum, reps: null, weight_kg: null, rir: null, set_type: 'working' }] });
  };
  // Warm-ups go in at the top, ahead of the working sets, and everything renumbers.
  // The routine can prescribe them but the ledger only ever knew W by tapping a set
  // number, so a prescribed warm-up was a row you had to invent.
  const addWarmup = () => {
    track('tap', 'add-warmup', { exercise_id: block.exercise_id });
    const rows = [{ reps: null, weight_kg: null, rir: null, set_type: 'warmup', logged_at: null }, ...block.sets];
    onChange({ ...block, sets: rows.map((r, i) => ({ ...r, set_number: i + 1 })) });
  };
  const hasWarmup = block.sets.some((s) => s.set_type === 'warmup');
  // The set's timestamp is born here, the first time reps land on the row — the same
  // moment the row turns green. One chokepoint covers typing and the PREV tap alike.
  // Rest between sets is derived from these stamps later; there is deliberately no
  // visible timer (removed 2026-08-10 — he rests by his Garmin), and this must never
  // grow into one. Clearing the reps clears the stamp; editing them later keeps it,
  // because the first completion is the honest rest marker.
  const updateSet = (i, u) => {
    const before = block.sets[i];
    const next = { ...u };
    const repsNow = !(next.reps == null || next.reps === '');
    const repsBefore = !(before?.reps == null || before?.reps === '');
    if (repsNow && !repsBefore && !next.logged_at) next.logged_at = new Date().toISOString();
    if (!repsNow) next.logged_at = null;
    onChange({ ...block, sets: block.sets.map((s, j) => (j === i ? next : s)) });
  };
  const removeSet = (i) => track('tap', 'remove-set') || onChange({
    ...block,
    sets: block.sets.filter((_, j) => j !== i).map((s, j) => ({ ...s, set_number: j + 1 })),
  });

  if (state === 'done') {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={false}
        className="w-full min-h-11 py-1.5 flex items-center gap-2 text-left text-sm"
      >
        <span className="text-emerald-400 shrink-0"><CheckIcon /></span>
        <span className="font-medium text-neutral-400 min-w-0 truncate">{block.exercise_name || 'Exercise'}</span>
        <span className="ml-auto shrink-0 text-neutral-400 tabular-nums">{summarizeSets(block.sets)}</span>
      </button>
    );
  }
  if (state === 'next') {
    const aimWeight = aim?.weight_kg != null && Number(aim.weight_kg) !== 0
      ? `${aim.action === 'increase' ? '↑ ' : ''}${Math.round(aim.weight_kg * 100) / 100} kg`
      : aim?.reps != null ? `${aim.reps} reps` : null;
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={false}
        className="w-full min-h-11 py-1.5 flex items-center gap-2 text-left text-sm"
      >
        <span className="text-neutral-400 min-w-0 truncate">{block.exercise_name || 'Pick an exercise'}</span>
        <span className="ml-auto shrink-0 text-neutral-400 tabular-nums text-xs">
          {[setsLabel, aimWeight].filter(Boolean).join(' · ')}
        </span>
      </button>
    );
  }

  return (
    <div
      className="py-3"
      // Focus-within, reported to the page: React's focus/blur bubble, and a blur whose
      // relatedTarget is still inside the block is a move between fields, not a leave.
      onFocus={() => onFocusChange?.(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) onFocusChange?.(false); }}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onOpenPicker}
          className="flex items-center gap-1.5 text-left flex-1 min-w-0 -mx-2 px-2 min-h-11 rounded hover:bg-neutral-800 transition-colors"
        >
          {/* Wraps rather than truncates: "Barbell Overhead Press" cut to "Barbell
              Overhea…" is worse than a second line. */}
          <span className="font-semibold text-neutral-200 min-w-0">
            {block.exercise_name || 'Pick an exercise'}
          </span>
          {isMain && <MainBadge className="shrink-0" />}
          <span className="text-neutral-400 shrink-0">
            <ChevronIcon open={false} />
          </span>
        </button>
        {/* Swap lives on the name; everything rarer sits behind ⋯ so the header is
            just the name. */}
        <MoreMenu
          label={`Options for ${block.exercise_name || 'exercise'}`}
          items={[
            // Two different notes, deliberately named apart: the program's coaching cue
            // (routine_exercises.notes, read-only) vs his own log for this session
            // (workout_exercises.notes, editable below).
            target?.notes && { label: showNote ? 'Hide how-to' : 'How to do this', onSelect: () => { track('tap', 'how-to-toggle'); setShowNote((v) => !v); } },
            { label: block.notes ? 'Edit my note' : 'Add my note', onSelect: () => { track('tap', 'exercise-note'); setEditingNote(true); } },
            isSwapped && {
              label: 'Make this the default',
              confirm: 'Update routine — sure?',
              onSelect: () => { track('tap', 'make-default', { exercise_id: block.exercise_id }); makeDefault.mutate(); },
            },
            { label: 'Collapse', onSelect: onToggle },
            { label: 'Remove exercise', confirm: 'Remove — sure?', danger: true, onSelect: () => { track('tap', 'remove-exercise'); onRemove(); } },
          ]}
        />
      </div>

      <AimLine aim={aim} cues={cues} />
      {prescription.length > 0 && (
        <p className="text-xs text-neutral-400 tabular-nums mb-1.5">{prescription.join(' · ')}</p>
      )}

      {target?.notes && showNote && (
        <p className="text-xs text-neutral-400 mb-1.5 whitespace-pre-line">
          <span className="section-label mr-1.5">How to</span>{target.notes}
        </p>
      )}

      {/* Your note on THIS exercise, distinct from target.notes above (the program's
          prescription, read-only). Rides the same autosave as the sets — serializePayload
          already carries notes per exercise — so there is nothing to save by hand. */}
      {editingNote || block.notes ? (
        <textarea
          className="input w-full mb-1.5 min-h-[2.75rem]"
          rows={2}
          autoFocus={editingNote && !block.notes}
          placeholder={`Your note on ${block.exercise_name || 'this exercise'} — how it felt, form, niggles`}
          aria-label={`Your note on ${block.exercise_name || 'this exercise'}`}
          value={block.notes || ''}
          onChange={(e) => onChange({ ...block, notes: e.target.value })}
          onBlur={() => setEditingNote(false)}
        />
      ) : null}

      {block.sets.length > 0 && (
        <div className={`${LEDGER_COLS} h-6 text-[11px] font-semibold uppercase tracking-wider text-neutral-400`} aria-hidden="true">
          <span className="pl-2">Set</span>
          {/* "Prev · RIR" rather than "Prev": the column now carries kg × reps AND the
              RIR that came with them, and an unlabelled trailing number reads as noise. */}
          <span>Prev · RIR</span>
          <span className="text-center">kg</span>
          <span className="text-center">Reps</span>
          <span className="text-center">RIR</span>
        </div>
      )}
      <div>
        {block.sets.map((s, i) => (
          <SetRow
            key={i}
            set={s}
            previousSet={prevBySet[s.set_number]}
            showPrev={hasPrev}
            // The RIR ghost echoes the aim when the coach set one ("take it to RIR 1"
            // beats the program's 2); otherwise the program's per-set target.
            targetRir={aim?.source === 'coach' && aim.rir != null
              ? aim.rir
              : Array.isArray(target?.target_rir_per_set) ? target.target_rir_per_set[i] ?? null : null}
            aim={s.set_type === 'warmup' ? null : aim}
            onChange={(u) => updateSet(i, u)}
            onRemove={() => removeSet(i)}
          />
        ))}
      </div>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={addSet}
          className="h-11 pl-2 pr-2 -ml-2 text-sm text-neutral-400 hover:text-neutral-200 rounded transition-colors"
        >
          + Add set
        </button>
        {warmupLabel && !hasWarmup && (
          <button
            type="button"
            onClick={addWarmup}
            className="h-11 px-2 text-sm text-neutral-400 hover:text-neutral-200 rounded transition-colors"
          >
            + Warm-up
          </button>
        )}
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
      ? { set_number: num, reps: s.reps, weight_kg: s.weight_kg == null ? null : Number(s.weight_kg), rir: s.rir, set_type: s.set_type || 'working', logged_at: s.logged_at || null }
      : { set_number: num, reps: null, weight_kg: null, rir: null, set_type: 'working', logged_at: null };
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
          routine_exercise_id: ex.routine_exercise_id ?? null,
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
              return { set_number: s.set_number, reps, weight_kg, rir, set_type: s.set_type || 'working', logged_at: s.logged_at || null, logged };
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
  const [finished, setFinished] = useState(null); // summary for the FinishSheet, once completed
  const [notesOpen, setNotesOpen] = useState(false);
  // Which exercise the ledger is open on. null = the first one not yet done; a tap on a
  // collapsed line pins it; NONE = the user collapsed the open one and wants the bare
  // list (a review of a finished session). Finishing the pinned exercise's last set
  // unpins so the next one opens on its own. (Auto-collapse: Boostcamp's pattern — the
  // scroll is one exercise, not the whole workout.)
  const [pinned, setPinned] = useState(null);
  // The exercise the keyboard is in. Done is "every set has reps", and reps is the
  // field before RIR — so typing the last set's reps collapsed the ledger under his
  // thumb before the RIR could go in (2026-09-10). Focus leaving the block (keyboard
  // dismissed, a tap elsewhere) is the signal he is finished with it; until then a
  // done exercise stays open.
  const [typingIn, setTypingIn] = useState(null);
  const flushRef = useRef(null);       // latest flush(), for the retry timer to call
  const mountedRef = useRef(true);
  // The save loop lives in util/saveLoop.js so its invariants can be tested without a
  // browser — single flight, always settles, never reports clean on a failure. Three
  // gym sessions were lost or blocked to bugs in this loop while it was inline and
  // untestable (2026-08-13, and twice on 08-17).
  const loopRef = useRef(null);
  if (loopRef.current == null) {
    loopRef.current = createSaveLoop({
      send: (payload, opts) => updateWorkout(id, JSON.parse(payload), opts),
      onStatus: (status) => {
        track('save', status, status === 'error' ? { stalls: loopRef.current?.stalls ?? 0 } : undefined, Number(id));
        // The ref is safe after unmount; the setState is not. A save settling after the
        // page has gone would warn and do nothing useful.
        if (status === 'saved') dirtySinceRef.current = null;
        if (!mountedRef.current) return;
        if (status === 'saved') setDirtyFor(null);
        setAutosave(status);
      },
      onSaved: (updated) => { qc.setQueryData(['workout', id], updated); },
      canRetry: () => mountedRef.current,
    });
  }
  const loop = loopRef.current;
  useEffect(() => {
    // Set on mount too, not just the ref initializer — otherwise a remount (React
    // StrictMode, or any re-mount) leaves it false and silently freezes the save
    // status, so a later failed save never surfaces as an error.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loopRef.current?.cancelRetry();
    };
  }, []);
  const setAutosaveIfMounted = useCallback((v) => { if (mountedRef.current) setAutosave(v); }, []);

  // Reflects the last *completed* session, so the workout being logged right now doesn't
  // move the goalposts underneath itself.
  // Keyed by routine as well as name: the same exercise is prescribed different rep
  // ranges on different days, so one cached "suggestions" list served all three routines
  // the wrong answer for two of them.
  const routineId = workout?.routine_id ?? null;
  const { data: suggestions = [] } = useQuery({
    queryKey: ['suggestions', routineId],
    queryFn: () => getSuggestions(routineId),
    // Wait for the workout, so the first fetch already knows its routine. A routine_id
    // of null is legitimate (the routine was retired) and falls back to program-wide.
    enabled: hydrated,
    staleTime: 5 * 60_000,
  });
  // Session-wide coach guidance (no exercise attached). Per-exercise notes no longer
  // come from here: /suggestions folds them into each exercise's `aim` and `cues`, so
  // the precedence between note and engine is decided once, on the server.
  const { data: coachNotes = [] } = useQuery({
    queryKey: ['coach-notes'],
    queryFn: getCoachNotes,
    staleTime: 5 * 60_000,
  });
  const generalNotes = useMemo(
    () => coachNotes.filter((n) => n.exercise_id == null
      && (n.routine_id == null || n.routine_id === workout?.routine_id)),
    [coachNotes, workout?.routine_id]
  );

  const suggestionByExercise = useMemo(
    () => Object.fromEntries((suggestions || []).map((s) => [s.exercise_id, s])),
    [suggestions]
  );

  const [recovered, setRecovered] = useState(false);
  const [dirtyFor, setDirtyFor] = useState(null);
  const dirtySinceRef = useRef(null);
  // Whole minutes since the unsaved streak began, recomputed by the heartbeat rather
  // than a timer of its own, so it costs nothing while everything is working. Declared
  // HERE, below the state it reads: above it, `dirtyFor` is in the temporal dead zone
  // and the page throws on render. The bundler compiles that without complaint.
  const staleMinutes = dirtyFor ? Math.floor((Date.now() - dirtyFor) / 60_000) : 0;

  const { loggedSets, plannedSets } = useMemo(() => {
    let logged = 0;
    let planned = 0;
    for (const ex of exercises) {
      for (const s of ex.sets) {
        planned += 1;
        // Same reps-are-the-signal rule as the row tint — a pre-loaded weight must
        // not advance "X of N logged".
        if (!isBlank(s.reps)) logged += 1;
      }
    }
    return { loggedSets: logged, plannedSets: planned };
  }, [exercises]);

  // Done = every set has reps (the same reps-are-the-signal rule as the row tint). An
  // exercise with no rows can't be done — it is still waiting on you.
  const isDone = (ex) => ex.sets.length > 0 && ex.sets.every((s) => !isBlank(s.reps));
  const doneIds = useMemo(() => new Set(exercises.filter(isDone).map((ex) => ex.client_id)), [exercises]);
  const firstOpenId = exercises.find((ex) => !doneIds.has(ex.client_id))?.client_id ?? null;
  // Unpin on the not-done → done transition only. A done exercise reopened by hand
  // stays open until you tap away; one you just finished collapses.
  const prevDoneRef = useRef(doneIds);
  useEffect(() => {
    if (pinned != null && doneIds.has(pinned) && !prevDoneRef.current.has(pinned)) setPinned(null);
    prevDoneRef.current = doneIds;
  }, [doneIds, pinned]);
  const exists = (cid) => cid != null && exercises.some((ex) => ex.client_id === cid);
  const openId = pinned === NONE ? null
    : exists(pinned) ? pinned
    : (exists(typingIn) && doneIds.has(typingIn)) ? typingIn
    : firstOpenId;

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
    // Workout notes must come from the draft too: the payload is the complete pending
    // state, and taking only its sets silently discarded typed-but-unsaved notes.
    let draftNotes = null;
    let usedDraft = false;
    if (draft?.payload) {
      try {
        const parsed = JSON.parse(draft.payload);
        for (const ex of parsed.exercises || []) {
          draftSets[ex.exercise_id] = ex.sets || [];
        }
        // null is a real value here (a deliberately cleared note); only a payload
        // with no notes key at all leaves the server's copy alone.
        if ('notes' in parsed) draftNotes = parsed.notes || '';
        usedDraft = Object.keys(draftSets).length > 0 || draftNotes !== null;
      } catch { /* corrupt draft — fall through to server data */ }
    }
    const notesValue = draftNotes !== null ? draftNotes : (workout.notes || '');

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
        routine_exercise_id: e.routine_exercise_id ?? null,
        exercise_name: e.exercise_name,
        muscle_group: e.muscle_group,
        notes: e.notes || '',
        target: e.target,
        sets,
      };
    });

    setExercises(rows);
    setNotes(notesValue);
    // Baseline is the *server's* state, so recovered edits register as unsaved and get
    // flushed as soon as there's a connection again.
    loop.setBaseline(JSON.stringify(serializePayload(
      workout.exercises.map((e) => ({ ...e, sets: hydrateSets(e) })),
      workout.notes || ''
    )));
    loop.setPending(JSON.stringify(serializePayload(rows, notesValue)));
    setRecovered(usedDraft && loop.isDirty());
    setHydrated(true);
    // Keep the shape the page was built from, so a cold reload with no network can render
    // it. Skipped when this render *is* the snapshot — rewriting it would be a no-op.
    if (!usingSnapshot) saveSnapshot(id, workout);
    pruneDrafts();
  }, [workout, isFetchedAfterMount, isError, hydrated, id, usingSnapshot]);

  // Thin delegate: the loop owns the ordering and retry rules; this just clears the
  // local draft once the server genuinely has everything.
  const flush = useCallback(() => {
    const run = loop.flush();
    run.then(() => { if (!loop.isDirty()) clearDraft(id); });
    return run;
  }, [loop, id]);
  flushRef.current = flush;

  // Debounced autosave: record the latest payload, mark it unsaved right away so the
  // status is honest during the debounce window, then flush after a pause.
  useEffect(() => {
    if (!hydrated) return;
    loop.setPending(JSON.stringify(serializePayload(exercises, notes)));
    if (!loop.isDirty()) return;
    // Written before the network is even attempted: the point is to survive the app
    // being killed while offline, which is exactly when the PUT won't land.
    saveDraft(id, loop.pending);
    if (dirtySinceRef.current == null) dirtySinceRef.current = Date.now();
    if (autosave !== 'saving') setAutosaveIfMounted('unsaved');
    const t = setTimeout(flush, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercises, notes, hydrated, flush]);

  // Guard against losing unsaved edits to a refresh or accidental navigation.
  useEffect(() => {
    const handler = (e) => {
      if (loop.isDirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // Self-healing kick, both directions. On the way to hidden: per the Page Lifecycle
  // guidance, this is the LAST reliable moment on mobile — Android kills backgrounded
  // PWAs without firing beforeunload or unmounting React, so waiting out the debounce
  // means a set typed just before pocketing the phone reaches the server only when the
  // screen next wakes. On the way back to visible (or when the network returns): a
  // frozen debounce timer or a watchdog-aborted attempt gets retried at exactly the
  // moment the user is looking at the indicator again.
  useEffect(() => {
    const kick = () => {
      if (loop.isDirty()) {
        flushRef.current?.();
      }
    };
    document.addEventListener('visibilitychange', kick);
    window.addEventListener('online', kick);
    window.addEventListener('focus', kick);
    return () => {
      document.removeEventListener('visibilitychange', kick);
      window.removeEventListener('online', kick);
      window.removeEventListener('focus', kick);
    };
  }, []);

  // Navigating away mid-debounce cleared the save timer without ever attempting the
  // PUT, stranding the edit in the local draft. Fire one last flush on unmount — the
  // request outlives the component, and the draft stays until the server confirms.
  useEffect(() => () => {
    if (loopRef.current?.isDirty()) {
      flushRef.current?.();
    }
  }, []);

  // A wedged loop used to need him to leave the page and come back. The loop now ages
  // out a hung run on its own, but only when something calls flush — so something has to
  // call it. Cheap: one comparison every ten seconds, and it does nothing when clean.
  useEffect(() => {
    let seenStalls = 0;
    // Not `id` — that is the workout id from useParams, and shadowing it here loses the
    // one thing the stall event most needs to be attached to.
    const timer = setInterval(() => {
      // The wedge itself, reported the moment the watchdog acts on it. Without this the
      // only trace of a stall is an absence of PUTs, which is what made the last four
      // so hard to pin down.
      const stalls = loopRef.current?.stalls ?? 0;
      if (stalls > seenStalls) {
        track('save', 'stalled', { stalls, events: loopRef.current?.getEvents().slice(-12) }, Number(id));
        seenStalls = stalls;
      }
      if (loopRef.current?.isDirty()) flushRef.current?.();
      // Drives the "not saved for N minutes" wording below.
      setDirtyFor(loopRef.current?.isDirty() ? (dirtySinceRef.current || Date.now()) : null);
    }, 10_000);
    return () => clearInterval(timer);
  }, [id]);

  const saveNow = useCallback(() => {
    loop.setPending(JSON.stringify(serializePayload(exercises, notes)));
    return flush();
  }, [exercises, notes, flush]);

  // `force` completes the workout even when the last edits have not landed. Being
  // stranded mid-session is the worse failure: on 2026-08-20 the loop wedged and the
  // only way out was a workaround nobody would guess. Nothing is discarded — the draft
  // survives, the loop keeps retrying, and re-opening the workout flushes it. The
  // confirm below says plainly what is and is not on the server.
  // What the session added up to, for the FinishSheet. Progressions compare each
  // exercise's working sets with the previous session already cached on the block
  // (['last-by-exercise', …]); PRs come from the personal-bests list, which only
  // counts completed workouts — hence fetched after completion. Both are best-effort:
  // a PB fetch failing must not stand between him and the summary.
  const buildSummary = async (completed) => {
    const working = (sets) => sets.filter((x) => x.set_type !== 'warmup' && !isBlank(x.reps));
    const maxKg = (sets) => {
      const ws = sets.map((x) => (isBlank(x.weight_kg) ? null : Number(x.weight_kg))).filter((w) => w != null);
      return ws.length ? Math.max(...ws) : null;
    };
    const repsAt = (sets, kg) => sets
      .filter((x) => (kg == null ? isBlank(x.weight_kg) : Number(x.weight_kg) === kg))
      .reduce((a, x) => a + Number(x.reps), 0);
    const progressions = [];
    let volume = 0;
    for (const ex of exercises) {
      const now = working(ex.sets);
      // Added load only, floored at zero: an assisted pull-up logs the assistance as a
      // negative and must not subtract from the session. The server's volume figures
      // fold bodyweight in (util/volume.js); this is the number for the sheet, not stats.
      for (const x of now) volume += Math.max(0, isBlank(x.weight_kg) ? 0 : Number(x.weight_kg)) * Number(x.reps);
      const prev = working(qc.getQueryData(['last-by-exercise', ex.exercise_id, id])?.sets || []);
      if (!now.length || !prev.length) continue;
      const nowKg = maxKg(now);
      const prevKg = maxKg(prev);
      if (nowKg != null && prevKg != null && nowKg > prevKg) {
        progressions.push({ exercise_id: ex.exercise_id, exercise_name: ex.exercise_name, detail: `${prevKg} → ${nowKg} kg` });
      } else if (nowKg === prevKg && repsAt(now, nowKg) > repsAt(prev, prevKg)) {
        progressions.push({ exercise_id: ex.exercise_id, exercise_name: ex.exercise_name, detail: `+${repsAt(now, nowKg) - repsAt(prev, prevKg)} reps${nowKg != null ? ` at ${nowKg} kg` : ''}` });
      }
    }
    let prs = [];
    try {
      const pbs = await qc.fetchQuery({ queryKey: ['personal-bests'], queryFn: getPersonalBests, staleTime: 0 });
      const inSession = new Map(exercises.map((ex) => [ex.exercise_id, ex]));
      prs = pbs
        .filter((pb) => pb.date === workout.date && inSession.has(pb.exercise_id))
        // A first-ever session is trivially a "best"; only a best that beat history counts.
        .filter((pb) => working(qc.getQueryData(['last-by-exercise', pb.exercise_id, id])?.sets || []).length > 0)
        .map((pb) => ({ exercise_id: pb.exercise_id, exercise_name: pb.exercise_name, detail: `${pb.best_weight != null ? `${Number(pb.best_weight)} kg × ` : ''}${pb.reps}` }));
    } catch { /* summary without PRs */ }
    const facts = [
      completed?.duration_minutes ? `${completed.duration_minutes} min` : null,
      `${loggedSets} set${loggedSets === 1 ? '' : 's'}`,
      volume > 0 ? `${Math.round(volume).toLocaleString()} kg` : null,
    ].filter(Boolean).join(' · ');
    return { title: workout.routine_name || 'Workout', facts, progressions, prs };
  };

  const finish = useMutation({
    mutationFn: async ({ force = false } = {}) => {
      await saveNow(); // ensure the latest edits are persisted before completing
      if (loop.isDirty() && !force) {
        const err = new Error('Could not save your latest changes — check your connection and try again.');
        err.name = 'UnsavedChangesError';
        throw err;
      }
      const completed = await completeWorkout(id);
      return buildSummary(completed);
    },
    onSuccess: (summary, variables) => {
      // Only when the server genuinely has everything. Forced through with edits still
      // pending, the draft is the only copy of them and must outlive the navigation.
      if (!loop.isDirty()) clearDraft(id);
      else if (variables?.force) flushRef.current?.();
      // The workout's own entry too: the autosave keeps it warm via setQueryData, so
      // without this the detail page reads a cached copy that still says in_progress
      // and renders "Workout complete" next to an IN PROGRESS badge.
      qc.invalidateQueries({ queryKey: ['workout', id] });
      qc.invalidateQueries({ queryKey: ['active-program'] });
      qc.invalidateQueries({ queryKey: ['recent-workouts'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['suggestions'] });
      qc.invalidateQueries({ queryKey: ['muscle-volume'] });
      qc.invalidateQueries({ queryKey: ['in-progress-workout'] });
      // Summary and rating before leaving, not after arriving. On the destination page
      // they sat above the exercise list and were scrolled past; here they are the only
      // thing on screen at the one moment the answer is still accurate. The workout is
      // already completed by this point, so the sheet can be dismissed without consequence.
      setFinished(summary);
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
      <div className="py-20 text-center space-y-3">
        <p className="text-neutral-400">Couldn’t load this workout. Check your connection and try again.</p>
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
    if (loop.isDirty()) {
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
        routine_exercise_id: null,
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

  const finishError = doneError
    || (skip.isError ? 'Could not skip the workout.' : null)
    || (finish.isError ? (finish.error?.message || 'Could not finish the workout.') : null);
  const progress = plannedSets > 0 ? Math.min(100, Math.round((loggedSets / plannedSets) * 100)) : 0;

  return (
    <div className="space-y-4">
      {finished && (
        <FinishSheet
          workoutId={id}
          {...finished}
          onDone={() => {
            setFinished(null);
            navigate(`/workouts/${id}`);
          }}
        />
      )}
      {/* The header: back, routine, how far through and how long, Finish, ⋯. Pinned on
          both breakpoints (under the desktop nav). Replaces the global header on mobile
          (hidden by Navbar during a session) AND the old fixed bottom bar — Finish is
          up here now, which is 60px of ledger back at every scroll position. The 3px
          bar underneath is the hairline doing double duty as the progress bar. */}
      <div className="sticky top-0 md:top-14 z-10 -mx-4 bg-neutral-950">
        <div className="px-4 h-12 flex items-center gap-1">
          <button
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="shrink-0 -ml-3 w-11 h-11 flex items-center justify-center text-neutral-400 hover:text-neutral-200"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate text-neutral-200 leading-tight">
              {workout.routine_name || 'Workout'}
            </p>
            <p className="text-xs text-neutral-400 tabular-nums truncate leading-tight flex items-center gap-1">
              <span>{loggedSets}/{plannedSets} sets</span>
              {isCompleted
                ? workout.duration_minutes && <span>·&nbsp;{workout.duration_minutes} min</span>
                : <span>·&nbsp;<Elapsed since={workout.created_at} /></span>}
              <SaveStatus status={autosave} staleMinutes={staleMinutes} onRetry={() => saveNow()} />
            </p>
          </div>
          {isCompleted ? (
            <button
              onClick={doneEditing}
              disabled={autosave === 'saving'}
              className="btn-primary min-h-0 h-9 px-3 shrink-0"
            >
              {autosave === 'saving' ? 'Saving…' : 'Done'}
            </button>
          ) : (
            <button
              onClick={() => { if (confirm('Finish this workout?')) { track('tap', 'finish', undefined, Number(id)); finish.mutate({}); } }}
              disabled={finish.isPending || skip.isPending}
              className="btn-primary min-h-0 h-9 px-3 shrink-0"
            >
              {finish.isPending ? '…' : 'Finish'}
            </button>
          )}
          <MoreMenu
            label="Session options"
            items={[
              { label: 'Add exercise', onSelect: () => { track('tap', 'add-exercise'); setPicker({ mode: 'add' }); } },
              { label: notes ? 'Workout notes' : 'Add workout notes', onSelect: () => setNotesOpen(true) },
              !isCompleted && {
                label: 'Skip this workout',
                confirm: 'Skip — sure?',
                danger: true,
                onSelect: () => { if (!skip.isPending && !finish.isPending) skip.mutate(); },
              },
            ]}
          />
        </div>
        {finishError && (
          <div className="px-4 pb-2">
            <p className="text-xs text-red-400">{finishError}</p>
            {/* The escape hatch. Blocked on a save that will not land, the alternative
                is standing in the gym repeating a workaround — so offer the exit, and
                be specific about the trade rather than hiding it behind "are you
                sure?". The sets stay on the phone and sync when they can. */}
            {finish.error?.name === 'UnsavedChangesError' && (
              <button
                type="button"
                onClick={() => {
                  if (confirm(
                    'Finish anyway?\n\nYour most recent sets have not reached the server yet. '
                    + 'They stay saved on this phone and will sync when the connection recovers — '
                    + 'reopen the workout later to check they arrived.'
                  )) { track('tap', 'finish-anyway', { stalls: loop.stalls }, Number(id)); finish.mutate({ force: true }); }
                }}
                className="btn-secondary text-xs mt-1.5"
              >
                Finish anyway
              </button>
            )}
          </div>
        )}
        <div className="h-[3px] bg-neutral-800" role="progressbar" aria-valuenow={loggedSets} aria-valuemax={plannedSets} aria-label="Sets logged">
          <div className="h-full bg-emerald-700 transition-[width] duration-300" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {(isCompleted || usingSnapshot || (recovered && !usingSnapshot && autosave !== 'saved')) && (
        <div className="space-y-1">
          {isCompleted && (
            <p className="text-xs text-neutral-400">
              Editing {formatDay(workout.date, { weekday: 'long', month: 'short', day: 'numeric' })} — changes save automatically.
            </p>
          )}
          {usingSnapshot && (
            <p className="text-xs text-amber-400">
              Offline — showing this session from your device. Keep logging; it saves when you reconnect.
            </p>
          )}
          {recovered && !usingSnapshot && autosave !== 'saved' && (
            <p className="text-xs text-amber-400">
              Restored sets that hadn’t reached the server. They’ll save once you’re back online.
            </p>
          )}
        </div>
      )}

      {/* Session-wide coach guidance (no exercise attached) sits above the ledger,
          where the session-level facts live. Two lines here, the rest in a sheet. */}
      {generalNotes.length > 0 && (
        <div>
          {generalNotes.map((n) => <GeneralNote key={n.id} note={n.note} />)}
        </div>
      )}
      {/* Hairline dividers between exercises instead of card borders — the ledger gets
          its structure from alignment, not boxes. */}
      <div className="divide-y divide-neutral-800" data-editor-root onKeyDown={handleEditorEnter}>
        {exercises.map((ex, i) => (
          <ExerciseBlock
            key={ex.client_id}
            block={ex}
            workoutId={id}
            state={ex.client_id === openId ? 'open' : doneIds.has(ex.client_id) ? 'done' : 'next'}
            onToggle={() => {
              track('tap', ex.client_id === openId ? 'exercise-collapse' : 'exercise-open');
              setPinned(ex.client_id === openId ? NONE : ex.client_id);
            }}
            onOpenPicker={() => setPicker({ mode: 'replace', forIndex: i })}
            onChange={(u) => setExercises(exercises.map((x, j) => j === i ? u : x))}
            onTargetChange={(target) => setExercises((prev) => prev.map((x) => x.client_id === ex.client_id ? { ...x, target } : x))}
            onRemove={() => setExercises(exercises.filter((_, j) => j !== i))}
            suggestion={suggestionByExercise[ex.exercise_id]}
            onFocusChange={(inside) => setTypingIn((cur) => (inside ? ex.client_id : cur === ex.client_id ? null : cur))}
          />
        ))}
        {exercises.length === 0 && (
          <p className="py-6 text-sm text-neutral-400 text-center">No exercises yet — add one from ⋯.</p>
        )}
      </div>

      {(notesOpen || notes) && (
        <section className="pt-1">
          <label className="section-label block mb-1.5" htmlFor="wt-workout-notes">Workout notes</label>
          {/* field-sizing grows the box with its contents; rows={2} is the floor and the
              fallback on browsers without it. Capped so a long note scrolls within the
              box instead of pushing the ledger about. */}
          <textarea
            id="wt-workout-notes"
            className="input resize-none [field-sizing:content] max-h-[40vh]"
            rows={2}
            autoFocus={notesOpen && !notes}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => { if (!notes) setNotesOpen(false); }}
          />
        </section>
      )}

      <ExercisePickerSheet
        open={!!picker}
        onClose={() => setPicker(null)}
        onSelect={handlePickerSelect}
        {...pickerProps}
      />
    </div>
  );
}

// A session-level coach note: two lines on the page, the whole thing on tap.
function GeneralNote({ note }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full text-left text-xs text-amber-400 line-clamp-2 py-1"
      >
        <span className="font-semibold uppercase tracking-wider text-[10.5px] mr-1.5">Coach</span>
        {note}
      </button>
      {open && (
        <Sheet title="Coach" onClose={() => setOpen(false)}>
          <div className="p-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] overflow-y-auto">
            <p className="text-sm text-neutral-300 whitespace-pre-line">{note}</p>
          </div>
        </Sheet>
      )}
    </>
  );
}

function WorkoutSessionSkeleton() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-3 w-64" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-3 pt-3 border-t border-neutral-800">
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
