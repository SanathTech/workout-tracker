# Workout Tracker — context for Claude

A personal workout-tracking PWA deployed at **workout.sanathtech.com**. Single-user (the repo owner), used to follow structured multi-week training programs and log sets each gym visit. Replaces a Google Sheets workflow.

## Stack at a glance

| Piece | Tech |
| --- | --- |
| Frontend | Vite + React 18, React Router, React Query, Tailwind CSS, Axios |
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
      progress.js            Stats, weekly volume, per-exercise progress, PRs, /suggestions
      mcp.js                 The claude.ai connector (read-only, capability URL) — see "The claude.ai connector"
    util/aim.js              The engine verdict shaped as the session's one Aim line
    util/rotation.js         Next up = the routine done longest ago
    util/coachContext.js     The connector's reads (readiness, load, activities, gym sessions, bodyweight, next up)
  vercel.json                Legacy v2 config (see Deployment — don't "modernize")
frontend/
  src/
    api/client.js            All HTTP calls (axios). Single source for endpoint URLs.
    components/
      Layout.jsx / Navbar.jsx  Bottom bar = TWO tabs: Home, History (same two on desktop)
      AimLine.jsx            The ONE "Aim 52.5 kg × 6 · RIR 1 · why ›" line per exercise (engine only)
      WorkoutRow.jsx         The one row for a logged workout (History)
      FinishSheet.jsx        Post-Finish summary (duration/sets/volume/↑/★). No rating.
    pages/
      Home.jsx               Open session → Resume | Finish; else Next up (rotation) + "Or pick another" (each one tap) · last session line · Edit routines / Exercises links. Handles /?start=next
      History.jsx            Completed sessions, newest first, paged. Skips hidden
      ProgramEdit.jsx        /program/new and /program/:id/edit ("Edit routines"). No weekday, no week count; a new program starts on save
      WorkoutSession.jsx     /session/:id — sticky header + progress bar, 3-state exercise list, ledger
      WorkoutDetail.jsx      /workouts/:id — read-only past workout, plus the session's heart rate (avg/max, minutes over 153, HRR60, load) when the watch recorded one
      ExerciseLibrary.jsx    Browse/add exercises
    components/ui.jsx        Page / Section / Disclosure / Sheet primitives (2026-09-08)
    index.css                Tailwind layers + the shared component classes (dark only)
  tailwind.config.js         Type-role font sizes only
```

## Domain model

Program → Routines → Workouts (logged sessions). Set up once, follow forever.

- **programs** — multi-week container with `status: draft | active | completed | archived`. A partial unique index enforces **one active program at a time**. Has `total_weeks`. Completion is automatic: once `total_weeks × routines_per_cycle` sessions are completed *or skipped*, status flips to `completed`.
- **routines** — ordered children of a program (e.g. Upper 1, Lower 1, Upper 2, Lower 2, Arms/Delts). Same template every week; progression is driven by the user lifting heavier over time, not by per-week template variation.
- **routine_exercises** — per-exercise targets: `target_sets`, `rep_range_low/high`, `target_rir`, `rest_seconds`, `notes`.
- **routine_exercise_subs** — preset substitutes (per exercise), shown first; users can also pick from the full library mid-workout.
- **workout_exercises.routine_exercise_id** — the prescription slot a logged row came from. Targets attach **by slot first**, by `exercise_id` second, so a mid-session swap keeps its rep range/RIR/how-to, and `POST /api/workouts/:id/default-exercise` can promote the swapped-in exercise to the routine's default in place (old default → first substitute). Ad-hoc rows are `NULL`.
- **workouts** — `status: in_progress | completed | skipped`. Snapshots `routine_name` and `program_week` at start so they survive routine renames/deletes. `POST /api/workouts` with `{ routine_id }` pre-fills `workout_exercises` and empty target sets from the routine template.
- **workout_exercises** + **workout_sets** — the logged data. `POST /api/workouts/:id/complete` marks done and may auto-complete the program.

### "Next workout" logic
**A rotation, never a calendar (2026-11-03, `util/rotation.js`).** `progress.next_routine` is the routine done longest ago: never-done first, ties in program order. An open session counts as today's, so the routine already under way isn't also offered. Skips don't count as done. Past sessions match a routine by id OR name, because the editor re-inserts routines under new ids. Each routine in `GET /api/programs/active` carries `last_done` + `in_progress`. Any routine can be started on any day, and nothing is ever banked as missed. The weekday schedule it replaced (Oct 2026) auto-skipped every day he couldn't make, and his weeks stopped having fixed gym days. Don't bring back days, weeks-behind or missed-day logic. `routines.weekday` is a dead column.

### Skipping a workout
A skip is a real `workouts` row with `status = 'skipped'` and no logged sets. It doesn't move the rotation. The app's one entry point is the session's ⋯ → "Discard this workout" (`POST /api/workouts/:id/skip`). `POST /api/workouts/skip { routine_id }` has no caller since Today went. Every stats query filters on `status = 'completed'`, so skips never touch volume, PRs, or counters. Deleting the skipped workout is the undo — it hands the slot back to that routine.

### Resuming a finished workout
Half one day, half the next: **Resume** (detail page, or ⋯ in the session's edit mode) is `POST /api/workouts/:id/resume`, which flips a `completed` workout back to `in_progress` and stamps `resumed_at`. Finish then ADDS that sitting (`NOW() - resumed_at`, same 6h cap) to `duration_minutes` — the night between isn't training. **Edit** still saves in place and times nothing. The workout keeps its original date; while resumed it can't be skipped (that would discard the first sitting), and it can't be resumed while another session is open. Known gap: the second sitting's Garmin activity is on a different day, so the session's HR panel only covers the first.

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
npm test                                     # 13 suites. DATABASE_URL must be LOCAL — it truncates
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
- Backend: `MCP_TOKEN` (the connector's capability URL), `DATABASE_URL` (Neon — use the **pooled** `-pooler` host; the pool is capped at
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
- **Dark only** (2026-09-08 redesign, PR 1). The light theme, the toggle, `darkMode: 'class'`
  and the pre-paint `.dark` script are gone; `<meta name="color-scheme" content="dark">` keeps
  native controls in step. Never write a `dark:` variant — there is nothing for it to vary from.
- **One ramp**, written at the top of `src/index.css`: page `neutral-950` · raised surface
  `neutral-900` (sheets, tiles) · hairline `neutral-800` (the only border/divide shade) ·
  title `neutral-200` · body `neutral-300` · muted `neutral-400` · ghost/placeholder
  `neutral-600` · accent text `emerald-400`, primary action `emerald-700` · coach/warning
  `amber-400` · danger `red-400`. Chart ink is the same ramp as hex (see `CHART` in
  the retired `Progress.jsx`). Don't introduce a neighbouring shade because it "looks close".
- **Primitives in `components/ui.jsx`**: `Page` (one column rhythm), `Section` (hairline +
  `.section-label` + optional action), `Disclosure` (the one expand glyph — `ChevronIcon`,
  never ▲▼/→), `Sheet` (the one bottom sheet: backdrop, Escape, body scroll lock, safe
  area; `tall` for full-height pickers, `closeOnEscape={false}` when the sheet has inner
  navigation). New screens are built from these; the remaining hand-written
  `border-t … pt-4` sections migrate as each screen is rebuilt in PRs 2–5.
- **One width.** `Layout` owns the column (`max-w-2xl`); pages don't set their own.
- Shared component classes (`.card`, `.input`, `.btn-*`, `.label`, `.tag`, `.section-label`, `.chip`) live in `src/index.css`.
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
- Muted text is `text-neutral-400` (4.6:1 on `neutral-950`); `neutral-500` fails AA on the
  raised surface, so it isn't in the ramp.

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
- **Layout is informed by `app_events`, and decided by watching him use it.** Telemetry says where he goes, never why: three weeks of dwell times missed every problem one spoken walkthrough found (2026-09-15). Sub-2s visits mean a screen was passed through, not used. Query telemetry before moving anything. The 2026-11-03 strip-back came from it: since the September rethink the session screen took 313 of ~600 visits and every other tab got seconds. The program editor is a route (`/program/new`, `/program/:id/edit`), never a mode of a page.
- Locale is never hardcoded. Pass `undefined` to `toLocale*String` so it follows the device.
- **Back buttons use `useSmartBack(fallback)`**, never a hard-coded Link — a workout opened
  from History must return to History. The hook falls back when the tab has no in-app
  history (deep link / PWA cold start).
- **Finish ends in a sheet, not a banner.** `FinishSheet` (duration · sets · volume,
  progressions ↑ from the cached `last-by-exercise` rows, PRs ★ from `/progress/personal-bests`
  filtered to today's date) is built client-side in `buildSummary` and shown over
  the session; Done navigates to the detail page. There is no `location.state.justFinished`
  any more and no dedicated PR endpoint — don't add either back.
- **The session has ONE aim line per exercise, and it is the engine's.** `/suggestions` returns
  the engine verdict plus `aim {weight_kg, reps, reps_high, rir, why, action}`
  (`backend/src/util/aim.js`); the ledger ghosts come from it. Coach notes used to override
  it (and grew an "overtaken call" rule because stale notes kept pinning old weights); they
  went in the 2026-11-03 strip-back. The `coach_notes` table still holds the old rows, and
  nothing reads it.
  ⚠ `created_at` comes back from pg as a Date; `String()`-ing one gives "Thu Sep 17 2026",
  which compares against a 'YYYY-MM-DD' workout date as nonsense and silently in the wrong
  direction. Use `dayInAppTimezone()` (util/dates.js) for any instant-vs-workout-day test.
- **A lift can carry its own load step** (2026-09-21). `exercises.load_step_kg`, nullable:
  set, the engine adds exactly that when the range is cleared; null, it falls back to the
  muscle-group rule (2.5kg compound, 1.25kg isolation). It had an editor on Lifts, which went in the 2026-11-03 strip-back; set it in SQL until he asks for one back. It is a property of the LIFT — the RDL moves 10kg
  because he takes it in 5kg-plate steps, the squat stays small because it is the lift his
  lower back objects to. A PUT that doesn't mention `load_step_kg` leaves it alone; sending
  null clears it back to the default.

- **Progression is double progression**, driven off the rep range and target RIR the program
  already stores: every working set at the top of the range means load is no longer the
  limiter → add weight (2.5kg compound, 1.25kg isolation) and drop back down the range.
  Suggestions read the last *completed* session, so the workout being logged can't move its
  own goalposts.
- **Progression is rest-aware** (2026-08-24, once sets carried `logged_at`). On a
  short-on-time day the plan is cut rest / hold weight / let reps fall — so a *compressed*
  session (median inter-set gap under the routine's `rest_seconds` floor; the gap includes
  the set itself, which makes the threshold conservative) is what the plan prescribes, not
  evidence about the weight. A hold verdict then comes from the most recent normal-rest
  session at the same weight and scope, the reason says so, and ghost targets never drop
  below the normal-rest baseline. Compressed sessions still count everywhere else (volume,
  muscle sets, PRs, history). Unstamped sets (all history before 2026-08-24) mean rest is
  *unknown*, never compressed. A topped-out compressed session still earns its increase.

- **The production pool is `max: 1` — never `pool.connect()` inside a handler that already
  holds a client.** The second connect waits on the first forever and the route hangs. Pass
  the held client down instead (`reconcileMissed(id, client)`). Locally the pool is 10, so
  the suite can't see this unless run as **`VERCEL=1 npm test`** — do that for any change
  touching connection handling (#148: 4 suites hung under VERCEL=1, all green without it).
- **`npm test` truncates tables and refuses any non-local `DATABASE_URL`.** The suites seed
  their own programs, so each one starts from a reset database; the host allowlist in
  `tests/run.mjs` is what stops that from ever pointing at Neon. Don't relax it.
- **Only `working` sets count.** `workout_sets.set_type` is `working | warmup | drop |
  failure`. Warm-ups are excluded from volume, per-muscle sets, stats, 1RM, personal bests
  and progression — seven queries in `progress.js` carry the filter, and they have to agree
  or the same session reports different numbers on different cards. Drop and failure sets
  DO count: they're working sets taken past the prescribed stopping point. An unrecognised
  value is stored as `working`, because a typo must not silently delete a set from the totals.
- **Volume counts the body; progression does not.** On a `is_bodyweight` exercise
  `weight_kg` is what was *added* — 0 on a plain dip, negative on an assisted pull-up — so
  summing it raw reads a bodyweight set as no work and an assisted one as work destroyed
  (a real session totalled **-21kg** and the coach graded it a data entry glitch). Every
  volume query therefore goes through `SET_VOLUME`/`LOAD_JOINS` in `src/util/volume.js`,
  which adds his weight as of the session date and floors the result at zero. Five queries
  across `progress.js`, `workouts.js` and `coachContext.js` use it and have to agree.
  Personal bests, estimated 1RM and the progression suggestions still rank on `weight_kg`
  alone — -23kg → -20.5kg is the axis he moves along on an assisted lift, and folding
  bodyweight in would score a heavier morning as progress.

### The gym session's heart rate

`GET /workouts/:id` carries `heart_rate` when a `WeightTraining` activity exists for that
day. Every figure is computed over the LOGGED window — `workouts.duration_minutes`, i.e.
start → Finish — by nas-laptop's `gym_recal.py`, because he sometimes forgets to end the
Garmin activity: 17 Sep recorded 152 minutes against a 59-minute Day A, which diluted the
average HR to 96 and reported the highest load of his recent Day As from the least intense
session. When a recording overruns (>1.2x the logged session and >10 min extra) the sync
also scales `icu_training_load` by the share of HR-weighted work inside the window, PUTs
it back to intervals.icu so CTL/ATL stop carrying the idle tail, and pings. A trimmed
session says so on the page rather than silently disagreeing with Garmin Connect, which
keeps the original. Gym HR is still indicative, never ground truth — the logged sets are.

### Things explicitly chosen
- RIR (reps in reserve) is a routine *target* only; not captured per logged set, to keep logging fast.
- One active program at a time. New programs auto-archive the previous active one on start.
- Substitutes: preset list per exercise + fall back to the full library.
- Wiping was OK when we restructured — the old `workout_plans`/`plan_exercises`/`workouts` shape was dropped in the Programs rebuild.

## The claude.ai connector

The AI coach is gone (2026-11-03): no scheduled daily/weekly calls, no prompts, no
spend tracking, no coach notes, no check-in pushes. What stays is `routes/mcp.js`, a
read-only MCP server at `/api/mcp/<MCP_TOKEN>` that claude.ai uses to read live training
data when he asks Claude something. Six tools (`get_briefing` first; readiness, training
load, activities, strength sessions, bodyweight), all reading `util/coachContext.js`.
Data ingest (garth/intervals.icu syncs) stays on nas-laptop; it only writes rows. Hub
tables come from `src/db/schema_hub.sql` (additive-only, own `db:init-hub`; never merge
into schema.sql, which wipes). The retired features' tables (`coach_advice`,
`coach_notes`, `coach_messages`, `checkins`, `session_feel`, `checkin_nudges`) are kept
with their data and read by nothing except `get_strength_sessions`' historical RPE.
Anchor any hub date window to `todayInAppTimezone()`, never Postgres `CURRENT_DATE` —
Neon is UTC and a Melbourne morning is still "yesterday" there.

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
  - **Enter walks the whole ledger.** Inside a block the shared `handleEditorEnter` moves
    kg → reps → RIR → next set; on the LAST field of the last set the session page takes
    over, opens the next exercise still to do and focuses the first weight cell whose reps
    are blank (his ask, 2026-09-17 — it used to blur, leaving two taps to reach the next
    exercise's kg). The focus waits a render, because that block's inputs don't exist
    until it opens.
  - **The aim is stated ONCE, on the Aim line above the ledger.** A per-row recommendation
    strip shipped on 2026-09-17 (copied from RP, which has no persistent aim line) and came
    straight back out: rendered under the focused row it read as belonging to the NEXT set,
    and it repeated what the Aim line already said two rows up. Don't reintroduce it.
  - **A done row carries one glyph in its top-right corner**: ▲ improved / = matched /
    ▼ under, ranked load-then-reps (so less assistance is up). It compares the nth
    STRAIGHT set against the nth straight set last time — NOT the same row number, which
    warm-ups shift: two ramp-up sets would line today's first working set against last
    week's third and every arrow in the exercise would be wrong while still looking
    plausible. PREV stays row-for-row, because "what was in this row last time" is the
    question its one-tap copy answers.
  - **Straight sets carry the weight down.** Editing a set's weight fills the sets below it
    that are still to do AND were blank or matched the old number; a logged set, a warm-up,
    or one deliberately different is never touched.
  - **Still no rest timer** (reaffirmed 2026-09-17 after the RP research, whose users
    complain loudest about its absence): he rests by his Garmin. Don't reintroduce it.
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
