import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getExercises, getExerciseGroups, createExercise, deleteExercise } from '../api/client';

const muscleColors = {
  Chest: 'bg-red-100 text-red-700 border-red-200',
  Back: 'bg-blue-100 text-blue-700 border-blue-200',
  Shoulders: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  Legs: 'bg-green-100 text-green-700 border-green-200',
  Arms: 'bg-purple-100 text-purple-700 border-purple-200',
  Core: 'bg-orange-100 text-orange-700 border-orange-200',
};

function AddExerciseModal({ onClose }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [muscle_group, setMuscleGroup] = useState('');
  const [description, setDescription] = useState('');

  const { data: groups = [] } = useQuery({ queryKey: ['exercise-groups'], queryFn: getExerciseGroups });

  const { mutate: save, isPending } = useMutation({
    mutationFn: createExercise,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exercises'] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Add Exercise</h2>
          <button onClick={onClose} className="btn-ghost">✕</button>
        </div>
        <div>
          <label className="label">Exercise Name *</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cable Fly" required />
        </div>
        <div>
          <label className="label">Muscle Group *</label>
          <div className="flex gap-2">
            <select className="input flex-1" value={muscle_group} onChange={(e) => setMuscleGroup(e.target.value)}>
              <option value="">Select…</option>
              {groups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <input
              className="input flex-1"
              placeholder="Or type new…"
              value={muscle_group}
              onChange={(e) => setMuscleGroup(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input resize-none" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" />
        </div>
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button
            disabled={!name || !muscle_group || isPending}
            onClick={() => save({ name, muscle_group, description })}
            className="btn-primary flex-1"
          >
            {isPending ? 'Saving…' : 'Add Exercise'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ExerciseLibrary() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [filterGroup, setFilterGroup] = useState('');
  const [showModal, setShowModal] = useState(false);

  const { data: groups = [] } = useQuery({ queryKey: ['exercise-groups'], queryFn: getExerciseGroups });
  const { data: exercises = [], isLoading } = useQuery({
    queryKey: ['exercises', { search, muscle_group: filterGroup }],
    queryFn: () => getExercises({ search: search || undefined, muscle_group: filterGroup || undefined }),
  });

  const { mutate: remove } = useMutation({
    mutationFn: deleteExercise,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['exercises'] }),
  });

  // Group exercises by muscle group for display
  const grouped = exercises.reduce((acc, ex) => {
    (acc[ex.muscle_group] = acc[ex.muscle_group] || []).push(ex);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Exercise Library</h1>
        <button onClick={() => setShowModal(true)} className="btn-primary">+ Add Exercise</button>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <input
          className="input max-w-xs"
          placeholder="Search exercises…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setFilterGroup('')}
            className={`badge border cursor-pointer ${!filterGroup ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-gray-100 text-gray-600 border-gray-200'}`}
          >
            All
          </button>
          {groups.map((g) => (
            <button
              key={g}
              onClick={() => setFilterGroup(filterGroup === g ? '' : g)}
              className={`badge border cursor-pointer ${filterGroup === g ? (muscleColors[g] || 'bg-gray-100 text-gray-600 border-gray-200') : 'bg-gray-100 text-gray-600 border-gray-200'}`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <p className="text-gray-400 text-center py-20">Loading…</p>
      ) : exercises.length === 0 ? (
        <p className="text-gray-400 text-center py-20">No exercises found.</p>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([group, exs]) => (
            <div key={group}>
              <h2 className="font-semibold text-base mb-3 flex items-center gap-2">
                <span className={`badge border ${muscleColors[group] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>{group}</span>
                <span className="text-gray-400 text-sm font-normal">{exs.length} exercises</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {exs.map((ex) => (
                  <div key={ex.id} className="card flex items-start gap-3 py-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{ex.name}</p>
                      {ex.description && (
                        <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">{ex.description}</p>
                      )}
                    </div>
                    <button
                      onClick={() => { if (confirm(`Delete "${ex.name}"?`)) remove(ex.id); }}
                      className="btn-ghost text-red-300 hover:text-red-500 px-2 py-1 shrink-0"
                    >
                      🗑️
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && <AddExerciseModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
