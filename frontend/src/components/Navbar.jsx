import { NavLink, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useIsFetching } from '@tanstack/react-query';

const links = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/program', label: 'Program' },
  { to: '/progress', label: 'Progress' },
  { to: '/exercises', label: 'Exercises' },
];

function SunIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" strokeLinecap="round" />
    </svg>
  );
}
function MoonIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" strokeLinejoin="round" />
    </svg>
  );
}

function SyncingDot() {
  const fetching = useIsFetching();
  if (!fetching) return null;
  return (
    <span
      aria-label="Syncing"
      className="w-1.5 h-1.5 rounded-full bg-neutral-400 dark:bg-neutral-500 animate-pulse"
    />
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);
  return (
    <button
      type="button"
      onClick={() => setDark((d) => !d)}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="shrink-0 p-2 rounded-md text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:text-neutral-200 dark:hover:bg-neutral-900 transition-colors"
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

export default function Navbar() {
  const location = useLocation();
  const inSession = /^\/session\//.test(location.pathname);
  return (
    <>
      {/* Top header — mobile: brand + toggle. Desktop: full nav */}
      <header className="bg-white/80 backdrop-blur border-b border-neutral-200 sticky top-0 z-10 dark:bg-neutral-950/80 dark:border-neutral-900">
        <div className="max-w-6xl mx-auto px-4 flex items-center h-14">
          <span className="font-semibold tracking-tight text-neutral-900 dark:text-neutral-200">
            Workout Tracker
          </span>
          <div className="hidden md:flex gap-1 ml-6">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                    isActive
                      ? 'bg-neutral-100 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-200'
                      : 'text-neutral-500 hover:text-neutral-900 hover:bg-neutral-50 dark:text-neutral-400 dark:hover:text-neutral-200 dark:hover:bg-neutral-900/50'
                  }`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <SyncingDot />
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Bottom tab bar — mobile only, hidden during a workout session */}
      {!inSession && (
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-white/95 backdrop-blur border-t border-neutral-200 dark:bg-neutral-950/95 dark:border-neutral-900 pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-4">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `flex items-center justify-center py-3 text-xs font-medium transition-colors ${
                  isActive
                    ? 'text-neutral-900 dark:text-neutral-200'
                    : 'text-neutral-500 dark:text-neutral-500'
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </div>
      </nav>
      )}
    </>
  );
}
