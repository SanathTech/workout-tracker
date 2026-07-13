import { useState, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { startProgram, endProgram, deleteProgram, startWorkout } from '../../api/client';
import { formatRest, formatWarmup } from '../../utils/format';
import { ChevronIcon } from '../../components/icons';
import MainBadge from '../../components/MainBadge';

export default function ProgramView({ program, onEdit, onDeleted }) {
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

  // Collapse routines by default so the page stays scannable on mobile; open the
  // one that's up next (or the first, when nothing is queued). Follows the next
  // routine as it advances so the open card stays aligned with the "Next" badge.
  const defaultOpenId = nextRoutine?.id ?? program.routines[0]?.id;
  const [openRoutines, setOpenRoutines] = useState(() => new Set());
  useEffect(() => {
    setOpenRoutines(defaultOpenId != null ? new Set([defaultOpenId]) : new Set());
  }, [defaultOpenId]);
  const toggleRoutine = (id) => setOpenRoutines((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">{program.name}</h1>
          <p className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            {program.total_weeks ? `${program.total_weeks} weeks` : 'Ongoing'} · {program.routines.length} routines · {program.status}
          </p>
          {program.description && <ClampedDescription text={program.description} />}
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

        <div className="flex flex-wrap gap-2">
          {!isActive && program.status !== 'completed' && (
            <button onClick={() => startMut.mutate()} disabled={startMut.isPending} className="btn-primary">
              {startMut.isPending ? '…' : 'Start program'}
            </button>
          )}
          <button onClick={onEdit} className="btn-secondary">Edit</button>
          {isActive && (
            <button
              onClick={() => { if (confirm('End this program early? It will be archived.')) endMut.mutate(); }}
              disabled={endMut.isPending}
              className="btn-secondary"
            >{endMut.isPending ? 'Ending…' : 'End'}</button>
          )}
          {program.status !== 'active' && (
            <button
              onClick={() => { if (confirm(`Delete "${program.name}"? Any unfinished workout will be discarded. Completed history is kept.`)) deleteMut.mutate(); }}
              disabled={deleteMut.isPending}
              className="btn-ghost"
            >{deleteMut.isPending ? 'Deleting…' : 'Delete'}</button>
          )}
        </div>
      </div>

      {program.routines.map((r, i) => {
        const open = openRoutines.has(r.id);
        const isNext = nextRoutine?.id === r.id;
        return (
          <div
            key={r.id}
            className={`card ${isNext ? 'border-neutral-900 dark:border-neutral-100' : ''}`}
          >
            <button
              type="button"
              onClick={() => toggleRoutine(r.id)}
              aria-expanded={open}
              className="flex items-center gap-2 w-full text-left"
            >
              <span className="text-sm text-neutral-400 w-6 shrink-0">{String(i + 1).padStart(2, '0')}</span>
              <h2 className="font-semibold truncate">{r.name}</h2>
              {isNext && <span className="badge-solid ml-1 shrink-0">Next</span>}
              <span className="text-xs text-neutral-500 dark:text-neutral-400 ml-auto shrink-0">{r.exercises.length} exercises</span>
              <span className="text-neutral-400 dark:text-neutral-500 shrink-0"><ChevronIcon open={open} /></span>
            </button>
            {open && (
              <div className="space-y-2 mt-3">
                {r.exercises.map((ex) => {
                  const warmup = formatWarmup(ex.warmup_sets_low, ex.warmup_sets_high);
                  return (
                  <div key={ex.id} className={`flex items-start gap-3 text-sm border-t border-neutral-200 dark:border-neutral-800 pt-2 ${ex.is_main ? 'pl-2 border-l-2 border-l-amber-400 dark:border-l-amber-500/60' : ''}`}>
                    <div className="flex-1">
                      <p className="font-medium text-neutral-900 dark:text-neutral-100 flex items-center gap-1.5">
                        <span className="truncate">{ex.exercise_name}</span>
                        {ex.is_main && <MainBadge className="shrink-0" />}
                      </p>
                      <p className="text-xs text-neutral-500 dark:text-neutral-400">
                        {warmup && `${warmup} · `}
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
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ClampedDescription({ text }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef(null);

  useEffect(() => { setExpanded(false); }, [text]);
  useEffect(() => {
    if (expanded) return; // only measure while clamped, or scrollHeight === clientHeight
    const el = ref.current;
    if (el) setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [text, expanded]);

  return (
    <div>
      <p
        ref={ref}
        className={`text-sm text-neutral-500 dark:text-neutral-400 whitespace-pre-line ${expanded ? '' : 'line-clamp-2'}`}
      >
        {text}
      </p>
      {(overflows || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs font-medium text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 mt-1"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}
