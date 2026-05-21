# Workout Tracker — context for Claude

A personal workout-tracking PWA deployed at **workout.sanathtech.com**. Single-user (the repo owner), used to follow structured multi-week training programs and log sets each gym visit. Replaces a Google Sheets workflow.

## Stack at a glance

| Piece | Tech |
| --- | --- |
| Frontend | Vite + React 18, React Router, React Query, Tailwind CSS, Axios, Recharts |
| Backend | Express on Vercel serverless (`backend/src/index.js` exports the `app`) |
| DB | Neon Postgres |
| Hosting | Two separate Vercel projects (see Deployment) |

## Repo layout

```
backend/
  src/
    index.js                 Express app + Vercel entry (exports `app`)
    db/
      schema.sql             Source of truth for the schema. Drops & recreates non-exercise tables.
      init.js                Runs schema.sql against DATABASE_URL.
      seed.js                Seeds the exercise library.
    routes/
      exercises.js           Library CRUD + groups
      programs.js            Programs CRUD + /start /end /active
      workouts.js            Workouts (start from routine, update, complete, history)
      progress.js            Stats, weekly volume, per-exercise progress, PRs
  vercel.json                Legacy v2 config (see Deployment — don't "modernize")
frontend/
  src/
    api/client.js            All HTTP calls (axios). Single source for endpoint URLs.
    components/
      Layout.jsx / Navbar.jsx
    pages/
      Dashboard.jsx          "Up next" card + recent workouts + stats
      Program.jsx            View/edit active program; switch between programs
      WorkoutSession.jsx     /session/:id — log sets, swap exercises, finish
      WorkoutDetail.jsx      /workouts/:id — read-only past workout
      Progress.jsx           Charts + PRs (Recharts)
      ExerciseLibrary.jsx    Browse/add exercises
    index.css                Tailwind layers + dark-mode CSS overrides
  tailwind.config.js         `darkMode: 'class'`
  index.html                 Inline script applies `.dark` before paint
```

## Domain model

Program → Routines → Workouts (logged sessions). Set up once, follow forever.

- **programs** — multi-week container with `status: draft | active | completed | archived`. A partial unique index enforces **one active program at a time**. Has `total_weeks`. Completion is automatic: once `total_weeks × routines_per_cycle` workouts are completed, status flips to `completed`.
- **routines** — ordered children of a program (e.g. Upper 1, Lower 1, Upper 2, Lower 2, Arms/Delts). Same template every week; progression is driven by the user lifting heavier over time, not by per-week template variation.
- **routine_exercises** — per-exercise targets: `target_sets`, `rep_range_low/high`, `target_rir`, `rest_seconds`, `notes`.
- **routine_exercise_subs** — preset substitutes (per exercise), shown first; users can also pick from the full library mid-workout.
- **workouts** — `status: in_progress | completed`. Snapshots `routine_name` and `program_week` at start so they survive routine renames/deletes. `POST /api/workouts` with `{ routine_id }` pre-fills `workout_exercises` and empty target sets from the routine template.
- **workout_exercises** + **workout_sets** — the logged data. `POST /api/workouts/:id/complete` marks done and may auto-complete the program.

### "Next workout" logic
Sequence-driven, no day-of-week binding. `next_routine = routines[(completed_count) % routines_per_cycle]`. Skip days freely; the sequence picks up where you left off. Computed server-side in `GET /api/programs/active` as `program.progress`.

### "Previous set" hint
`GET /api/workouts/last-by-exercise/:id?exclude=<current_workout_id>` returns the most recent completed sets for an exercise. Shown under each set input as "prev 27.5kg x 8" — drives progressive overload.

## Common commands

```bash
# Backend
cd backend
npm install
npm run dev                                  # nodemon on :3001 (needs LOCAL_DEV=1 env or NODE_ENV!=production)
npm run db:init                              # WIPE + recreate schema (preserves exercises table)
npm run db:seed                              # seed exercise library

# Frontend
cd frontend
npm install
npm run dev                                  # Vite on :5173, proxies /api to :3001
npm run build                                # output to frontend/dist
```

After any schema change in `backend/src/db/schema.sql`, **run `npm run db:init` against the production Neon DB** (or paste the schema into the Neon SQL Editor). The repo owner has done the init for the current schema.

