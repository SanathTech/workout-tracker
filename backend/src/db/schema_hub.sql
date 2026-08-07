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
  raw                  JSONB NOT NULL,
  synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
