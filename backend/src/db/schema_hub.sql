-- Fitness hub schema — health/training data alongside the workout tracker.
-- Design: ~/Projects/fitness-hub-design.md
--
-- ADDITIVE ONLY. This file must never DROP or TRUNCATE. It is deliberately separate
-- from schema.sql, which drops and recreates every non-exercise table: a tracker
-- re-init must not be able to wipe years of health history.
-- Applied by `npm run db:init-hub` (idempotent, safe to re-run).
--
-- Sources stay in their own tables rather than merging into one daily row. intervals.icu
-- and garth overlap on RHR/sleep/weight, and a merged row loses the answer to "which
-- device said this". Readers pick a preference order; the writers never fight.

-- One row per intervals.icu activity (swim/run/ride/walk/gym). `id` is intervals'
-- own string id, so re-syncing an activity updates it in place.
CREATE TABLE IF NOT EXISTS activities (
  id                VARCHAR(32) PRIMARY KEY,
  start_date_local  TIMESTAMP NOT NULL,          -- local wall clock, as intervals stores it
  date              DATE NOT NULL,               -- calendar day, for joins against workouts.date
  type              VARCHAR(40) NOT NULL,        -- Swim | Run | Walk | Ride | WeightTraining | Virtual*
  name              TEXT,
  moving_time       INTEGER,                     -- seconds
  elapsed_time      INTEGER,
  distance          NUMERIC(10, 2),              -- metres
  average_hr        INTEGER,
  max_hr            INTEGER,
  calories          INTEGER,
  pace              NUMERIC(10, 4),              -- m/s (intervals' unit); render as min/km
  training_load     NUMERIC(8, 2),               -- icu_training_load
  hr_load           NUMERIC(8, 2),
  trimp             NUMERIC(8, 2),
  intensity         NUMERIC(6, 2),               -- icu_intensity
  ctl               NUMERIC(8, 3),               -- the model AS OF this activity
  atl               NUMERIC(8, 3),
  hr_zone_times     INTEGER[],                   -- seconds in each HR zone
  pool_length       NUMERIC(6, 2),               -- swims only
  lap_count         INTEGER,
  average_stride    NUMERIC(6, 3),               -- swims: stroke length
  raw               JSONB NOT NULL,              -- full payload; 183 fields, most unused today
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-effort numbers computed from the per-second streams, by intervals-sync.py on
-- nas-laptop. Every summary average over a run with walk breaks describes the blend,
-- not the work (the 139spm cadence false alarm, the diluted stride length, the walk-
-- flattered HR) — this column carries the running-only figures and the detected
-- efforts so nothing downstream has to reason from a mixture. Compact by design: the
-- 2,800-point streams themselves are fetched, summarised and discarded.
--   runs:  {kind, run_only:{cadence_spm,pace_s_per_km,avg_hr,stride_m,share},
--           efforts:[{dur_s,peak_pace_s,avg_pace_s,cad_avg,cad_max,stride_m,hr_max}],
--           hrr_60}
--   swims: {kind, moving:{pace_s_per_100m,share}, rest:{total_s,count}}
ALTER TABLE activities ADD COLUMN IF NOT EXISTS stream_summary JSONB;

CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(date DESC);
CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(type);

-- Daily training-load model from intervals.icu (its `wellness` endpoint). TSB is not a
-- stored field anywhere — it is ctl - atl, so it is generated here rather than computed
-- in every caller.
CREATE TABLE IF NOT EXISTS training_load (
  date          DATE PRIMARY KEY,
  ctl           NUMERIC(8, 3),                   -- fitness
  atl           NUMERIC(8, 3),                   -- fatigue
  tsb           NUMERIC(8, 3) GENERATED ALWAYS AS (ctl - atl) STORED,  -- form
  ctl_load      NUMERIC(8, 2),
  atl_load      NUMERIC(8, 2),
  ramp_rate     NUMERIC(8, 4),
  resting_hr    INTEGER,                         -- Garmin via intervals; garth's is preferred
  sleep_secs    INTEGER,                         -- duration only — no stages, no score
  spo2          NUMERIC(5, 2),
  steps         INTEGER,                         -- history did NOT import; garth backfills it
  weight_kg     NUMERIC(5, 2),                   -- see the weight note below
  raw           JSONB NOT NULL,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Wellness intervals.icu does not carry: HRV, stress, Body Battery, sleep stages and
-- score, steps history. Written by the garth container on nas-laptop.
CREATE TABLE IF NOT EXISTS wellness_daily (
  date                 DATE PRIMARY KEY,
  hrv_last_night       INTEGER,                  -- ms, overnight average
  hrv_7d_avg           INTEGER,
  hrv_status           VARCHAR(20),              -- balanced | unbalanced | low | poor
  resting_hr           INTEGER,
  stress_avg           INTEGER,                  -- 0-100
  stress_max           INTEGER,
  body_battery_high    INTEGER,
  body_battery_low     INTEGER,
  body_battery_at_wake INTEGER,               -- what you started the day with
  sleep_score          INTEGER,
  sleep_secs           INTEGER,
  sleep_deep_secs      INTEGER,
  sleep_light_secs     INTEGER,
  sleep_rem_secs       INTEGER,
  sleep_awake_secs     INTEGER,
  respiration_avg      NUMERIC(5, 2),
  steps                INTEGER,
  -- Local wall-clock sleep window (no timezone, same convention as
  -- activities.start_date_local). Added 2026-08-10 for the protocol's bedtime
  -- anchor — the score alone can't say WHEN he went to bed.
  sleep_start          TIMESTAMP,
  sleep_end            TIMESTAMP,
  raw                  JSONB NOT NULL,
  synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE wellness_daily ADD COLUMN IF NOT EXISTS sleep_start TIMESTAMP;
ALTER TABLE wellness_daily ADD COLUMN IF NOT EXISTS sleep_end TIMESTAMP;

-- Weight has two sources: Garmin (training_load.weight_kg, ~179 days) and the app's
-- manual bodyweight_logs. bodyweight_logs wins where a row exists for the date — it is
-- a deliberate act, where the Garmin figure carries forward unchanged for days at a time
-- between actual scale readings. Readers should COALESCE in that order.

-- The 3-tap daily check-in from the PWA. Date-grain, one per day.
CREATE TABLE IF NOT EXISTS checkins (
  date        DATE PRIMARY KEY,
  mood        SMALLINT CHECK (mood BETWEEN 1 AND 5),
  energy      SMALLINT CHECK (energy BETWEEN 1 AND 5),
  soreness    SMALLINT CHECK (soreness BETWEEN 1 AND 5),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- How a single session felt, asked after "finish workout". Separate from checkins
-- because the grain is a session, not a day.
--
-- workout_id carries NO foreign key on purpose. `DROP TABLE workouts CASCADE` in
-- schema.sql would silently drop the constraint while leaving these rows, and SERIAL
-- ids restart, so a surviving FK would eventually point at the wrong session anyway.
-- Treat it as a soft reference and LEFT JOIN.
CREATE TABLE IF NOT EXISTS session_feel (
  id          SERIAL PRIMARY KEY,
  workout_id  INTEGER NOT NULL UNIQUE,
  date        DATE NOT NULL,
  rpe         SMALLINT CHECK (rpe BETWEEN 1 AND 10),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_feel_date ON session_feel(date DESC);

-- One row per coach run. `advice` is the structured payload the app renders from;
-- `markdown` is what ntfy sends. Cost is recorded per run so the budget alarm has
-- something to sum.
CREATE TABLE IF NOT EXISTS coach_advice (
  id             SERIAL PRIMARY KEY,
  kind           VARCHAR(20) NOT NULL,           -- daily | weekly
  for_date       DATE NOT NULL,
  advice         JSONB NOT NULL,
  markdown       TEXT,
  model          VARCHAR(60),
  input_tokens   INTEGER,
  output_tokens  INTEGER,
  cost_usd       NUMERIC(8, 5),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coach_advice_kind_date ON coach_advice(kind, for_date DESC);

-- In-app chat. Scheduled advice and chat share one thread so the coach sees a
-- continuous conversation rather than two disconnected halves.
CREATE TABLE IF NOT EXISTS coach_messages (
  id             SERIAL PRIMARY KEY,
  role           VARCHAR(12) NOT NULL,           -- user | assistant
  content        TEXT NOT NULL,
  model          VARCHAR(60),
  input_tokens   INTEGER,
  output_tokens  INTEGER,
  -- Chat spends from the same monthly pocket as the scheduled runs, so it has to be
  -- costed the same way — the budget check sums coach_advice and coach_messages
  -- together. Without this column, chat would be free in the accounting and the cap
  -- would be enforced against half the spend.
  cost_usd       NUMERIC(8, 5),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE coach_messages ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(8, 5);

CREATE INDEX IF NOT EXISTS idx_coach_messages_created ON coach_messages(created_at DESC);

-- Last successful run per sync source. garth is an unofficial Garmin client that can
-- break without warning, so "when did this last work" has to be queryable — it is what
-- the staleness alarm reads.
CREATE TABLE IF NOT EXISTS sync_state (
  source        VARCHAR(40) PRIMARY KEY,         -- intervals_activities | intervals_wellness | garth
  last_success  TIMESTAMPTZ,
  last_attempt  TIMESTAMPTZ,
  last_error    TEXT,
  rows_written  INTEGER,
  detail        JSONB
);

-- Every action taken in the app, and the events around it. Two jobs: give a recurring
-- bug evidence instead of inference (the autosave loop wedged four times and each
-- diagnosis was reconstructed from HTTP logs afterwards), and answer what the layout
-- redesign otherwise has to guess at — which affordances actually get used, in what
-- order, and where he doubles back because something was not where he expected.
--
-- Deliberately records ACTIONS, not values. The weights and reps are already stored as
-- workout data; logging keystrokes would be volume without information.
--
-- Retention is 30 days, pruned on write (see routes/events.js). Nothing here is worth
-- keeping longer than the question it answers.
CREATE TABLE IF NOT EXISTS app_events (
  id          BIGSERIAL PRIMARY KEY,
  -- The client's clock, so ordering within a session survives batching, and the
  -- server's, because the client's clock cannot be trusted for anything cross-session.
  ts          TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One id per app load. What turns a pile of rows into a journey.
  session_id  VARCHAR(40) NOT NULL,
  kind        VARCHAR(24) NOT NULL,   -- nav | tap | save | error | lifecycle
  name        VARCHAR(60) NOT NULL,   -- the specific action
  route       TEXT,
  workout_id  INTEGER,
  -- Small, bounded, action-shaped: durations, counts, exercise ids. Never set values.
  detail      JSONB
);

CREATE INDEX IF NOT EXISTS idx_app_events_ts ON app_events(ts DESC);
CREATE INDEX IF NOT EXISTS idx_app_events_session ON app_events(session_id, ts);
CREATE INDEX IF NOT EXISTS idx_app_events_kind ON app_events(kind, ts DESC);

-- Standing guidance from coaching conversations, surfaced in the app where the decision
-- actually gets made. The pattern this fixes: advice agreed in chat ("hold the RDL at 60
-- despite the suggestion — one clean back session buys the 62.5") was gone by Saturday,
-- and the suggestion chip, being the thing in his hand mid-session, won by default.
--
-- Written and resolved from the coaching side (direct SQL or future tooling), read-only
-- to the app. A note scoped to an exercise renders under that exercise in the session;
-- one with no exercise_id is session-general. Notes live until resolved_at is set —
-- these are standing calls, not dailies, and they outlast the session that prompted them.
CREATE TABLE IF NOT EXISTS coach_notes (
  id          SERIAL PRIMARY KEY,
  exercise_id INTEGER REFERENCES exercises(id) ON DELETE CASCADE,
  -- Optional narrowing: only show with this routine (e.g. pull-up advice that applies
  -- on Day A's 6-8 range but not Day C's 6-10). NULL = wherever the exercise appears.
  routine_id  INTEGER REFERENCES routines(id) ON DELETE CASCADE,
  note        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_coach_notes_active ON coach_notes(exercise_id) WHERE resolved_at IS NULL;
