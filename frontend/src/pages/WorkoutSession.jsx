import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { getWorkout, updateWorkout, completeWorkout, skipWorkout, getLastByExercise, getSuggestions, getCoachNotes } from '../api/client';
import { Skeleton } from '../components/Skeleton';
import ExercisePickerSheet from '../components/ExercisePickerSheet';
import MainBadge from '../components/MainBadge';
import { ChevronIcon } from '../components/icons';
import { selectOnFocus, handleEditorEnter } from './program/helpers';
import { formatRestRange, formatWarmup, formatDay } from '../utils/format';
import { createSaveLoop } from '../util/saveLoop';
import FinishRatingSheet from '../components/FinishRatingSheet';
import { saveDraft, saveSnapshot, readDraft, clearDraft, pruneDrafts } from '../utils/draft';
import MoreMenu from '../components/MoreMenu';
import { track } from '../util/telemetry';

const isBlank = (v) => v === '' || v == null;

function TargetChip({ children }) {
  return <span className="tag">{children}</span>;
}

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

// The pinned strip is the only status a phone can see once you have scrolled into the
// sets — the full sentence in the page body has long since scrolled away. A bare dot
// left the two states that matter indistinguishable without knowing the colour code,
// and they mean opposite things: amber is "still working on it", red is "your last
// set is not on the server". So the two states worth acting on carry a word; the
// steady-state ones stay a quiet dot.
const SAVE_SHORT = { saving: null, saved: null, unsaved: 'Unsaved', error: 'Not saved' };

