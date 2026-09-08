import { NavLink, useLocation } from 'react-router-dom';
import { useIsFetching, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMobileNavHidden } from '../hooks/useMobileNavVisibility';
import { getAuthStatus, logout } from '../api/client';

function HomeIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true" {...props}>
      <path d="M3 10.5 12 3l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 9.5V20a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V9.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ProgramIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true" {...props}>
      <rect x="4" y="4" width="16" height="17" rx="2" />
      <path d="M8 3v3M16 3v3M8 11h8M8 15.5h5" strokeLinecap="round" />
    </svg>
  );
}
function ProgressIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true" {...props}>
      <path d="M4 20V10M10 20V4M16 20v-7M21 20H3.5" strokeLinecap="round" />
    </svg>
  );
}
// The heart is back (PR 5): next to Train and Lifts the tab is the body's numbers —
// sleep, weight, bedtime — and "Health" is the word he uses for them. The pulse line
// it replaces read as a stock chart once the tab stopped being called Trends.
function HealthIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true" {...props}>
      <path d="M12 20.5s-7.5-4.6-7.5-10A4 4 0 0 1 12 8.2a4 4 0 0 1 7.5 2.3c0 5.4-7.5 10-7.5 10z" strokeLinejoin="round" />
    </svg>
  );
}

// Four tabs, from six (2026-09-05). Two weeks of app_events: Home, Week and Trends were
// one nightly corridor to the check-in; Program, Progress and Exercises got a ~1-second
// tap each on the way round the bar. Week folded into Home along with the check-in,
// Program and Exercises went under More, and Progress became Lifts — the strength twin
// of Trends. Trends stays second: after a night's sleep last night's numbers are the
// first thing worth seeing, and the two leftmost tabs are the ones reachable one-handed.
//
// 2026-09-08 (redesign PR 4): More became Train — program, history and the week's rows
// on one screen. 30 days of app_events put Program + Exercises + History + More at 43
// visits to Lifts' 25, so Train takes the third slot and Lifts the fourth. Desktop shows
// the same four; the Exercises link lives on Train now, so there's no separate IA.
// PR 5 renamed Trends to Health — same slot, same data, regrouped by question.
const links = [
  { to: '/dashboard', label: 'Today', Icon: HomeIcon },
  { to: '/health', label: 'Health', Icon: HealthIcon },
  { to: '/train', label: 'Train', Icon: ProgramIcon },
  { to: '/progress', label: 'Lifts', Icon: ProgressIcon },
];

function SyncingDot() {
  const fetching = useIsFetching();
  if (!fetching) return null;
  return (
    <span
      aria-label="Syncing"
      className="w-1.5 h-1.5 rounded-full bg-neutral-500 animate-pulse"
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
      className="shrink-0 w-11 h-11 flex items-center justify-center rounded-md text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900 transition-colors"
    >
      <SignOutIcon />
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
        className={`border-b md:sticky md:top-0 z-10 bg-neutral-950 border-neutral-800 ${
          inSession ? 'hidden md:block' : ''
        }`}
      >
        <div className="max-w-2xl mx-auto px-4 flex items-center h-14">
          <span className="font-semibold tracking-tight text-neutral-200">
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
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/50'
                  }`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <SyncingDot />
            <SignOutButton />
          </div>
        </div>
      </header>

      {/* Bottom tab bar — mobile only, hidden during a workout session or when an editor explicitly hides it */}
      {showBottomNav && (
        <nav aria-label="Main" className="md:hidden fixed bottom-0 inset-x-0 z-20 border-t bg-neutral-950 border-neutral-800 pb-[env(safe-area-inset-bottom)]">
          <div className="grid grid-cols-4">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center gap-0.5 h-14 text-[11px] font-medium transition-colors ${
                    isActive
                      ? 'text-emerald-400'
                      : 'text-neutral-400'
                  }`
                }
              >
                <l.Icon width={22} height={22} />
                <span className="w-full px-0.5 text-center truncate">{l.label}</span>
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </>
  );
}
