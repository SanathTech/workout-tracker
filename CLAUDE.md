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
npm run db:apply-muscles                     # populate exercise_muscles from muscles.js; dry run. add `-- --apply`
npm test                                     # 5 suites, 101 assertions. DATABASE_URL must be LOCAL — it truncates
npm run test:setup                           # schema + seed + muscle mapping for a fresh test database

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
- Shared component classes (`.card`, `.input`, `.btn-secondary`, `.btn-ghost`, `.label`, `.tag`, `.section-label`, `.chip`) carry `dark:` variants in `src/index.css`.
- **The design language is flat, not carded** (2026-08-04, matching the session ledger):
  pages are sections separated by hairline `divide-y`/`border-t` rules, headed by
  `.section-label` (11px uppercase), with small data facts as `.tag` chips (sets×reps,
  rest ranges, statuses, workout summary numbers) and digits in `tabular-nums`. `.card`
  survives only for genuinely floating surfaces (login panel, error boundary, popover
  menus, bottom sheets). The editors flattened in P4 — don't reintroduce bordered boxes
  for page content anywhere.
- **Mobile is the primary target, and the shared classes encode that.** `.btn` and `.chip`
  carry `min-h-11 md:min-h-0` (44px is the touch minimum; `py-2` alone gave 37px). `.input`
  is `text-base md:text-sm` because iOS Safari zooms the page on focusing any input under
  16px. `.card` is `p-3 md:p-5` — 20px of padding all round was coming out of the set
  inputs. Don't "tidy" these back to a single size.
- `.badge` is a label, `.chip` is a tap target. Filter rows want `.chip`.
- Muted text is `text-neutral-500 dark:text-neutral-400`. Both halves matter: `neutral-500`
  on `neutral-900` is 3.78:1 and `neutral-400` on white is 2.52:1 — each fails AA in the
  other theme.
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
  **Week boundaries are the same question**, so `/muscle-volume` gets "this week" from
  `currentWeekStart()` (app timezone, Monday-based to match `DATE_TRUNC('week', …)`), not
  from Postgres `CURRENT_DATE`. Using the latter silently reported zero sets for every
  muscle whenever the UTC server was still in the previous ISO week — the test suite catches
  this, because it dates its sessions from the host clock.
- **Nullable text fields distinguish absent from empty.** `COALESCE(col, $n)` reads a cleared
  field as "not provided" and restores the old value. Use the `'field' in req.body` +
  `CASE WHEN $n::boolean THEN ... ELSE col END` pattern (see `workouts.notes`,
  `programs.description`, `programs.total_weeks`).
- **Auth fails open when unconfigured.** With `AUTH_PASSWORD_HASH`/`SESSION_SECRET` unset the
  API stays public and logs a warning; `GET /health` reports `auth: "on" | "off"`. That's
  deliberate — refusing everything would brick the live app on deploy, before there's any way
  to log in. Check `/health` after changing env vars.
- Locale is never hardcoded. Pass `undefined` to `toLocale*String` so it follows the device.
- **Back buttons use `useSmartBack(fallback)`**, never a hard-coded Link — a workout opened
  from History must return to History. The hook falls back when the tab has no in-app
  history (deep link / PWA cold start).
- **The Detail page's completion band keys off `location.state.justFinished`**, set only by
  the session's Finish navigation. PRs-today are derived client-side from
  `/progress/personal-bests` dates — don't add a dedicated endpoint for it.
- **The session's unsaved edits live in `localStorage`, not the query cache.** `utils/draft.js`
  writes the pending payload *and* a snapshot of the workout shape on every edit, and clears
  it only when the server confirms that exact payload. A surviving draft therefore means
  unsaved work. `['workout', id]` stays out of the persisted query cache (see `main.jsx`) so
  stale server data can't land on live edits — the draft is what makes a cold offline reload
  render, so don't "simplify" by persisting the query instead.
