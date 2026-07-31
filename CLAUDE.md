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

- **programs** — multi-week container with `status: draft | active | completed | archived`. A partial unique index enforces **one active program at a time**. Has `total_weeks`. Completion is automatic: once `total_weeks × routines_per_cycle` sessions are completed *or skipped*, status flips to `completed`.
- **routines** — ordered children of a program (e.g. Upper 1, Lower 1, Upper 2, Lower 2, Arms/Delts). Same template every week; progression is driven by the user lifting heavier over time, not by per-week template variation.
- **routine_exercises** — per-exercise targets: `target_sets`, `rep_range_low/high`, `target_rir`, `rest_seconds`, `notes`.
- **routine_exercise_subs** — preset substitutes (per exercise), shown first; users can also pick from the full library mid-workout.
- **workouts** — `status: in_progress | completed | skipped`. Snapshots `routine_name` and `program_week` at start so they survive routine renames/deletes. `POST /api/workouts` with `{ routine_id }` pre-fills `workout_exercises` and empty target sets from the routine template.
- **workout_exercises** + **workout_sets** — the logged data. `POST /api/workouts/:id/complete` marks done and may auto-complete the program.

### "Next workout" logic
Sequence-driven, no day-of-week binding. `next_routine = routines[(completed_count + skipped_count) % routines_per_cycle]`. Skip days freely; the sequence picks up where you left off. Computed server-side in `GET /api/programs/active` as `program.progress`.

### Skipping a workout
A skip is a real `workouts` row with `status = 'skipped'` and no logged sets — rows are what advance the sequence, so skipping "Lower 1" makes the next routine come up instead. Two entry points: `POST /api/workouts/skip { routine_id }` skips the upcoming session outright (Dashboard / Program page), `POST /api/workouts/:id/skip` bails out of a session already started (session page). Every stats query filters on `status = 'completed'`, so skips never touch volume, PRs, or counters. Deleting the skipped workout is the undo — it hands the slot back to that routine.

### "Previous set" hint
`GET /api/workouts/last-by-exercise/:id?exclude=<current_workout_id>` returns the most recent completed sets for an exercise. Shown under each set input as "prev 27.5kg x 8" — drives progressive overload.

## Common commands

```bash
# Backend
cd backend
npm install
npm run dev                                  # nodemon on :3001 (needs LOCAL_DEV=1 env or NODE_ENV!=production)
npm run db:init                              # WIPE + recreate schema (preserves exercises table)
npm run db:migrate                           # non-destructive: apply additive column migrations in place (idempotent)
npm run db:seed                              # seed exercise library
npm run db:backfill-dates                    # one-shot date repair; dry run. add `-- --apply` to write
npm run auth:hash                            # generate AUTH_PASSWORD_HASH + SESSION_SECRET (reads stdin)

# Frontend
cd frontend
npm install
npm run dev                                  # Vite on :5173, proxies /api to :3001
npm run build                                # output to frontend/dist
```

After any schema change in `backend/src/db/schema.sql`, apply it to the production Neon DB. For **additive** changes (new nullable columns, dropping NOT NULL/defaults), add an idempotent statement to `backend/src/db/migrations.js` and **run `npm run db:migrate`** (or paste `backend/src/db/migrate.sql` into the Neon SQL Editor) — this preserves logged data. Use `npm run db:init` only for a full rebuild (it WIPES non-exercise tables). The repo owner has done the init for the current schema.

## Deployment

**Two separate Vercel projects under one team:**
- `workout-tracker` (backend) — Root Directory: `backend`. Uses **legacy `version: 2` + `builds` + `routes`** in `backend/vercel.json`. **Do not "modernize"** this to the new `rewrites` + `api/` style — we tried it (closed PR #3) and Vercel's project-level config doesn't pick up the new layout cleanly. The legacy config works; leave it.
- `workout-tracker-frontend` — Root Directory: `frontend`. Vite framework preset.

**Env vars:**
- Backend: `DATABASE_URL` (Neon — use the **pooled** `-pooler` host; the pool is capped at
  `max: 1` per lambda), `NODE_ENV=production`, `AUTH_PASSWORD_HASH`, `SESSION_SECRET`,
  optional `APP_TIMEZONE` (defaults to `Australia/Melbourne`)
- Frontend: `VITE_API_URL` must be **empty** in production. `frontend/vercel.json` rewrites
  `/api/*` to the backend project, so the API is same-origin and the session cookie works.
  Setting `VITE_API_URL` sends requests cross-origin, where `SameSite=Lax` strips the cookie
  and every request 401s.

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

### Invariants that are easy to break

- **Routines are retired, never deleted.** `writeRoutines` sets `deleted_at` instead of
  `DELETE`, because `workouts.routine_id` is `ON DELETE SET NULL` — a hard delete strips the
  prescribed sets/reps/RIR off every workout already logged against that program. **Every
  read of `routines` must filter `deleted_at IS NULL`.**
- **Dates are calendar days, not instants.** `workouts.date` is a `DATE` meaning "the day you
  trained". The client sends its own local date (`startWorkout` in `api/client.js`); the
  server falls back to `todayInAppTimezone()`, never the UTC clock. A `pg` type parser returns
  `DATE` as a plain `'YYYY-MM-DD'` string so the JSON doesn't shift with the server's TZ, and
  the frontend renders it via `formatDay()` — `new Date('2026-08-01')` parses as UTC midnight
  and renders as the previous day west of Greenwich.
- **Nullable text fields distinguish absent from empty.** `COALESCE(col, $n)` reads a cleared
  field as "not provided" and restores the old value. Use the `'field' in req.body` +
  `CASE WHEN $n::boolean THEN ... ELSE col END` pattern (see `workouts.notes`,
  `programs.description`, `programs.total_weeks`).
- **Auth fails open when unconfigured.** With `AUTH_PASSWORD_HASH`/`SESSION_SECRET` unset the
  API stays public and logs a warning; `GET /health` reports `auth: "on" | "off"`. That's
  deliberate — refusing everything would brick the live app on deploy, before there's any way
  to log in. Check `/health` after changing env vars.
- Locale is never hardcoded. Pass `undefined` to `toLocale*String` so it follows the device.

### Things explicitly chosen
- RIR (reps in reserve) is a routine *target* only; not captured per logged set, to keep logging fast.
- One active program at a time. New programs auto-archive the previous active one on start.
- Substitutes: preset list per exercise + fall back to the full library.
- Wiping was OK when we restructured — the old `workout_plans`/`plan_exercises`/`workouts` shape was dropped in the Programs rebuild.

## Known quirks / open follow-ups

- Frontend bundle is ~719 kB in one chunk; Vite warns. Route-level `React.lazy` + a Recharts
  `manualChunks` entry is the fix — Recharts is only needed on `/progress`.
- **Not offline-capable.** There's a manifest and icons, but no service worker, so a gym
  dead-spot degrades the app to an autosave retry banner. Highest-value open item.
- No rest timer and no per-set completion state, so `rest_seconds` is captured and displayed
  but never used. `workouts.duration_minutes` is likewise rendered but never written.
- No tests, CI, linter or types.
- The repo owner uses a 12-week Min-Max 5x/week structure (Upper 1, Lower 1, rest, Upper 2, Lower 2, Arms/Delts, rest). The original spreadsheet is the source of truth for routine setup — see chat history if migrating data.
