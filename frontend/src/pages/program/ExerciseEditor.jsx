import { useState, useMemo } from 'react';
import ExercisePickerSheet from '../../components/ExercisePickerSheet';
import MainBadge from '../../components/MainBadge';
import { CloseIcon, ChevronIcon } from '../../components/icons';
import { parseIntOrNull } from '../../utils/format';
import { dashedAddBtn, iconBtn, selectOnFocus, summarizeExercise, handleEditorEnter } from './helpers';

export default function ExerciseEditor({ ex, allExercises, expanded, onToggle, onChange, onRemove }) {
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
            <div className={`flex items-center gap-1.5 ${primary ? 'font-medium text-neutral-900 dark:text-neutral-200' : 'text-neutral-500 dark:text-neutral-500'}`}>
              <span className="truncate">{primary ? primary.name : 'Pick an exercise'}</span>
              {ex.is_main && <MainBadge className="shrink-0" />}
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
            <label className="flex items-end gap-2 pb-2 cursor-pointer select-none">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-neutral-300 dark:border-neutral-700 accent-amber-500"
                checked={ex.is_main === true}
                onChange={(e) => onChange({ ...ex, is_main: e.target.checked })}
              />
              <span className="text-sm text-neutral-700 dark:text-neutral-300">Main lift</span>
            </label>
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
