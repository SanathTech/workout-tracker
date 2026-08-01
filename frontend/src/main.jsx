import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, defaultShouldDehydrateQuery } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import AuthGate from './components/AuthGate';
import ErrorBoundary from './components/ErrorBoundary';
import {
  getActiveProgram, getInProgressWorkout, getStats, getRecentWorkouts,
} from './api/client';
import './index.css';

// No auto-reload on update. A new service worker taking over mid-session would remount
// the page and drop whatever was typed inside the autosave debounce; the update installs
// quietly and takes effect the next time the app is opened cold.
registerSW({ immediate: true });

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,
      gcTime: 24 * 60 * 60_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: 'wt-cache',
});

queryClient.prefetchQuery({ queryKey: ['active-program'], queryFn: getActiveProgram });
queryClient.prefetchQuery({ queryKey: ['in-progress-workout'], queryFn: getInProgressWorkout });
queryClient.prefetchQuery({ queryKey: ['stats'], queryFn: getStats });
queryClient.prefetchQuery({ queryKey: ['recent-workouts'], queryFn: getRecentWorkouts });

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 24 * 60 * 60_000,
        // Never persist the in-progress workout. It's edited live and kept on the
        // server by autosave, so a reload must fetch it fresh — persisting it risks
        // hydrating stale/partial data over real logged sets.
        dehydrateOptions: {
          shouldDehydrateQuery: (query) =>
            defaultShouldDehydrateQuery(query) && query.queryKey[0] !== 'workout',
        },
      }}
    >
      <ErrorBoundary>
        <BrowserRouter>
          <AuthGate>
            <App />
          </AuthGate>
        </BrowserRouter>
      </ErrorBoundary>
    </PersistQueryClientProvider>
  </React.StrictMode>
);
