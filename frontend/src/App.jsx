import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Train from './pages/Train';
import ProgramEdit from './pages/ProgramEdit';
import WorkoutSession from './pages/WorkoutSession';
import WorkoutDetail from './pages/WorkoutDetail';
import Health from './pages/Health';
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
        <Route path="train" element={<Train />} />
        <Route path="program/new" element={<ProgramEdit />} />
        <Route path="program/:id/edit" element={<ProgramEdit />} />
        <Route path="workouts/:id" element={<WorkoutDetail />} />
        <Route path="health" element={<Health />} />
        {/* A phone that hasn't taken the update yet still has old routes in its history
            and possibly in the installed shell's start state. Redirect rather than 404:
            Coach became Trends (2026-08-16) and Trends became Health (2026-09-08), Week
            folded into Home (2026-09-05), and Program / History / More became Train
            (2026-09-08). */}
        <Route path="coach" element={<Navigate to="/health" replace />} />
        <Route path="trends" element={<Navigate to="/health" replace />} />
        <Route path="week" element={<Navigate to="/dashboard" replace />} />
        <Route path="program" element={<Navigate to="/train" replace />} />
        <Route path="history" element={<Navigate to="/train" replace />} />
        <Route path="more" element={<Navigate to="/train" replace />} />
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
