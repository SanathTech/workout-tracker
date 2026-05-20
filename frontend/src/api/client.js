import axios from 'axios';

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

// ── Programs ─────────────────────────────────────────────────
export const getPrograms = () => api.get('/programs').then((r) => r.data);
export const getActiveProgram = () => api.get('/programs/active').then((r) => r.data);
export const getProgram = (id) => api.get(`/programs/${id}`).then((r) => r.data);
export const createProgram = (data) => api.post('/programs', data).then((r) => r.data);
export const updateProgram = (id, data) => api.put(`/programs/${id}`, data).then((r) => r.data);
export const deleteProgram = (id) => api.delete(`/programs/${id}`).then((r) => r.data);
export const startProgram = (id) => api.post(`/programs/${id}/start`).then((r) => r.data);
export const endProgram = (id) => api.post(`/programs/${id}/end`).then((r) => r.data);

// ── Workouts ─────────────────────────────────────────────────
export const getWorkouts = (params) => api.get('/workouts', { params }).then((r) => r.data);
export const getRecentWorkouts = () => api.get('/workouts/recent').then((r) => r.data);
export const getInProgressWorkout = () => api.get('/workouts/in-progress').then((r) => r.data);
export const getWorkout = (id) => api.get(`/workouts/${id}`).then((r) => r.data);
export const startWorkout = (data) => api.post('/workouts', data).then((r) => r.data);
export const updateWorkout = (id, data) => api.put(`/workouts/${id}`, data).then((r) => r.data);
export const completeWorkout = (id) => api.post(`/workouts/${id}/complete`).then((r) => r.data);
export const deleteWorkout = (id) => api.delete(`/workouts/${id}`).then((r) => r.data);
export const getLastByExercise = (exerciseId, params) =>
  api.get(`/workouts/last-by-exercise/${exerciseId}`, { params }).then((r) => r.data);

// ── Progress ─────────────────────────────────────────────────
export const getStats = () => api.get('/progress/stats').then((r) => r.data);
export const getVolumeProgress = (params) => api.get('/progress/volume', { params }).then((r) => r.data);
export const getExerciseProgress = (id, params) =>
  api.get(`/progress/exercise/${id}`, { params }).then((r) => r.data);
export const getPersonalBests = () => api.get('/progress/personal-bests').then((r) => r.data);
