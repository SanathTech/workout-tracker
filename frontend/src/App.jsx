import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import LogWorkout from './pages/LogWorkout';
import WorkoutDetail from './pages/WorkoutDetail';
import Plans from './pages/Plans';
import PlanDetail from './pages/PlanDetail';
import Progress from './pages/Progress';
import ExerciseLibrary from './pages/ExerciseLibrary';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="log" element={<LogWorkout />} />
        <Route path="workouts/:id" element={<WorkoutDetail />} />
        <Route path="plans" element={<Plans />} />
        <Route path="plans/:id" element={<PlanDetail />} />
        <Route path="progress" element={<Progress />} />
        <Route path="exercises" element={<ExerciseLibrary />} />
      </Route>
    </Routes>
  );
}
