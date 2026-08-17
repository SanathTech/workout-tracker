import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSessionFeel, saveSessionFeel, updateWorkout } from '../api/client';
import RatingRow from './RatingRow';

// Asked once, on the completion band, right after Finish — the only moment the answer
// is still accurate. Never required: an unrated session is data the coach simply
// doesn't have, which is better than a number invented three days later.
//
// The note here edits the WORKOUT's notes, not a separate field. There used to be a
// session_feel.note alongside it, and the first real user of this band typed the
// identical sentence into both — two boxes asking "anything to say about this
// session?" is one box too many. RPE keeps its own column (it's a rating, not prose);
// session_feel.note stays in the schema but nothing writes it any more.
export default function SessionFeel({ workoutId, workoutNotes }) {
  const qc = useQueryClient();
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');

  const { data: feel } = useQuery({
    queryKey: ['session-feel', workoutId],
    queryFn: () => getSessionFeel(workoutId),
    staleTime: 60_000,
  });

  const saveRpe = useMutation({
    mutationFn: (rpe) => saveSessionFeel({ workout_id: Number(workoutId), rpe }),
    onMutate: async (rpe) => {
      await qc.cancelQueries({ queryKey: ['session-feel', workoutId] });
      const previous = qc.getQueryData(['session-feel', workoutId]);
      qc.setQueryData(['session-feel', workoutId], (old) => ({ ...(old || {}), rpe }));
      return { previous };
    },
    onError: (_e, _p, ctx) => qc.setQueryData(['session-feel', workoutId], ctx?.previous),
    onSettled: () => qc.invalidateQueries({ queryKey: ['session-feel', workoutId] }),
  });

  const saveNote = useMutation({
    mutationFn: (text) => updateWorkout(workoutId, { notes: text }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workout', String(workoutId)] }),
  });

  // Flagged when there is no rating: this component is now the fallback for a session
  // whose Finish sheet was skipped, so "nothing here yet" has to look different from
  // "rated 8" rather than both being a quiet row.
  // `undefined` is "still loading"; `null` is "no row yet", which is the common case
  // for an unrated session — the endpoint returns null rather than an empty object, so
  // testing `feel != null` hid the flag in exactly the situation it exists for.
  const unrated = feel !== undefined && feel?.rpe == null;

  return (
    <section className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
      {unrated && (
        <p className="text-xs text-amber-700 dark:text-amber-500 mb-1">
          Not rated yet — how hard was this one?
        </p>
      )}
      <RatingRow
        label="How hard?" hint="RPE 1–10"
        max={10}
        value={feel?.rpe ?? null}
        onPick={(n) => saveRpe.mutate(n)}
      />
      {noteOpen ? (
        <form
          className="flex gap-2 mt-2"
          onSubmit={(e) => {
            e.preventDefault();
            // Empty submit clears — same absent-vs-cleared rule as everywhere else.
            saveNote.mutate(note.trim() || null);
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
          onClick={() => { setNote(workoutNotes || ''); setNoteOpen(true); }}
          className="btn-ghost text-xs mt-1 -ml-1"
        >
          {workoutNotes ? 'Edit workout notes' : '+ Add workout notes'}
        </button>
      )}
      {(saveRpe.isError || saveNote.isError) && (
        <p className="text-xs text-red-600 dark:text-red-400 mt-1">Couldn’t save that — try again.</p>
      )}
    </section>
  );
}
