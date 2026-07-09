import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { startProgram, endProgram, deleteProgram, startWorkout } from '../../api/client';
import { formatRest } from '../../utils/format';

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
