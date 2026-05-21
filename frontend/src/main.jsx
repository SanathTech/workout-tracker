import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import App from './App';
import {
  getActiveProgram, getInProgressWorkout, getStats, getRecentWorkouts,
} from './api/client';
import './index.css';

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
      persistOptions={{ persister, maxAge: 24 * 60 * 60_000 }}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </PersistQueryClientProvider>
  </React.StrictMode>
);