function SaveStatusDot({ status }) {
  if (status === 'idle') return null;
  const word = SAVE_SHORT[status];
  return (
    <span className="shrink-0 flex items-center gap-1.5" role="status" aria-label={SAVE_LABEL[status]} title={SAVE_LABEL[status]}>
      <span className={`shrink-0 w-2.5 h-2.5 rounded-full ${SAVE_TONE[status]}`} />
      {word && (
        <span className={`text-[11px] font-medium whitespace-nowrap ${
          status === 'error' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-500'
        }`}>
          {word}
        </span>
      )}
    </span>
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

// Grid template shared by the header row and every set row, so the columns can't drift.
const LEDGER_COLS = 'grid grid-cols-[2.5rem_1fr_4rem_4rem_3.25rem] items-center';

// The ledger row — one 44px line per set, the layout Strong and Hevy converged on.
// No boxed inputs: values are bare text in tappable cells, last session's numbers sit
// in the empty cells as placeholders, and tapping PREV copies them in. Cells, not
// boxes, is where the density comes from; the row itself is still a 44px target.
// There used to be a tick column and a rest timer (removed 2026-08-10 — the owner
// rests by Garmin, and with the timer gone the tick was a second button for what the
// PREV tap already does). The green done-tint stays, keyed off the row carrying reps.
function SetRow({ set, previousSet, showPrev, targetRir, suggestion, onChange, onRemove }) {
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
  // prev-as-placeholder duplicated the PREV column one cell over). Increase: the
  // suggested weight at the bottom of the range. Hold: same weight, beat last time's
  // reps by one, capped at the top of the range. No suggestion: plain unit labels.
  const ghostWeight = suggestion?.suggested_weight_kg ?? null;
  const ghostReps = suggestion == null
    ? null
    : suggestion.action === 'increase'
      ? suggestion.suggested_reps_low ?? null
      : previousSet?.reps != null
        ? Math.min(previousSet.reps + 1, suggestion.suggested_reps_high ?? previousSet.reps + 1)
        : suggestion.suggested_reps_low ?? null;

  const typeLabel = SET_TYPE_LABEL[set.set_type || 'working'];
  const cellInput = 'w-full h-11 bg-transparent border-0 p-0 text-center text-base tabular-nums text-neutral-900 dark:text-neutral-200 placeholder:text-neutral-400 dark:placeholder:text-neutral-600 focus:outline-none focus:bg-neutral-100 dark:focus:bg-neutral-800/70 rounded-md transition-colors';

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
          done ? 'bg-emerald-50 dark:bg-emerald-500/10 rounded-lg' : 'bg-white dark:bg-neutral-950'
        }`}
      >
        <button
          type="button"
          onClick={() => { if (revealed) { close(); return; } onChange({ ...set, set_type: nextSetType(set.set_type) }); }}
          title={SET_TYPE_TITLE[set.set_type || 'working']}
          aria-label={`Set ${set.set_number}: ${set.set_type || 'working'} — tap to change type`}
          className={`h-11 text-xs tabular-nums text-left pl-2 rounded-md font-medium ${
            set.set_type === 'warmup'
              ? 'text-amber-600 dark:text-amber-500'
              : set.set_type === 'drop' || set.set_type === 'failure'
                ? 'text-purple-600 dark:text-purple-400'
                : 'text-neutral-500 dark:text-neutral-400'
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
          className="h-11 min-w-0 truncate text-left text-xs tabular-nums text-neutral-500 dark:text-neutral-400 disabled:text-neutral-400 dark:disabled:text-neutral-600 rounded-md"
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

function ExerciseBlock({ block, workoutId, onOpenPicker, onChange, onRemove, suggestion, coachNote }) {
  const [showNote, setShowNote] = useState(false);
  const [showReason, setShowReason] = useState(false);
  // Open the editor whenever a note already exists, so an existing note is never
  // hidden behind the menu — and stays open while typing the first one.
  const [editingNote, setEditingNote] = useState(false);
  // Collapse transient state when the exercise is swapped for a different one.
  useEffect(() => { setShowNote(false); setShowReason(false); setEditingNote(false); }, [block.exercise_id]);
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

  // Everything the old suggestion box said, as a row of chips (owner preference over the
  // muted text line). RIR targets aren't here — they ride in the RIR column as ghost
  // placeholders. The suggestion chip keeps its colour; its reason expands on tap.
  const metaChips = [];
  if (target?.target_sets) metaChips.push(repRange ? `${target.target_sets} × ${repRange}` : `${target.target_sets} sets`);
  else if (repRange) metaChips.push(`${repRange} reps`);
  if (target?.rest_seconds != null || target?.rest_seconds_high != null) {
    metaChips.push(`${formatRestRange(target.rest_seconds, target.rest_seconds_high)} rest`);
  }
  // Back by request (2026-08-22): the per-set targets still ghost in the RIR column,
  // but he wants the at-a-glance version in the chip row too. Uniform targets collapse
  // to one number; mixed ones (e.g. mains at 2,2,1) show the sequence.
  const rirTargets = Array.isArray(target?.target_rir_per_set) ? target.target_rir_per_set.filter((r) => r != null) : [];
  if (rirTargets.length) {
    const uniform = rirTargets.every((r) => r === rirTargets[0]);
    metaChips.push(uniform ? `RIR ${rirTargets[0]}` : `RIR ${rirTargets.join('·')}`);
  }
  if (warmupLabel) metaChips.push(warmupLabel);

  const hasSuggestion = suggestion && suggestion.action !== 'no_history' && suggestion.action !== 'no_target';
  const suggestionLabel = hasSuggestion
    ? `${suggestion.action === 'increase' ? 'Add load —' : 'Hold'} ${suggestion.suggested_weight_kg != null ? `${suggestion.suggested_weight_kg} kg` : ''}`.trim()
    : null;

  const addSet = () => {
    track('tap', 'add-set', { exercise_id: block.exercise_id });
    const nextNum = (block.sets[block.sets.length - 1]?.set_number || 0) + 1;
    onChange({ ...block, sets: [...block.sets, { set_number: nextNum, reps: null, weight_kg: null, rir: null, set_type: 'working' }] });
  };
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

  return (
    <div className="py-3">
      <div className="flex items-center gap-1">
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
            { label: 'Remove exercise', confirm: 'Remove — sure?', danger: true, onSelect: () => { track('tap', 'remove-exercise'); onRemove(); } },
          ]}
        />
      </div>

      {/* Standing guidance from coaching conversations — the call that would otherwise
          be forgotten by Saturday. Rendered next to the suggestion chip on purpose:
          when they disagree (the engine is note-blind — it reads sets, never notes),
          this is the one that wins, and the two need to be visible together for that
          to be legible. Amber, always visible, no tap required. */}
      {coachNote && (
        <p className="text-xs text-amber-700 dark:text-amber-500 mt-1 mb-0.5">
          Coach: {coachNote.note}
        </p>
      )}
      {(metaChips.length > 0 || suggestionLabel) && (
        <div className="flex flex-wrap items-center gap-1.5 mt-1 mb-1.5">
          {metaChips.map((c) => <TargetChip key={c}>{c}</TargetChip>)}
          {suggestionLabel && (
            <button
              type="button"
              onClick={() => setShowReason((v) => !v)}
              aria-expanded={showReason}
              className="py-2.5 -my-2.5"
            >
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] uppercase tracking-wide font-medium ${
                suggestion.action === 'increase'
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400'
                  : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
              }`}>
                {suggestionLabel}
              </span>
            </button>
          )}
        </div>
      )}

      {showReason && hasSuggestion && (
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-1.5">
          {suggestion.suggested_weight_kg != null && (
            <>{suggestion.suggested_weight_kg} kg × {suggestion.suggested_reps_low}–{suggestion.suggested_reps_high} · </>
          )}
          {suggestion.reason}
        </p>
      )}

      {target?.notes && showNote && (
        <p className="text-xs text-neutral-600 dark:text-neutral-400 mb-1.5 whitespace-pre-line">
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
        <div className={`${LEDGER_COLS} h-6 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400`} aria-hidden="true">
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
            targetRir={Array.isArray(target?.target_rir_per_set) ? target.target_rir_per_set[i] ?? null : null}
            suggestion={hasSuggestion ? suggestion : null}
            onChange={(u) => updateSet(i, u)}
            onRemove={() => removeSet(i)}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={addSet}
        className="h-11 pl-2 pr-4 -ml-2 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 rounded transition-colors"
      >
        + Add set
      </button>
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
  const [ratingOpen, setRatingOpen] = useState(false);
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
  // Standing coach guidance, matched to this workout's exercises. Cheap and cached —
  // notes change between sessions, not during them.
  const { data: coachNotes = [] } = useQuery({
    queryKey: ['coach-notes'],
    queryFn: getCoachNotes,
    staleTime: 5 * 60_000,
  });
  const noteByExercise = useMemo(() => {
    const map = {};
    for (const n of coachNotes) {
      if (n.routine_id != null && n.routine_id !== workout?.routine_id) continue;
      if (n.exercise_id != null) map[n.exercise_id] = n;
    }
    return map;
  }, [coachNotes, workout?.routine_id]);
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

  // The fixed action bar changes height (save error), and content has to be
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
        // Same reps-are-the-signal rule as the row tint — a pre-loaded weight must
        // not advance "X of N logged".
        if (!isBlank(s.reps)) logged += 1;
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
  const finish = useMutation({
    mutationFn: async ({ force = false } = {}) => {
      await saveNow(); // ensure the latest edits are persisted before completing
      if (loop.isDirty() && !force) {
        const err = new Error('Could not save your latest changes — check your connection and try again.');
        err.name = 'UnsavedChangesError';
        throw err;
      }
      return completeWorkout(id);
    },
    onSuccess: (_data, variables) => {
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
      // Ask for the rating before leaving, not after arriving. On the destination page
      // it sits above the exercise list and is scrolled past; here it is the only thing
      // on screen at the one moment the answer is still accurate. The workout is already
      // completed by this point, so the sheet can be skipped without consequence.
      setRatingOpen(true);
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
      {ratingOpen && (
        <FinishRatingSheet
          workoutId={id}
          summary={`${loggedSets} set${loggedSets === 1 ? '' : 's'}${workout.duration_minutes ? ` · ${workout.duration_minutes} min` : ''}`}
          onDone={() => {
            setRatingOpen(false);
            navigate(`/workouts/${id}`, { state: { justFinished: true } });
          }}
        />
      )}
      {/* Replaces the global header on mobile (hidden by Navbar during a session): the
          pinned strip carries the routine, how far through you are and the save state,
          rather than the app's own name. */}
      <div className="md:hidden sticky top-0 z-10 -mx-4 px-4 h-12 flex items-center gap-3 bg-white dark:bg-neutral-950 border-b border-neutral-200 dark:border-neutral-900">
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
              : autosave === 'unsaved' ? (staleMinutes >= 1
                  ? `Not saved for ${staleMinutes} min — still trying`
                  : 'Unsaved changes…')
              : 'Couldn’t save — retrying…'}
          </p>
        )}
      </div>

      {/* Session-wide coach guidance (no exercise attached) sits above the ledger,
          where the session-level facts live. */}
      {generalNotes.length > 0 && (
        <div className="mb-2">
          {generalNotes.map((n) => (
            <p key={n.id} className="text-xs text-amber-700 dark:text-amber-500 mt-0.5">
              Coach: {n.note}
            </p>
          ))}
        </div>
      )}
      {/* Hairline dividers between exercises instead of card borders — the ledger gets
          its structure from alignment, not boxes. */}
      <div className="divide-y divide-neutral-200 dark:divide-neutral-800" data-editor-root onKeyDown={handleEditorEnter}>
        {exercises.map((ex, i) => (
          <ExerciseBlock
            key={ex.client_id}
            block={ex}
            workoutId={id}
            onOpenPicker={() => setPicker({ mode: 'replace', forIndex: i })}
            onChange={(u) => setExercises(exercises.map((x, j) => j === i ? u : x))}
            onRemove={() => setExercises(exercises.filter((_, j) => j !== i))}
            suggestion={suggestionByExercise[ex.exercise_id]}
            coachNote={noteByExercise[ex.exercise_id]}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={() => setPicker({ mode: 'add' })}
        className="w-full h-12 text-sm font-medium text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 border border-dashed border-neutral-200 dark:border-neutral-800 rounded hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
      >
        + Add exercise
      </button>

      <section className="pt-1">
        <label className="section-label block mb-1.5" htmlFor="wt-workout-notes">Workout notes</label>
        {/* field-sizing grows the box with its contents; rows={2} is the floor and the
            fallback on browsers without it. Capped so a long note scrolls within the
            box instead of pushing Finish off screen. */}
        <textarea
          id="wt-workout-notes"
          className="input resize-none [field-sizing:content] max-h-[40vh]"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </section>

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
            <div className="pt-2">
              <p className="text-xs text-red-600 dark:text-red-400">
                {doneError
                  || (skip.isError ? 'Could not skip the workout.' : null)
                  || finish.error?.message
                  || 'Could not finish the workout.'}
              </p>
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
                onClick={() => { if (confirm('Finish this workout?')) { track('tap', 'finish', undefined, Number(id)); finish.mutate({}); } }}
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
        <div key={i} className="space-y-3 pt-3 border-t border-neutral-200 dark:border-neutral-800">
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
