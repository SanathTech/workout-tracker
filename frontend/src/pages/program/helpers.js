import { formatRestRange } from '../../utils/format';

export const dashedAddBtn = 'w-full text-center py-2 min-h-11 md:min-h-0 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 border border-dashed border-neutral-200 dark:border-neutral-800 rounded hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors';
export const iconBtn = 'text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 w-11 h-11 flex items-center justify-center rounded shrink-0';

export const genId = () => crypto.randomUUID();

export function emptyExercise() {
  return {
    client_id: genId(),
    exercise_id: '',
    target_sets: null,
    rep_range_low: null,
    rep_range_high: null,
    target_rir_per_set: [],
    rest_seconds: null,
    rest_seconds_high: null,
    notes: '',
    is_main: false,
    substitutes: [],
  };
}

export const selectOnFocus = (e) => e.target.select();

export function emptyRoutine(name = '') {
  return { client_id: genId(), name, exercises: [emptyExercise()] };
}

function formatRirArray(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  if (arr.every((v) => v == null)) return null;
  return arr.map((v) => v == null ? '–' : v).join('/');
}

export function summarizeExercise(ex) {
  const chips = [];
  if (ex.target_sets) chips.push(`${ex.target_sets} sets`);
  if (ex.rep_range_low || ex.rep_range_high) {
    chips.push(`${ex.rep_range_low ?? '?'}–${ex.rep_range_high ?? '?'} reps`);
  }
  const rirStr = formatRirArray(ex.target_rir_per_set);
  if (rirStr) chips.push(`RIR ${rirStr}`);
  if (ex.rest_seconds != null || ex.rest_seconds_high != null) {
    chips.push(`${formatRestRange(ex.rest_seconds, ex.rest_seconds_high)} rest`);
  }
  return chips;
}

export function handleEditorEnter(e) {
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
