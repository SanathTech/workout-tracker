import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Program from './pages/Program';
import WorkoutSession from './pages/WorkoutSession';
import WorkoutDetail from './pages/WorkoutDetail';
import History from './pages/History';
import Coach from './pages/Coach';
import ExerciseLibrary from './pages/ExerciseLibrary';
import { Skeleton } from './components/Skeleton';

// Progress is the only route that pulls in Recharts (~525kB, more than double the rest of
// the app). Loading it on demand keeps the bundle that has to arrive over gym wifi small.
// The service worker precaches the chunk, so it's still available offline.
const Progress = lazy(() => import('./pages/Progress'));

function RouteFallback() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="program" element={<Program />} />
        <Route path="workouts/:id" element={<WorkoutDetail />} />
        <Route path="history" element={<History />} />
        <Route path="coach" element={<Coach />} />
        <Route path="session/:id" element={<WorkoutSession />} />
        <Route
          path="progress"
          element={<Suspense fallback={<RouteFallback />}><Progress /></Suspense>}
        />
        <Route path="exercises" element={<ExerciseLibrary />} />
      </Route>
    </Routes>
  );
}
