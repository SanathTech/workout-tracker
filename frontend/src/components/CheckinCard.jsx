import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getCheckin, saveCheckin } from '../api/client';
import RatingRow from './RatingRow';

// The daily check-in. Three taps, and each tap saves on its own — the server upserts
// per field, so a half-finished check-in is still a check-in and there's nothing to
// submit or lose. The note is deliberately behind a toggle: asking for prose every
// morning is how you end up with no check-ins at all.
export default function CheckinCard({ compact = false }) {
  const qc = useQueryClient();
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');

  const { data: checkin, isLoading } = useQuery({
    queryKey: ['checkin'],
    queryFn: getCheckin,
    staleTime: 60_000,
  });

  const save = useMutation({
    mutationFn: saveCheckin,
    // Optimistic: the button has to latch the instant it's tapped or it reads as broken
    // on gym wifi. React Query rolls it back if the write fails.
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ['checkin'] });
      const previous = qc.getQueryData(['checkin']);
      qc.setQueryData(['checkin'], (old) => ({ ...(old || {}), ...patch }));
      return { previous };
    },
    onError: (_err, _patch, ctx) => qc.setQueryData(['checkin'], ctx?.previous),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['checkin'] });
      qc.invalidateQueries({ queryKey: ['checkins'] });
    },
  });

  const done = checkin && (checkin.mood != null || checkin.energy != null || checkin.soreness != null);

  return (
    <section className={compact ? '' : 'border-t border-neutral-200 dark:border-neutral-800 pt-4'}>
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="section-label">Today’s check-in</h2>
        {done && <span className="text-[11px] text-emerald-700 dark:text-emerald-400">Saved</span>}
      </div>

      {isLoading ? (
        <div className="h-40" />
      ) : (
        <>
          <RatingRow
            label="Mood" hint="1 flat · 5 great"
            value={checkin?.mood ?? null}
            onPick={(n) => save.mutate({ mood: n })}
          />
          <RatingRow
            label="Energy" hint="1 empty · 5 full"
            value={checkin?.energy ?? null}
            onPick={(n) => save.mutate({ energy: n })}
          />
          <RatingRow
            label="Soreness" hint="1 none · 5 wrecked"
            value={checkin?.soreness ?? null}
            onPick={(n) => save.mutate({ soreness: n })}
          />

          {checkin?.note && !noteOpen ? (
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-2 italic">“{checkin.note}”</p>
          ) : null}

          {noteOpen ? (
            <form
              className="flex gap-2 mt-2"
              onSubmit={(e) => {
                e.preventDefault();
                // Send the trimmed value or an explicit null — submitting an empty field
                // is how you clear a note, so an empty string can't be a no-op here.
                save.mutate({ note: note.trim() || null });
                setNote('');
                setNoteOpen(false);
              }}
            >
              <input
                autoFocus
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Anything worth noting?"
                className="input flex-1 py-1.5"
              />
              <button type="submit" className="btn-secondary px-4">Save</button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => { setNote(checkin?.note || ''); setNoteOpen(true); }}
              className="btn-ghost text-xs mt-1 -ml-1"
            >
              {checkin?.note ? 'Edit note' : '+ Add a note'}
            </button>
          )}

          {save.isError && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-1">Couldn’t save that — try again.</p>
          )}
        </>
      )}
    </section>
  );
}