## Deployment

**Two separate Vercel projects under one team:**
- `workout-tracker` (backend) — Root Directory: `backend`. Uses **legacy `version: 2` + `builds` + `routes`** in `backend/vercel.json`. **Do not "modernize"** this to the new `rewrites` + `api/` style — we tried it (closed PR #3) and Vercel's project-level config doesn't pick up the new layout cleanly. The legacy config works; leave it.
- `workout-tracker-frontend` — Root Directory: `frontend`. Vite framework preset.

**Env vars:**
- Backend: `DATABASE_URL` (Neon), `NODE_ENV=production`
- Frontend: `VITE_API_URL` pointing at the deployed backend (e.g. `https://workout-tracker-xxx.vercel.app`)

**Custom domain:** `workout.sanathtech.com` → the frontend project. CORS in `backend/src/index.js` allows `workout.sanathtech.com`, `*.vercel.app`, and `localhost`.

**Sandbox network note:** the Claude Code web sandbox's outbound network policy blocks port 5432, so I can't reach Neon from here. The repo owner runs DB ops locally or via the Neon SQL Editor.

## Conventions and lessons

### Styling
- **Dark mode is the default.** Class-based (`darkMode: 'class'` in `tailwind.config.js`). An inline script in `index.html` sets `.dark` on `<html>` before paint based on `localStorage.theme` (defaults to dark). Toggle is in the Navbar.
- Shared component classes (`.card`, `.input`, `.btn-secondary`, `.btn-ghost`, `.label`) carry `dark:` variants in `src/index.css`.
- Pages use a lot of raw Tailwind utilities (`bg-white`, `text-gray-500`, `border-gray-200`, etc.). Rather than retrofit `dark:` variants everywhere, `index.css` has a small layer of `.dark .<class>` overrides that remap those utilities. **When adding new pages, you can keep using the same raw utilities — they'll theme correctly automatically.**

### Code
- Don't add comments that just narrate behavior. Only comment when the *why* is non-obvious.
- Don't add backward-compat or unused exports. We move forward and rebuild.
- No multi-paragraph docstrings or planning files. Keep changes minimal.
- React Query is the cache layer. After any mutation that changes server state, invalidate the relevant query keys. Watch out: starting a program needs to invalidate `['active-program']`, `['programs']`, **and** `['program', id]`.

### Backend
- All routes are CommonJS Express routers in `backend/src/routes/`. Each route file pulls `db` from `backend/src/db/index.js`.
- Use `db.pool.connect()` + `BEGIN/COMMIT/ROLLBACK` for multi-statement mutations. Existing code in `programs.js` and `workouts.js` is the pattern.
- The `fetchProgramTree` / `fetchWorkout` helpers exist so callers can return a hydrated payload in one place.

### Git / PR workflow
- Develop on a `claude/<topic>` branch. Always branch from the latest `main`.
- **Check PR state before pushing follow-up commits.** The repo owner merges fast. If the PR you intend to push to is already merged, branch from main and open a new PR with the follow-up — don't push to the merged branch.
- Use `mcp__github__pull_request_read` to check status.
- Don't create PRs unless asked.

### Things explicitly chosen
- RIR (reps in reserve) is a routine *target* only; not captured per logged set, to keep logging fast.
- One active program at a time. New programs auto-archive the previous active one on start.
- Substitutes: preset list per exercise + fall back to the full library.
- Wiping was OK when we restructured — the old `workout_plans`/`plan_exercises`/`workouts` shape was dropped in the Programs rebuild.

## Known quirks / open follow-ups

- Recharts `CartesianGrid stroke="#f0f0f0"` in `pages/Progress.jsx` is hardcoded — too bright in dark mode. Easy follow-up.
- Frontend bundle is ~670 kB; Vite warns. Code-splitting Recharts would shave a lot off if it becomes a problem.
- No auth. Single-user app on a personal domain. Don't add auth unless asked.
- The repo owner uses a 12-week Min-Max 5x/week structure (Upper 1, Lower 1, rest, Upper 2, Lower 2, Arms/Delts, rest). The original spreadsheet is the source of truth for routine setup — see chat history if migrating data.
