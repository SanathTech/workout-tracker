import { NavLink, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useIsFetching, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMobileNavHidden } from '../hooks/useMobileNavVisibility';
import { getAuthStatus, logout } from '../api/client';

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

function SignOutIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="16 17 21 12 16 7" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="21" y1="12" x2="9" y2="12" strokeLinecap="round" />
    </svg>
  );
}

// Only rendered when the server actually has auth configured.
function SignOutButton() {
  const qc = useQueryClient();
  const { data: auth } = useQuery({ queryKey: ['auth'], queryFn: getAuthStatus, staleTime: 5 * 60_000, retry: false });

  const signOut = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      // Mirror of the sign-in path in AuthGate, and wrong for the same reason: clear()
      // removes the ['auth'] query this button and AuthGate both observe, so they'd keep
      // rendering `authenticated: true` and the app would sit there looking signed in
      // against a session the server has already ended.
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
      qc.setQueryData(['auth'], { authenticated: false, required: true });
    },
  });

  if (!auth?.required || !auth?.authenticated) return null;

  return (
    <button
      type="button"
      onClick={() => signOut.mutate()}
      disabled={signOut.isPending}
      aria-label="Sign out"
      title="Sign out"
      className="shrink-0 w-11 h-11 flex items-center justify-center rounded-md text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:text-neutral-200 dark:hover:bg-neutral-900 transition-colors"
    >
      <SignOutIcon />
    </button>
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
      className="shrink-0 w-11 h-11 flex items-center justify-center rounded-md text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:text-neutral-200 dark:hover:bg-neutral-900 transition-colors"
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

export default function Navbar() {
  const location = useLocation();
  const inSession = /^\/session\//.test(location.pathname);
  const externallyHidden = useMobileNavHidden();
  const showBottomNav = !inSession && !externallyHidden;
  return (
    <>
      {/* Top header — mobile: brand + toggle, and it scrolls away, because "Workout
          Tracker" is not worth 57px of a phone screen at all times. Hidden outright
          during a session, where the page supplies its own pinned context strip.
          Desktop: full nav, sticky. */}
      <header
        className={`bg-white/80 backdrop-blur border-b border-neutral-200 md:sticky md:top-0 z-10 dark:bg-neutral-950/80 dark:border-neutral-900 ${
          inSession ? 'hidden md:block' : ''
        }`}
      >
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
                      : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 hover:bg-neutral-50 dark:text-neutral-400 dark:hover:text-neutral-200 dark:hover:bg-neutral-900/50'
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
            <SignOutButton />
          </div>
        </div>
      </header>

      {/* Bottom tab bar — mobile only, hidden during a workout session or when an editor explicitly hides it */}
      {showBottomNav && (
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-white/95 backdrop-blur border-t border-neutral-200 dark:bg-neutral-950/95 dark:border-neutral-900 pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-4">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `flex items-center justify-center h-14 text-xs font-medium transition-colors ${
                  isActive
                    ? 'text-neutral-900 dark:text-neutral-200'
                    : 'text-neutral-500 dark:text-neutral-400'
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
