import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAuthStatus, login, UNAUTHENTICATED_EVENT } from '../api/client';

function LoginScreen({ onSignedIn }) {
  const [password, setPassword] = useState('');
  const qc = useQueryClient();

  const signIn = useMutation({
    mutationFn: () => login(password),
    onSuccess: () => {
      setPassword('');
      // Anything cached before signing in was fetched unauthenticated.
      qc.clear();
      onSignedIn();
    },
  });

  const message = signIn.isError
    ? signIn.error?.response?.data?.error || 'Could not sign in. Check your connection and try again.'
    : null;

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form
        onSubmit={(e) => { e.preventDefault(); if (password) signIn.mutate(); }}
        className="card w-full max-w-sm space-y-4"
      >
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Workout Tracker</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">Sign in to continue.</p>
        </div>

        <div>
          <label className="label" htmlFor="wt-password">Password</label>
          <input
            id="wt-password"
            type="password"
            autoFocus
            autoComplete="current-password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {message && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">{message}</p>
        )}

        <button
          type="submit"
          disabled={!password || signIn.isPending}
          className="btn-primary w-full justify-center"
        >
          {signIn.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

export default function AuthGate({ children }) {
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['auth'],
    queryFn: getAuthStatus,
    staleTime: 5 * 60_000,
    retry: false,
  });

  // A 401 from any request means the session lapsed mid-use — re-check so the login
  // screen replaces whatever page is showing.
  useEffect(() => {
    const onUnauthenticated = () => refetch();
    window.addEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
  }, [refetch]);

  // Don't flash the login form while the status request is still in flight.
  if (isLoading) return null;

  // `required: false` means the server has no auth configured — stay out of the way
  // rather than locking the owner out of their own app.
  if (data && data.required && !data.authenticated) {
    return <LoginScreen onSignedIn={() => qc.invalidateQueries({ queryKey: ['auth'] })} />;
  }

  return children;
}
