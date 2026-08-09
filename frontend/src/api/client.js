import axios from 'axios';

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
// device. Deriving it server-side put every pre-10am Melbourne session on the
// previous day, which then skewed the weekly volume buckets.
function localDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ── Auth ─────────────────────────────────────────────────────
export const getAuthStatus = () => api.get('/auth/me').then((r) => r.data);
export const login = (password) => api.post('/auth/login', { password }).then((r) => r.data);
export const logout = () => api.post('/auth/logout').then((r) => r.data);

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
export const startWorkout = (data) =>
  api.post('/workouts', { date: localDate(), ...data }).then((r) => r.data);
export const updateWorkout = (id, data) => api.put(`/workouts/${id}`, data).then((r) => r.data);
export const completeWorkout = (id) => api.post(`/workouts/${id}/complete`).then((r) => r.data);
export const skipUpcomingWorkout = (data) =>
  api.post('/workouts/skip', { date: localDate(), ...data }).then((r) => r.data);
export const skipWorkout = (id) => api.post(`/workouts/${id}/skip`).then((r) => r.data);
export const deleteWorkout = (id) => api.delete(`/workouts/${id}`).then((r) => r.data);
export const getLastByExercise = (exerciseId, params) =>
  api.get(`/workouts/last-by-exercise/${exerciseId}`, { params }).then((r) => r.data);

// ── Progress ─────────────────────────────────────────────────
export const getStats = () => api.get('/progress/stats').then((r) => r.data);
export const getVolumeProgress = (params) => api.get('/progress/volume', { params }).then((r) => r.data);
export const getExerciseProgress = (id, params) =>
  api.get(`/progress/exercise/${id}`, { params }).then((r) => r.data);
export const getPersonalBests = () => api.get('/progress/personal-bests').then((r) => r.data);

// ── Training intelligence (Phase 3) ─────────────────────────
export const getMuscleVolume = (params) =>
  api.get('/progress/muscle-volume', { params }).then((r) => r.data);
export const getSuggestions = () => api.get('/progress/suggestions').then((r) => r.data);
export const getOneRm = (exerciseId, params) =>
  api.get(`/progress/one-rm/${exerciseId}`, { params }).then((r) => r.data);
export const getBodyweight = (params) =>
  api.get('/progress/bodyweight', { params }).then((r) => r.data);
export const logBodyweight = (data) =>
  api.post('/progress/bodyweight', { date: localDate(), ...data }).then((r) => r.data);
export const deleteBodyweight = (id) =>
  api.delete(`/progress/bodyweight/${id}`).then((r) => r.data);

// ── Coach ────────────────────────────────────────────────────
export const getCoachLatest = () => api.get('/coach/latest').then((r) => r.data);
export const getCoachHistory = (params) =>
  api.get('/coach/history', { params }).then((r) => r.data);
export const getReadiness = () => api.get('/coach/readiness').then((r) => r.data);
export const getCheckin = () =>
  api.get('/coach/checkin', { params: { date: localDate() } }).then((r) => r.data);
export const getCheckins = (params) =>
  api.get('/coach/checkins', { params }).then((r) => r.data);
export const saveCheckin = (data) =>
  api.post('/coach/checkin', { date: localDate(), ...data }).then((r) => r.data);
export const getSessionFeel = (workoutId) =>
  api.get(`/coach/session-feel/${workoutId}`).then((r) => r.data);
export const saveSessionFeel = (data) =>
  api.post('/coach/session-feel', data).then((r) => r.data);
export const getAdherence = (params) =>
  api.get('/coach/adherence', { params }).then((r) => r.data);
export const getCoachMessages = (params) =>
  api.get('/coach/messages', { params }).then((r) => r.data);
export const sendCoachMessage = (message) =>
  api.post('/coach/chat', { message }).then((r) => r.data);
