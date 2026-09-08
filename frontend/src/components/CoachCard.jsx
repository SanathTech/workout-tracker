import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getCoachLatest, getCoachNotes } from '../api/client';
import { Sheet } from './ui';
import { formatDay } from '../util/format';

// The coach's one line for today. For the couple of days after a weekly review it's
// the review's headline; the rest of the week it's the newest standing note — the call
// that will show up as an aim line in the next session. First line only; the full text
// is a tap away. Nothing here is generated on the page: it's what was already written.

const REVIEW_FRESH_DAYS = 2;

function daysSince(dateStr) {
  const m3 = typeof dateStr === 'string' && dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m3) return Infinity; // no date = not fresh
  const then = new Date(Number(m3[1]), Number(m3[2]) - 1, Number(m3[3]));
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((now - then) / 86_400_000);
}

export function pickCoachItem({ latest, notes }) {
  const weekly = latest?.weekly;
  if (weekly?.advice?.headline && daysSince(weekly.for_date) <= REVIEW_FRESH_DAYS) {
    return { kind: 'weekly', title: 'Week review', line: weekly.advice.headline, entry: weekly };
  }
  const newest = (notes || []).reduce(
    (best, n) => (!best || new Date(n.created_at) > new Date(best.created_at) ? n : best),
    null
  );
  if (newest) {
    return { kind: 'note', title: newest.exercise_name || 'Coach note', line: newest.note, entry: newest };
  }
  if (weekly?.advice?.headline) {
    return { kind: 'weekly', title: 'Week review', line: weekly.advice.headline, entry: weekly };
  }
  return null;
}

function WeeklyBody({ entry }) {
  const a = entry.advice || {};
  return (
    <div className="space-y-3">
      <p className="font-semibold tracking-tight text-neutral-200">{a.headline}</p>
      {[
        ['This week', a.week_review],
        ['Adherence', a.adherence],
        ['Load', a.load_assessment],
        ['Strength', a.strength_note],
      ].map(([label, text]) =>
        text ? (
          <div key={label}>
            <p className="section-label">{label}</p>
            <p className="text-sm text-neutral-300">{text}</p>
          </div>
        ) : null
      )}
      {a.flags?.length > 0 && (
        <div>
          <p className="section-label">Flags</p>
          <ul className="space-y-1">
            {a.flags.map((f, i) => <li key={i} className="text-sm text-amber-400">{f}</li>)}
          </ul>
        </div>
      )}
      <p className="text-xs text-neutral-400">
        {formatDay(entry.for_date, { weekday: 'long', day: 'numeric', month: 'short' })} ·{' '}
        <Link to="/trends" className="underline underline-offset-2">Next week's plan on Trends</Link>
      </p>
    </div>
  );
}

export default function CoachCard() {
  const [open, setOpen] = useState(false);
  const { data: latest } = useQuery({ queryKey: ['coach-latest'], queryFn: getCoachLatest, staleTime: 5 * 60_000 });
  const { data: notes } = useQuery({ queryKey: ['coach-notes'], queryFn: getCoachNotes, staleTime: 5 * 60_000 });

  const item = pickCoachItem({ latest, notes });
  if (!item) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full text-left -mx-2 px-2 py-2 rounded-lg border-l-2 border-l-amber-400 pl-3 hover:bg-neutral-900 transition-colors"
      >
        <p className="section-label text-amber-400">Coach · {item.title}</p>
        <p className="text-sm text-neutral-300 line-clamp-1 mt-0.5">{item.line}</p>
      </button>

      {open && (
        <Sheet title={item.kind === 'weekly' ? 'Week review' : item.title} onClose={() => setOpen(false)}>
          <div className="p-4 overflow-y-auto">
            {item.kind === 'weekly' ? (
              <WeeklyBody entry={item.entry} />
            ) : (
              <>
                <p className="text-sm text-neutral-200 whitespace-pre-wrap">{item.line}</p>
                <p className="text-xs text-neutral-400 mt-3">
                  Coach note · {formatDay(item.entry.created_at, { day: 'numeric', month: 'short' })}
                  {item.entry.aim_weight_kg != null || item.entry.aim_reps != null || item.entry.aim_rir != null
                    ? ' · sets the aim line in your next session'
                    : ''}
                </p>
              </>
            )}
          </div>
        </Sheet>
      )}
    </>
  );
}
