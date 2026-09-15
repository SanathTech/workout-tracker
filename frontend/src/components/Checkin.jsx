import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getCheckin, saveCheckin } from '../api/client';
import { track } from '../util/telemetry';
import { localDate } from '../util/format';
import RatingRow from './RatingRow';

// The daily check-in, in pieces, because since the 2026-09-15 rethink it no longer lives
// in one block: the ratings are asked in the morning (or above Start on a gym day), the
// ramp at wind-down. Each tap still saves on its own — the server upserts per field, so
// half an answer is still an answer and there's nothing to submit or lose.
export const RAMP_FIELDS = ['no_caffeine_pm', 'food_by_cutoff', 'screens_by_cutoff'];
export const ratingsComplete = (c) => !!c && c.mood != null && c.energy != null && c.soreness != null;
export const rampComplete = (c) => !!c && RAMP_FIELDS.every((f) => c[f] != null);

// `date` is the day the answers belong to. The ramp asked after midnight is still about
// the evening before — his check-ins land at 23:00-00:30, and a save at 00:19 used to
// file last night's screens under a day that had barely started.
export function useCheckin(date = localDate()) {
  const qc = useQueryClient();
  const key = ['checkin', date];
  const query = useQuery({ queryKey: key, queryFn: () => getCheckin(date), staleTime: 60_000 });

  const save = useMutation({
    mutationFn: (patch) => saveCheckin({ ...patch, date }),
    // Optimistic: the button has to latch the instant it's tapped or it reads as broken
    // on gym wifi. React Query rolls it back if the write fails.
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData(key);
      qc.setQueryData(key, (old) => ({ ...(old || {}), ...patch }));
      return { previous };
    },
    // The 25 Aug save failures were invisible in the event log — the whole struggle
    // recorded as nav bounces because this form emitted nothing.
    onSuccess: (_data, patch) => track('save', 'checkin-saved', { fields: Object.keys(patch) }),
    onError: (err, patch, ctx) => {
      qc.setQueryData(key, ctx?.previous);
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

  return { checkin: query.data, isLoading: query.isLoading, save };
}

export function Ratings({ checkin, save }) {
  return (
    <div>
      <RatingRow label="Mood" hint="1 flat · 5 great" value={checkin?.mood ?? null} onPick={(n) => save.mutate({ mood: n })} />
      <RatingRow label="Energy" hint="1 empty · 5 full" value={checkin?.energy ?? null} onPick={(n) => save.mutate({ energy: n })} />
      <RatingRow label="Soreness" hint="1 none · 5 wrecked" value={checkin?.soreness ?? null} onPick={(n) => save.mutate({ soreness: n })} />
    </div>
  );
}

// The three inputs to the one protocol metric that keeps failing, the 22:30 anchor. An
// answer can be changed but not cleared, and unanswered stays unanswered — the coach
// reads NULL as unknown, never as a broken rule.
const RAMP = [
  { field: 'no_caffeine_pm', label: 'Caffeine', hint: 'none after 12:00' },
  { field: 'food_by_cutoff', label: 'Last food', hint: 'by 19:30' },
  { field: 'screens_by_cutoff', label: 'Screens', hint: 'down by 21:30' },
];

export function Ramp({ checkin, save }) {
  return (
    <div>
      {RAMP.map(({ field, label, hint }) => {
        const value = checkin?.[field] ?? null;
        return (
          <div key={field} className="flex items-center gap-3 py-1">
            <div className="w-20 shrink-0">
              <div className="text-sm text-neutral-300">{label}</div>
              <div className="text-[11px] text-neutral-400">{hint}</div>
            </div>
            <div className="flex gap-1 flex-1">
              {[{ val: true, text: 'Kept' }, { val: false, text: 'Broke' }].map(({ val, text }) => {
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
                        ? val ? 'bg-emerald-500 text-neutral-950' : 'bg-amber-500 text-neutral-950'
                        : 'bg-neutral-950 text-neutral-400 hover:bg-neutral-800'
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
    </div>
  );
}

export function NoteField({ checkin, save }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');

  if (open) {
    return (
      <form
        className="flex gap-2 mt-2"
        onSubmit={(e) => {
          e.preventDefault();
          // The form closes on SUCCESS, not on submit. Closing optimistically once ate a
          // note typed four times on a dead connection (25 Aug) — ratings can be
          // optimistic because a lost tap costs a tap; prose cannot.
          save.mutate({ note: note.trim() || null }, {
            onSuccess: () => { setNote(''); setOpen(false); },
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
    );
  }
  return (
    <div>
      {checkin?.note && <p className="text-sm text-neutral-400 mt-1 italic">“{checkin.note}”</p>}
      <button
        type="button"
        onClick={() => { setNote(checkin?.note || ''); setOpen(true); }}
        className="btn-ghost text-xs -ml-1"
      >
        {checkin?.note ? 'Edit note' : '+ Add a note'}
      </button>
    </div>
  );
}

export function SaveError({ save }) {
  return save.isError ? <p className="text-xs text-red-400 mt-1">Couldn’t save that — try again.</p> : null;
}
