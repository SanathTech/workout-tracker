# 🏋️ Workout Tracker

A full-stack workout tracking web app built with React + Vite (frontend) and Node.js + Express + PostgreSQL (backend).

## Features

- **Log Workouts** — Record exercises, sets, reps, and weight per session
- **Workout Plans** — Create reusable plan templates (Push Day, Pull Day, etc.)
- **Progress Charts** — Weekly volume bar chart + per-exercise strength trend lines
- **Exercise Library** — 35+ seeded exercises organized by muscle group; add custom ones
- **Personal Bests** — Auto-tracked best weight per exercise
- **Dashboard** — Stats overview + recent workout history

## Tech Stack

| Layer | Stack |
|---|---|
| Frontend | React 18, Vite, TailwindCSS, Recharts, React Query, React Router |
| Backend | Node.js, Express |
| Database | PostgreSQL |

## Setup

### Prerequisites
- Node.js 18+
- PostgreSQL running locally

### 1. Create the database

```sql
CREATE DATABASE workout_tracker;
```

### 2. Backend

```bash
cd backend
cp .env.example .env
# Edit .env: set DATABASE_URL=postgresql://user:pass@localhost:5432/workout_tracker
npm install
npm run db:init    # creates tables
npm run db:seed    # seeds 35+ exercises
npm run dev        # API on http://localhost:3001
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

## API Reference

| Method | Path | Description |
|---|---|---|
| GET | `/api/exercises` | List (supports `?search=&muscle_group=`) |
| POST | `/api/exercises` | Create exercise |
| GET | `/api/plans` | List plans |
| POST | `/api/plans` | Create plan |
| GET | `/api/workouts` | List workouts |
| POST | `/api/workouts` | Log a workout |
| GET | `/api/workouts/:id` | Workout detail with sets |
| GET | `/api/progress/stats` | Aggregate stats |
| GET | `/api/progress/volume` | Weekly volume chart data |
| GET | `/api/progress/exercise/:id` | Per-exercise progress |
| GET | `/api/progress/personal-bests` | Best weight per exercise |