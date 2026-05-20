import axios from 'axios';

// In development the Vite proxy rewrites /api → localhost:3001
// In production set VITE_API_URL to your deployed backend URL (e.g. https://workout-api.vercel.app)
const baseURL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

const api = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
});

// ── Exercises ───────────────────────────────────────────────
export const getExercises = (params) => api.get('/exercises', { params }).then((r) => r.data);
export const getExerciseGroups = () => api.get('/exercises/groups').then((r) => r.data);
export const getExercise = (id) => api.get(`/exercises/${id}`).then((r) => r.data);
export const createExercise = (data) => api.post('/exercises', data).then((r) => r.data);
export const updateExercise = (id, data) => api.put(`/exercises/${id}`, data).then((r) => r.data);
export const deleteExercise = (id) => api.delete(`/exercises/${id}`).then((r) => r.data);

// ── Plans ────────────────────────────────────────────────────
export const getPlans = () => api.get('/plans').then((r) => r.data);
export const getPlan = (id) => api.get(`/plans/${id}`).then((r) => r.data);
export const createPlan = (data) => api.post('/plans', data).then((r) => r.data);
export const updatePlan = (id, data) => api.put(`/plans/${id}`, data).then((r) => r.data);
export const deletePlan = (id) => api.delete(`/plans/${id}`).then((r) => r.data);

// ── Workouts ─────────────────────────────────────────────────
export const getWorkouts = (params) => api.get('/workouts', { params }).then((r) => r.data);
export const getRecentWorkouts = () => api.get('/workouts/recent').then((r) => r.data);
export const getWorkout = (id) => api.get(`/workouts/${id}`).then((r) => r.data);
export const createWorkout = (data) => api.post('/workouts', data).then((r) => r.data);
export const updateWorkout = (id, data) => api.put(`/workouts/${id}`, data).then((r) => r.data);
export const deleteWorkout = (id) => api.delete(`/workouts/${id}`).then((r) => r.data);

// ── Progress ─────────────────────────────────────────────────
export const getStats = () => api.get('/progress/stats').then((r) => r.data);
export const getVolumeProgress = (params) => api.get('/progress/volume', { params }).then((r) => r.data);
export const getExerciseProgress = (id, params) =>
  api.get(`/progress/exercise/${id}`, { params }).then((r) => r.data);
export const getPersonalBests = () => api.get('/progress/personal-bests').then((r) => r.data);
