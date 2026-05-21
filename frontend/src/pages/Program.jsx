import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  getActiveProgram, getPrograms, getProgram, createProgram, updateProgram,
  deleteProgram, startProgram, endProgram, getExercises,
} from '../api/client';

function emptyExercise() {
  return {
    exercise_id: '',
    target_sets: 3,
    rep_range_low: 8,
    rep_range_high: 12,
    target_rir: 1,
    rest_seconds: 120,
    notes: '',
    substitutes: [],
  };
}
function emptyRoutine(name = '') {
  return { name, exercises: [emptyExercise()] };
}

function groupByMuscle(exercises) {
  return exercises.reduce((acc, ex) => {
    (acc[ex.muscle_group] = acc[ex.muscle_group] || []).push(ex);
    return acc;
  }, {});
}

function ExerciseEditor({ ex, allExercises, onChange, onRemove }) {
  const grouped = useMemo(() => groupByMuscle(allExercises), [allExercises]);
  const addSub = () => onChange({ ...ex, substitutes: [...ex.substitutes, { exercise_id: '' }] });

  return (
    <div className="border border-gray-200 rounded-xl p-3 space-y-2">
      <div className="flex gap-2">
        <select
          className="input flex-1"
          value={ex.exercise_id}
          onChange={(e) => onChange({ ...ex, exercise_id: e.target.value })}
        >
          <option value="">Select exercise…</option>
          {Object.entries(grouped).map(([g, exs]) => (
            <optgroup key={g} label={g}>
              {exs.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </optgroup>
          ))}
        </select>
        <button type="button" onClick={onRemove} className="btn-ghost text-red-400 px-2">🗑️</button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400">Sets</label>
          <input type="number" min="1" className="input" value={ex.target_sets}
            onChange={(e) => onChange({ ...ex, target_sets: parseInt(e.target.value) || 1 })} />
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400">Reps low</label>
          <input type="number" min="1" className="input" value={ex.rep_range_low ?? ''}
            onChange={(e) => onChange({ ...ex, rep_range_low: e.target.value ? parseInt(e.target.value) : null })} />
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400">Reps high</label>
          <input type="number" min="1" className="input" value={ex.rep_range_high ?? ''}
            onChange={(e) => onChange({ ...ex, rep_range_high: e.target.value ? parseInt(e.target.value) : null })} />
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400">RIR</label>
          <input type="number" min="0" className="input" value={ex.target_rir ?? ''}
            onChange={(e) => onChange({ ...ex, target_rir: e.target.value !== '' ? parseInt(e.target.value) : null })} />
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400">Rest (s)</label>
          <input type="number" min="0" className="input" value={ex.rest_seconds ?? ''}
            onChange={(e) => onChange({ ...ex, rest_seconds: e.target.value ? parseInt(e.target.value) : null })} />
        </div>
      </div>

      <input className="input" placeholder="Notes (optional)" value={ex.notes || ''}
        onChange={(e) => onChange({ ...ex, notes: e.target.value })} />

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500 dark:text-gray-400">Preset substitutes</span>
          <button type="button" onClick={addSub} className="text-xs text-blue-600 hover:underline">+ Add substitute</button>
        </div>
        {ex.substitutes.map((sub, i) => (
          <div key={i} className="flex gap-2">
            <select
              className="input flex-1"
              value={sub.exercise_id || ''}
              onChange={(e) => {
                const subs = ex.substitutes.map((s, j) => j === i ? { ...s, exercise_id: e.target.value } : s);
                onChange({ ...ex, substitutes: subs });
              }}
            >
              <option value="">Select substitute…</option>
              {Object.entries(grouped).map(([g, exs]) => (
                <optgroup key={g} label={g}>
                  {exs.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </optgroup>
              ))}
            </select>
            <button type="button" onClick={() => {
              onChange({ ...ex, substitutes: ex.substitutes.filter((_, j) => j !== i) });
            }} className="btn-ghost text-red-400 px-2">✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function RoutineEditor({ routine, allExercises, onChange, onRemove }) {
  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2">
        <input
          className="input font-medium"
          value={routine.name}
          placeholder="Routine name (e.g. Upper 1)"
          onChange={(e) => onChange({ ...routine, name: e.target.value })}
        />
        <button type="button" onClick={onRemove} className="btn-ghost text-red-400 px-2">🗑️</button>
      </div>

      <div className="space-y-2">
        {routine.exercises.map((ex, i) => (
          <ExerciseEditor
            key={i}
            ex={ex}
            allExercises={allExercises}
            onChange={(updated) => onChange({
              ...routine,
              exercises: routine.exercises.map((e, j) => j === i ? updated : e),
            })}
            onRemove={() => onChange({
              ...routine,
              exercises: routine.exercises.filter((_, j) => j !== i),
            })}
          />
        ))}
        <button
          type="button"
          onClick={() => onChange({ ...routine, exercises: [...routine.exercises, emptyExercise()] })}
          className="btn-secondary w-full"
        >
          + Add exercise
        </button>
      </div>
    </div>
  );
}

function ProgramEditor({ initial, onCancel, onSaved }) {
  const qc = useQueryClient();
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [totalWeeks, setTotalWeeks] = useState(initial?.total_weeks || 12);
  const [routines, setRoutines] = useState(
    initial?.routines?.length
      ? initial.routines.map((r) => ({
          name: r.name,
          exercises: r.exercises.map((re) => ({
            exercise_id: String(re.exercise_id),
            target_sets: re.target_sets,
            rep_range_low: re.rep_range_low,
            rep_range_high: re.rep_range_high,
            target_rir: re.target_rir,
            rest_seconds: re.rest_seconds,
            notes: re.notes || '',
            substitutes: (re.substitutes || []).map((s) => ({ exercise_id: String(s.exercise_id) })),
          })),
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
        .map((ex) => ({
          exercise_id: parseInt(ex.exercise_id),
          target_sets: ex.target_sets,
          rep_range_low: ex.rep_range_low,
          rep_range_high: ex.rep_range_high,
          target_rir: ex.target_rir,
          rest_seconds: ex.rest_seconds,
          notes: ex.notes || null,
          substitutes: ex.substitutes
            .filter((s) => s.exercise_id)
            .map((s) => ({ exercise_id: parseInt(s.exercise_id) })),
        })),
    }));
    save.mutate({ name, description, total_weeks: parseInt(totalWeeks) || 12, routines: cleaned });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="card space-y-3">
        <div>
          <label className="label">Program name *</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Phase 2 Min-Max, 5x/week" required />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input resize-none" rows={2} value={description}
            onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="w-32">
          <label className="label">Total weeks</label>
          <input type="number" min="1" className="input" value={totalWeeks}
            onChange={(e) => setTotalWeeks(e.target.value)} />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg">Routines</h2>
          <button type="button" onClick={() => setRoutines([...routines, emptyRoutine()])} className="btn-secondary">
            + Add routine
          </button>
        </div>
        {routines.map((r, i) => (
          <RoutineEditor
            key={i}
            routine={r}
            allExercises={allExercises}
            onChange={(u) => setRoutines(routines.map((x, j) => j === i ? u : x))}
            onRemove={() => setRoutines(routines.filter((_, j) => j !== i))}
          />
        ))}
      </div>

      <div className="flex gap-2 sticky bottom-2 pt-2">
        <button type="button" onClick={onCancel} className="btn-secondary flex-1">Cancel</button>
        <button type="submit" disabled={save.isPending} className="btn-primary flex-1 justify-center">
          {save.isPending ? 'Saving…' : initial?.id ? 'Save changes' : 'Create program'}
        </button>
      </div>
    </form>
  );
}

function ProgramView({ program, onEdit }) {
  const qc = useQueryClient();
  const startMut = useMutation({
    mutationFn: () => startProgram(program.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['active-program'] });
      qc.invalidateQueries({ queryKey: ['programs'] });
    },
  });
  const endMut = useMutation({
    mutationFn: () => endProgram(program.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['active-program'] });
      qc.invalidateQueries({ queryKey: ['programs'] });
    },
  });
  const deleteMut = useMutation({
    mutationFn: () => deleteProgram(program.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['active-program'] });
      qc.invalidateQueries({ queryKey: ['programs'] });
    },
  });

  const isActive = program.status === 'active';

  return (
    <div className="space-y-4">
      <div className="card space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold">{program.name}</h1>
            {program.description && <p className="text-gray-500 mt-1">{program.description}</p>}
            <p className="text-sm text-gray-400 mt-1">
              {program.total_weeks} weeks · {program.routines.length} routines · status: {program.status}
            </p>
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            <button onClick={onEdit} className="btn-secondary text-sm">✏️ Edit</button>
            {!isActive && program.status !== 'completed' && (
              <button onClick={() => startMut.mutate()} className="btn-primary text-sm">
                {startMut.isPending ? '…' : '▶ Start'}
              </button>
            )}
            {isActive && (
              <button
                onClick={() => { if (confirm('End this program early? It will be archived.')) endMut.mutate(); }}
                className="btn-secondary text-sm"
              >End</button>
            )}
            {program.status !== 'active' && (
              <button
                onClick={() => { if (confirm(`Delete "${program.name}"? This removes all its workouts too.`)) deleteMut.mutate(); }}
                className="btn-ghost text-red-400 text-sm"
              >Delete</button>
            )}
          </div>
        </div>
      </div>

      {program.routines.map((r, i) => (
        <div key={r.id} className="card">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm text-gray-400 w-6">{i + 1}.</span>
            <h2 className="font-semibold">{r.name}</h2>
            <span className="text-xs text-gray-400 ml-auto">{r.exercises.length} exercises</span>
          </div>
          <div className="space-y-2">
            {r.exercises.map((ex) => (
              <div key={ex.id} className="flex items-start gap-3 text-sm border-t border-gray-100 pt-2">
                <div className="flex-1">
                  <p className="font-medium">{ex.exercise_name}</p>
                  <p className="text-xs text-gray-500">
                    {ex.target_sets} sets
                    {(ex.rep_range_low || ex.rep_range_high) && ` · ${ex.rep_range_low || '?'}–${ex.rep_range_high || '?'} reps`}
                    {ex.target_rir != null && ` · RIR ${ex.target_rir}`}
                    {ex.rest_seconds && ` · ${ex.rest_seconds}s rest`}
                  </p>
                  {ex.notes && <p className="text-xs text-gray-400 italic mt-0.5">{ex.notes}</p>}
                  {ex.substitutes?.length > 0 && (
                    <p className="text-xs text-gray-400 mt-0.5">
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
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null); // null | 'new' | program object
  const [viewingId, setViewingId] = useState(null);

  const { data: active, isLoading: activeLoading } = useQuery({
    queryKey: ['active-program'],
    queryFn: getActiveProgram,
  });
  const { data: allPrograms = [] } = useQuery({
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
        <button onClick={() => setEditing(null)} className="text-sm text-gray-400 hover:text-gray-600">← Back</button>
        <h1 className="text-2xl font-bold">{editing === 'new' ? 'New Program' : 'Edit Program'}</h1>
        <ProgramEditor
          initial={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={(p) => { setEditing(null); setViewingId(p.id); }}
        />
      </div>
    );
  }

  if (activeLoading) return <p className="text-center text-gray-400 py-20">Loading…</p>;

  const noPrograms = allPrograms.length === 0;
  const displayed = selected || active;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Program</h1>
        <button onClick={() => setEditing('new')} className="btn-primary">+ New Program</button>
      </div>

      {noPrograms && (
        <div className="card text-center py-12 text-gray-400">
          <p className="text-4xl mb-2">📋</p>
          <p>No programs yet. Create one to get started.</p>
          <button onClick={() => setEditing('new')} className="btn-primary mt-4">Create your first program</button>
        </div>
      )}

      {allPrograms.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {allPrograms.map((p) => (
            <button
              key={p.id}
              onClick={() => setViewingId(p.id)}
              className={`badge border cursor-pointer ${
                (displayed?.id === p.id)
                  ? 'bg-blue-100 text-blue-700 border-blue-200'
                  : 'bg-gray-100 text-gray-600 border-gray-200'
              }`}
            >
              {p.name} {p.status === 'active' && '· active'}
            </button>
          ))}
        </div>
      )}

      {displayed && <ProgramView program={displayed} onEdit={() => setEditing(displayed)} />}
    </div>
  );
}
