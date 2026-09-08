import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createCoachNote, updateCoachNote } from '../api/client';
import { Sheet } from './ui';
import { track } from '../util/telemetry';

// Where a load call gets written from the phone (2026-09-08, PR 4). Before this the only
// way "OHP back to 40" reached the app was a coach_notes row inserted from a coaching
// conversation. The sheet edits the note behind a COACH aim, or creates one when the
// engine is speaking; either way the same row, the same precedence (util/aim.js), so the
// session shows the call next time. Resolve hands the aim back to the engine.
//
// Prefilled from whatever the aim currently says, so a tweak is one field, not four.

const numOrNull = (v) => (v === '' ? null : Number(v));

export default function AimEditSheet({ exercise, aim, note, onClose }) {
  const qc = useQueryClient();
  const editing = aim?.source === 'coach' && note;
  const [weight, setWeight] = useState(editing ? (note.aim_weight_kg ?? '') : (aim?.weight_kg ?? ''));
  const [reps, setReps] = useState(editing ? (note.aim_reps ?? '') : (aim?.reps ?? ''));
  const [rir, setRir] = useState(editing ? (note.aim_rir ?? '') : (aim?.rir ?? ''));
  const [text, setText] = useState(editing ? note.note : '');
  const [error, setError] = useState('');

  const done = () => {
    // Every aim reader: the session and Today read by routine, Lifts unscoped.
    qc.invalidateQueries({ queryKey: ['suggestions'] });
    qc.invalidateQueries({ queryKey: ['coach-notes'] });
    onClose();
  };

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        note: text.trim(),
        aim_weight_kg: numOrNull(weight),
        aim_reps: numOrNull(reps),
        aim_rir: numOrNull(rir),
      };
      return editing
        ? updateCoachNote(note.id, payload)
        : createCoachNote({ exercise_id: exercise.id, ...payload });
    },
    onSuccess: () => {
      track('save', editing ? 'aim-edit' : 'aim-create', { exercise_id: exercise.id });
      done();
    },
    onError: (e) => setError(e?.response?.data?.error || 'Couldn’t save. Try again.'),
  });

  const resolve = useMutation({
    mutationFn: () => updateCoachNote(note.id, { resolved: true }),
    onSuccess: () => {
      track('save', 'aim-resolve', { exercise_id: exercise.id });
      done();
    },
    onError: () => setError('Couldn’t resolve. Try again.'),
  });

  const hasCall = weight !== '' || reps !== '' || rir !== '';
  const valid = hasCall || text.trim() !== '';
  const busy = save.isPending || resolve.isPending;

  const submit = (e) => {
    e.preventDefault();
    setError('');
    if (!valid) { setError('Give it a number or a note.'); return; }
    save.mutate();
  };

  const field = 'input w-full h-11 tabular-nums text-center';

  return (
    <Sheet title={`${editing ? 'Aim' : 'Set the aim'} · ${exercise.name}`} onClose={onClose}>
      <form onSubmit={submit} className="p-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <span className="section-label block mb-1">kg</span>
            <input type="number" inputMode="decimal" step="0.5" value={weight} onChange={(e) => setWeight(e.target.value)} className={field} placeholder="—" />
          </label>
          <label className="block">
            <span className="section-label block mb-1">reps</span>
            <input type="number" inputMode="numeric" min="0" step="1" value={reps} onChange={(e) => setReps(e.target.value)} className={field} placeholder="—" />
          </label>
          <label className="block">
            <span className="section-label block mb-1">RIR</span>
            <input type="number" inputMode="numeric" min="0" max="10" step="1" value={rir} onChange={(e) => setRir(e.target.value)} className={field} placeholder="—" />
          </label>
        </div>
        <label className="block">
          <span className="section-label block mb-1">Why</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            className="input w-full resize-none"
            placeholder="Shows as the reason behind the aim, in the session and here."
          />
        </label>
        <p className="text-xs text-neutral-400">
          {hasCall
            ? 'A coach call beats the engine until you resolve it — the session shows this instead of the progression.'
            : 'With no numbers this is a cue: it rides under whatever aim shows.'}
        </p>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex gap-2">
          {editing && (
            <button
              type="button"
              onClick={() => resolve.mutate()}
              disabled={busy}
              className="btn-secondary flex-1 justify-center"
            >
              {resolve.isPending ? 'Resolving…' : 'Resolve'}
            </button>
          )}
          <button type="submit" disabled={busy || !valid} className="btn-primary flex-1 justify-center">
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
        {editing && (
          <p className="text-xs text-neutral-400">Resolve keeps the note in the ledger but hands the aim back to the engine.</p>
        )}
      </form>
    </Sheet>
  );
}
