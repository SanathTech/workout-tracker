import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSessionFeel, saveSessionFeel } from '../api/client';
import RatingRow from './RatingRow';

// Asked once, on the completion band, right after Finish — the only moment the answer
// is still accurate. It is never required: an unrated session is data the coach simply
// doesn't have, which is better than a number invented three days later.
export default function SessionFeel({ workoutId }) {
  const qc = useQueryClient();
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');

  const { data: feel } = useQuery({
    queryKey: ['session-feel', workoutId],
    queryFn: () => getSessionFeel(workoutId),
    staleTime: 60_000,
  });

  const save = useMutation({
    mutationFn: (patch) => saveSessionFeel({ workout_id: Number(workoutId), ...patch }),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ['session-feel', workoutId] });
      const previous = qc.getQueryData(['session-feel', workoutId]);
      qc.setQueryData(['session-feel', workoutId], (old) => ({ ...(old || {}), ...patch }));
      return { previous };
    },
    onError: (_e, _p, ctx) => qc.setQueryData(['session-feel', workoutId], ctx?.previous),
    onSettled: () => qc.invalidateQueries({ queryKey: ['session-feel', workoutId] }),
  });

  return (
    <div className="mt-3 pt-3 border-t border-neutral-200 dark:border-neutral-800">
      <RatingRow
        label="How hard?" hint="RPE 1–10"
        max={10}
        value={feel?.rpe ?? null}
        onPick={(n) => save.mutate({ rpe: n })}
      />
      {feel?.note && !noteOpen && (
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1 italic">“{feel.note}”</p>
      )}
      {noteOpen ? (
        <form
          className="flex gap-2 mt-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) save.mutate({ note: note.trim() });
            setNote('');
            setNoteOpen(false);
          }}
        >
          <input
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Niggles, energy, anything off?"
            className="input flex-1 py-1.5"
          />
          <button type="submit" className="btn-secondary px-4">Save</button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => { setNote(feel?.note || ''); setNoteOpen(true); }}
          className="btn-ghost text-xs mt-1 -ml-1"
        >
          {feel?.note ? 'Edit note' : '+ Add a note'}
        </button>
      )}
    </div>
  );
}
