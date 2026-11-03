import axios from 'axios';
import { localDate } from '../util/format';

const baseURL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

const api = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
  // The session lives in an httpOnly cookie. In production the API is proxied to the
  // same origin by a Vercel rewrite, so this is a same-site request.
  withCredentials: true,
  // A request that dies silently (network handoff, phone locked mid-PUT) must reject,
  // not hang: the session autosave holds one in-flight promise, and a promise that
  // never settles wedges every save after it. 15s is beyond any healthy response —
  // the weekly coach call is the slowest thing here and it's not made from the app.
  timeout: 15_000,
});

// A 401 means the session lapsed. Announce it once so AuthGate can re-check and show
// the login screen, rather than every caller having to handle it.
export const UNAUTHENTICATED_EVENT = 'wt:unauthenticated';
api.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error.response?.status === 401) {
      window.dispatchEvent(new CustomEvent(UNAUTHENTICATED_EVENT));
    }
    return Promise.reject(error);
  }
);

// The workout `date` is the calendar day *you* trained, so it has to come from the
// device (util/format's localDate). Deriving it server-side put every pre-10am
// Melbourne session on the previous day, which then skewed the weekly volume buckets.

// ── Auth ─────────────────────────────────────────────────────
export const getAuthStatus = () => api.get('/auth/me').then((r) => r.data);
export const login = (password) => api.post('/auth/login', { password }).then((r) => r.data);
export const logout = () => api.post('/auth/logout').then((r) => r.data);

// ── Exercises ───────────────────────────────────────────────
export const getExercises = (params) => api.get('/exercises', { params }).then((r) => r.data);
export const getExerciseGroups = () => api.get('/exercises/groups').then((r) => r.data);
export const createExercise = (data) => api.post('/exercises', data).then((r) => r.data);
export const updateExercise = (id, data) => api.put(`/exercises/${id}`, data).then((r) => r.data);
export const deleteExercise = (id) => api.delete(`/exercises/${id}`).then((r) => r.data);

// ── Programs ─────────────────────────────────────────────────
export const getActiveProgram = () => api.get('/programs/active').then((r) => r.data);
export const getProgram = (id) => api.get(`/programs/${id}`).then((r) => r.data);
export const createProgram = (data) => api.post('/programs', data).then((r) => r.data);
export const updateProgram = (id, data) => api.put(`/programs/${id}`, data).then((r) => r.data);
export const startProgram = (id) => api.post(`/programs/${id}/start`).then((r) => r.data);

// ── Workouts ─────────────────────────────────────────────────
export const getWorkouts = (params) => api.get('/workouts', { params }).then((r) => r.data);
export const getInProgressWorkout = () => api.get('/workouts/in-progress').then((r) => r.data);
export const getWorkout = (id) => api.get(`/workouts/${id}`).then((r) => r.data);
export const startWorkout = (data) =>
  api.post('/workouts', { date: localDate(), ...data }).then((r) => r.data);
export const updateWorkout = (id, data, config) =>
  api.put(`/workouts/${id}`, data, config).then((r) => r.data);
export const completeWorkout = (id) => api.post(`/workouts/${id}/complete`).then((r) => r.data);
export const resumeWorkout = (id) => api.post(`/workouts/${id}/resume`).then((r) => r.data);
export const makeDefaultExercise = (id, data) =>
  api.post(`/workouts/${id}/default-exercise`, data).then((r) => r.data);
export const skipWorkout = (id) => api.post(`/workouts/${id}/skip`).then((r) => r.data);
export const deleteWorkout = (id) => api.delete(`/workouts/${id}`).then((r) => r.data);
export const getLastByExercise = (exerciseId, params) =>
  api.get(`/workouts/last-by-exercise/${exerciseId}`, { params }).then((r) => r.data);

// ── Progress ─────────────────────────────────────────────────
export const getPersonalBests = () => api.get('/progress/personal-bests').then((r) => r.data);

// routineId scopes both the rep range and the history to the routine being trained.
// Without it the server has to pick one prescription per exercise for the whole program,
// which is how Day A came to be progressed against Day C's rep range.
export const getSuggestions = (routineId) =>
  api.get('/progress/suggestions', { params: routineId ? { routine_id: routineId } : undefined })
    .then((r) => r.data);
