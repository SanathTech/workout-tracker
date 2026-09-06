import { useQuery } from '@tanstack/react-query';
import { getWeek } from '../api/client';

// The newest thing he wrote about his body, and nothing older. Whether an older niggle
// has resolved is exactly the judgement the daily brief kept getting wrong, so the app
// shows what is unsuperseded and leaves the reading to him. Lived under the week plan
// on Home until 2026-09-06; it's reading, not doing, so it sits with the recovery data.
export default function LatestNotes() {
  const { data } = useQuery({ queryKey: ['week'], queryFn: getWeek, staleTime: 60_000 });
  const notes = data?.latest_notes || [];
  if (!notes.length) return null;
  return (
    <section className="border-t border-neutral-200 dark:border-neutral-800 pt-4">
      <h2 className="section-label">Latest notes</h2>
      <ul className="mt-1.5 space-y-2">
        {notes.map((n, i) => (
          <li key={`${n.date}-${i}`}>
            <p className="text-sm text-neutral-800 dark:text-neutral-200">“{n.note}”</p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
              {n.when} · {n.source}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
