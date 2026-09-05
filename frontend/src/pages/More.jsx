import { Link } from 'react-router-dom';

// The overflow. Program, Exercises and History each held a bottom-bar slot until
// 2026-09-05, when two weeks of app_events showed Program and Exercises getting a
// sub-2-second tap on 13 of 19 and 8 of 9 visits — tapped because they were there, on
// the way round the bar, never to do anything. They're reference and setup, not
// daily, so they sit one tap deeper and the bar keeps the four screens that get used.
const ITEMS = [
  { to: '/program', label: 'Program', hint: 'The active split, its routines, and the editor.' },
  { to: '/exercises', label: 'Exercises', hint: 'The library. Add or edit a movement.' },
  { to: '/history', label: 'History', hint: 'Every logged workout, newest first.' },
];

export default function More() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">More</h1>
      <nav aria-label="More pages" className="divide-y divide-neutral-200 dark:divide-neutral-800 border-y border-neutral-200 dark:border-neutral-800">
        {ITEMS.map((it) => (
          <Link key={it.to} to={it.to} className="flex items-center justify-between py-3.5 group">
            <div>
              <p className="font-medium text-neutral-900 dark:text-neutral-100 group-hover:underline">{it.label}</p>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">{it.hint}</p>
            </div>
            <span className="text-neutral-400 dark:text-neutral-600 ml-3" aria-hidden="true">→</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