- **The service worker must never auto-reload, but it must not go quiet either.** A worker
  taking over on its own would remount the page and drop anything typed inside the 1200ms
  autosave debounce. Waiting for every client to close instead means an installed PWA sits on
  stale code indefinitely — that is how a deployed auth fix reached the server and never
  reached the phone, and the symptom ("nothing happens until I refresh") looks exactly like
  the bug it was meant to fix. `sw-update.js` installs quietly and `UpdatePrompt` offers the
  reload, so the choice is explicit.
- **The frontend's `ignoreCommand` compares against `$VERCEL_GIT_PREVIOUS_SHA`, not `HEAD^`.**
  The project skips builds when nothing under `frontend/` changed. With `HEAD^` that only
  inspects the *last* commit, so fast-forwarding several commits onto `main` at once skipped
  a build whose frontend changes were in an earlier commit of the same push — Phase 3's UI
  never deployed while its API did. `$VERCEL_GIT_PREVIOUS_SHA` is the last *successfully
  deployed* SHA, which is the correct baseline. The `[ -n ... ] &&` guard makes an absent
  variable build rather than skip.
- **Cache-affecting fixes can't be verified by curling production.** The origin serving new
  bytes says nothing about what an installed client is running. Check the asset hash in the
  page, not just the deploy.
- **Don't add `manualChunks` for Recharts.** Naming it makes Vite treat it as an entry
  dependency and emit a `modulepreload`, so the 525kB downloads on first paint anyway. The
  `React.lazy` import of `/progress` in `App.jsx` is what does the split.

- **`exercises.muscle_group` is the coarse label; `exercise_muscles` is the analytical one.**
  The six groups (Chest/Back/Legs/…) are what the library UI groups and filters by and are
  staying. Volume analysis reads `exercise_muscles`, which credits a set 1.0 to what it
  primarily trains and 0.5 to what it assists — "Legs: 20 sets" can't tell you whether that's
  18 quad sets and 2 hamstring, which is the only version of the question worth asking.
  The mapping lives in `src/db/muscles.js`; edit it and re-run `db:apply-muscles -- --apply`,
  which rewrites each exercise's rows. The script reports anything it matched by keyword or
  fell back to a coarse group — those are guesses, and a wrong one silently skews every
  weekly total that muscle appears in.
- **Estimated 1RM is omitted above 12 reps, never extrapolated.** Epley inflates badly past
  that (a 25-rep 40kg set reported as a 73kg "one-rep max"). `/progress/one-rm` returns no
  point and `/progress/personal-bests` returns `est_1rm: null`. Personal bests are ranked on
  load, not on the estimate — ranking by 1RM let a lighter high-rep set outrank a heavier one.
- **Progression is double progression**, driven off the rep range and target RIR the program
  already stores: every working set at the top of the range means load is no longer the
  limiter → add weight (2.5kg compound, 1.25kg isolation) and drop back down the range.
  Suggestions read the last *completed* session, so the workout being logged can't move its
  own goalposts.

- **`npm test` truncates tables and refuses any non-local `DATABASE_URL`.** The suites seed
  their own programs, so each one starts from a reset database; the host allowlist in
  `tests/run.mjs` is what stops that from ever pointing at Neon. Don't relax it.
- **Only `working` sets count.** `workout_sets.set_type` is `working | warmup | drop |
  failure`. Warm-ups are excluded from volume, per-muscle sets, stats, 1RM, personal bests
  and progression — seven queries in `progress.js` carry the filter, and they have to agree
  or the same session reports different numbers on different cards. Drop and failure sets
  DO count: they're working sets taken past the prescribed stopping point. An unrecognised
  value is stored as `working`, because a typo must not silently delete a set from the totals.

### Things explicitly chosen
- RIR (reps in reserve) is a routine *target* only; not captured per logged set, to keep logging fast.
- One active program at a time. New programs auto-archive the previous active one on start.
- Substitutes: preset list per exercise + fall back to the full library.
- Wiping was OK when we restructured — the old `workout_plans`/`plan_exercises`/`workouts` shape was dropped in the Programs rebuild.

