import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getCheckin, saveCheckin } from '../api/client';
import { track } from '../util/telemetry';
import RatingRow from './RatingRow';

// The daily check-in. Three taps, and each tap saves on its own — the server upserts
// per field, so a half-finished check-in is still a check-in and there's nothing to
// submit or lose. The note is deliberately behind a toggle: asking for prose every
// morning is how you end up with no check-ins at all.
export default function CheckinCard({ compact = false }) {
  const qc = useQueryClient();
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  // Each half folds to a one-line summary once it's fully answered — the ratings in
  // the morning, the ramp at night — so a finished check-in costs one line of Home,
  // not a screen. "Edit" reopens it; the answers can be changed but never cleared.
  const [ratingsOpen, setRatingsOpen] = useState(false);
  const [rampOpen, setRampOpen] = useState(false);

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
    // The 25 Aug save failures were invisible in the event log — the whole struggle
    // recorded as nav bounces because this form emitted nothing. Both outcomes now
    // land in app_events, so the next "it wouldn't save" comes with evidence.
    onSuccess: (_data, patch) => track('save', 'checkin-saved', { fields: Object.keys(patch) }),
    onError: (err, patch, ctx) => {
      qc.setQueryData(['checkin'], ctx?.previous);
      track('error', 'checkin-save-failed', {
        fields: Object.keys(patch),
        message: String(err?.message || '').slice(0, 200),
      });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['checkin'] });
      qc.invalidateQueries({ queryKey: ['checkins'] });
    },
  });

  const done = checkin && (checkin.mood != null || checkin.energy != null || checkin.soreness != null);
  const ratingsDone = checkin && checkin.mood != null && checkin.energy != null && checkin.soreness != null;
  const RAMP = [
    { field: 'no_caffeine_pm', label: 'Caffeine', hint: 'none after 12:00' },
    { field: 'food_by_cutoff', label: 'Last food', hint: 'by 19:30' },
    { field: 'screens_by_cutoff', label: 'Screens', hint: 'down by 21:30' },
  ];
  const rampDone = checkin && RAMP.every(({ field }) => checkin[field] != null);
  const editLink = (onClick) => (
    <button type="button" onClick={onClick} className="text-xs text-neutral-500 dark:text-neutral-400 underline-offset-2 hover:underline min-h-11 md:min-h-0 pl-3 shrink-0">
      edit
    </button>
  );

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
          {ratingsDone && !ratingsOpen ? (
            <div className="flex items-center justify-between py-1.5">
              <p className="text-sm text-neutral-700 dark:text-neutral-300 tabular-nums">
                Mood {checkin.mood} · Energy {checkin.energy} · Soreness {checkin.soreness}
              </p>
              {editLink(() => setRatingsOpen(true))}
            </div>
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
            </>
          )}

          {/* The evening ramp — the three inputs to the one protocol metric that keeps
              failing, the 22:30 anchor. Same contract as the ratings: a tap is a save,
              an answer can be changed but not cleared, and unanswered stays unanswered —
              the coach reads NULL as unknown, never as a broken rule. Best answered at
              the 21:30 wind-down ping, when all three are known. */}
          <div className="mt-1 pt-2 border-t border-neutral-100 dark:border-neutral-900">
            {rampDone && !rampOpen ? (
              <div className="flex items-center justify-between py-1.5">
                <p className="text-sm text-neutral-700 dark:text-neutral-300">
                  <span className="text-[11px] text-neutral-500 dark:text-neutral-400 mr-2">Evening ramp</span>
                  {RAMP.map(({ field, label }) => (
                    <span key={field} className={`mr-2 ${checkin[field] ? '' : 'text-amber-700 dark:text-amber-500'}`}>
                      {label} {checkin[field] ? '✓' : '✗'}
                    </span>
                  ))}
                </p>
                {editLink(() => setRampOpen(true))}
              </div>
            ) : (
            <>
            <div className="text-[11px] text-neutral-500 dark:text-neutral-400 mb-1">
              Evening ramp
            </div>
            {RAMP.map(({ field, label, hint }) => {
              const value = checkin?.[field] ?? null;
              return (
                <div key={field} className="flex items-center gap-3 py-1">
                  <div className="w-20 shrink-0">
                    <div className="text-sm text-neutral-700 dark:text-neutral-300">{label}</div>
                    <div className="text-[11px] text-neutral-500 dark:text-neutral-400">{hint}</div>
                  </div>
                  <div className="flex gap-1 flex-1">
                    {[
                      { val: true, text: 'Kept' },
                      { val: false, text: 'Broke' },
                    ].map(({ val, text }) => {
                      const active = value === val;
                      return (
                        <button
                          key={text}
                          type="button"
                          aria-pressed={active}
                          aria-label={`${label}: ${text.toLowerCase()}`}
                          onClick={() => save.mutate({ [field]: val })}
                          className={`flex-1 min-h-11 md:min-h-9 rounded-md text-sm font-medium transition-colors ${
                            active
                              ? val
                                ? 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-neutral-950'
                                : 'bg-amber-600 text-white dark:bg-amber-500 dark:text-neutral-950'
                              : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800'
                          }`}
                        >
                          {text}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            </>
            )}
          </div>

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
                //
                // The form closes on SUCCESS, not on submit. It used to clear and close
                // optimistically, which combined with the silent rollback into the worst
                // failure mode a text field has: a dead connection ate the note from the
                // cache AND the input, with nothing on screen saying so — he typed the
                // same note four times on 25 Aug before one request survived. Ratings
                // can be optimistic because a lost tap costs a tap; prose cannot.
                save.mutate({ note: note.trim() || null }, {
                  onSuccess: () => { setNote(''); setNoteOpen(false); },
                });
              }}
            >
              <input
                autoFocus
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Anything worth noting?"
                className="input flex-1 py-1.5"
              />
              <button type="submit" className="btn-secondary px-4" disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save'}
              </button>
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
