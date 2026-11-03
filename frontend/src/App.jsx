import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import History from './pages/History';
import ProgramEdit from './pages/ProgramEdit';
import WorkoutSession from './pages/WorkoutSession';
import WorkoutDetail from './pages/WorkoutDetail';
import ExerciseLibrary from './pages/ExerciseLibrary';

// Two tabs since the 2026-11-03 strip-back: Home (pick a workout) and History. Installed
// PWAs keep old routes in their history and shell state, so every retired screen
// redirects home rather than 404ing.
const RETIRED = ['dashboard', 'train', 'progress', 'program', 'coach', 'trends', 'health', 'week', 'more', 'metric/*', 'activity/*'];

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="history" element={<History />} />
        <Route path="program/new" element={<ProgramEdit />} />
        <Route path="program/:id/edit" element={<ProgramEdit />} />
        <Route path="workouts/:id" element={<WorkoutDetail />} />
        <Route path="session/:id" element={<WorkoutSession />} />
        <Route path="exercises" element={<ExerciseLibrary />} />
        {RETIRED.map((p) => <Route key={p} path={p} element={<RetiredRedirect />} />)}
      </Route>
    </Routes>
  );
}

// Keeps the query string, so the old "/dashboard?start=next" shortcut still starts the
// next workout on a phone whose installed manifest predates this change.
function RetiredRedirect() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: '/', search }} replace />;
}