## The coach

The AI coach's brain lives entirely in this repo: persona and prompts
(`src/util/coachPrompt.js`), all three context bundles (`src/util/coachContext.js`),
pricing/budget (`src/util/coachSpend.js`), and the generation endpoint
(`src/routes/coachRun.js`, machine-authed via `COACH_RUN_SECRET`, mounted before
`requireAuth`). The nas-laptop timers are dumb triggers — they pull Garmin and curl
`POST /api/coach/run?kind=daily|weekly`. Data ingest (garth/intervals.icu syncs) stays
on nas-laptop; it only writes rows. There is deliberately no prompt text outside this
repo — that was tried and the two copies drifted. Hub tables come from
`src/db/schema_hub.sql` (additive-only, own `db:init-hub`; never merge into schema.sql,
which wipes). Backend env vars: `ANTHROPIC_API_KEY`, `COACH_RUN_SECRET`,
`COACH_NTFY_URL`. Anchor any hub date window to `todayInAppTimezone()`, never Postgres
`CURRENT_DATE` — Neon is UTC and a Melbourne morning is still "yesterday" there.

## Known quirks / open follow-ups

- No linter or types, and no frontend unit tests — CI builds the frontend, which catches
  bad imports and syntax but not behaviour.
- **The session screen is a ledger, and cells-not-boxes is the load-bearing idea.** One
  44px grid row per set (`LEDGER_COLS`: set# / prev / kg / reps / rir), no card, no
  input boxes — values are bare text in tappable cells, and **tapping PREV is the
  one-tap log**: it copies last session's numbers into the blanks and the row counts as
  done. **Ghost placeholders are the AIM, not an echo of PREV** (owner call,
  2026-08-10): they show the progression engine's suggestion — new weight at the bottom
  of the range on increase, same weight and one more rep (capped at the top) on hold —
  and plain unit labels when there's no suggestion. PREV shows what happened; ghost
  shows what to do. "Done" is derived
  from the row carrying REPS (the green tint), not stored — weight alone is staging,
  because the owner keys the weight in before starting the set; reps are what make it
  history. There is nothing to uncheck; clearing the cells or swipe-removing the row
  is the undo. This is the
  Strong/Hevy layout, chosen deliberately (2026-08-04) after the boxed two-line version
  read as cluttered. Consequences that are easy to break:
  - **RIR is the fifth column, ghosted.** The per-set target shows as the cell's
    placeholder; typing overrides it, blank backfills the target server-side. It earns
    its place by absorbing the slack the `1fr` PREV column otherwise collects — remove
    it and PREV balloons (owner call, 2026-08-04, reversing the brief chip-only
    experiment from the same redesign).
  - **Set removal is swipe-left → Remove** (`useSwipeToReveal`) — the ledger has no room
    for an always-visible ✕. The reveal engages only on clearly-horizontal drags so
    vertical scroll and input taps stay native, and it springs shut after 5s.
  - The exercise meta is a row of chips ("3 × 4–6", "3–5m rest", warm-up), plus a
    coloured suggestion chip whose reason expands on tap (owner preference, 2026-08-04 —
    chips over a muted text line). Swap-exercise stays on the name; notes and remove
    live behind ⋯.
  - **There is no tick column and no rest timer — removed 2026-08-10, don't reintroduce
    them.** The owner rests by his Garmin, and with the timer gone the tick was a second
    button for what the PREV tap already does (both only ever filled the blanks). The
    rest chips stay: they're the program's prescription, useful as information.
  - `± steppers` still don't fit and are still out.
- The service worker precaches the shell only. API responses are never cached — stale sets
  are worse than an error, and a cached 401 would outlive a re-login.
- The repo owner uses a 12-week Min-Max 5x/week structure (Upper 1, Lower 1, rest, Upper 2, Lower 2, Arms/Delts, rest). The original spreadsheet is the source of truth for routine setup — see chat history if migrating data.
