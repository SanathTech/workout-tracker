import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Program from './pages/Program';
import WorkoutSession from './pages/WorkoutSession';
import WorkoutDetail from './pages/WorkoutDetail';
import Progress from './pages/Progress';
import ExerciseLibrary from './pages/ExerciseLibrary';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="program" element={<Program />} />
        <Route path="workouts/:id" element={<WorkoutDetail />} />
        <Route path="session/:id" element={<WorkoutSession />} />
        <Route path="progress" element={<Progress />} />
        <Route path="exercises" element={<ExerciseLibrary />} />
      </Route>
    </Routes>
  );
}
