import {
  pgTable,
  text,
  integer,
  timestamp,
  uuid,
  numeric,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const workoutPlans = pgTable(
  "workout_plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    name: text("name").notNull(),
    weeks: integer("weeks").notNull(),
    daysPerWeek: integer("days_per_week").notNull(),
    workouts: text("workouts").array().notNull(),
  },
  (t) => ({
    userCreatedAtIdx: index("workout_plans_user_created_at_idx").on(
      t.userId,
      t.createdAt
    ),
  })
);

export const workoutTemplates = pgTable(
  "workout_templates",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    templateName: text("template_name").notNull(),
    exerciseIds: text("exercise_ids").array().notNull(),
  },
  (t) => ({
    userCreatedAtIdx: index("workout_templates_user_created_at_idx").on(
      t.userId,
      t.createdAt
    ),
  })
);

export const workouts = pgTable(
  "workouts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    workoutName: text("workout_name"),
    notes: text("notes"),
    workoutPlanId: uuid("workout_plan_id").references(() => workoutPlans.id),
    week: integer("week"),
    day: integer("day"),
  },
  (t) => ({
    userStartedAtIdx: index("workouts_user_started_at_idx").on(
      t.userId,
      t.startedAt
    ),
  })
);

export const workoutExercises = pgTable(
  "workout_exercises",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workoutId: uuid("workout_id")
      .notNull()
      .references(() => workouts.id, { onDelete: "cascade" }),

    // your library id like "exercise-1"
    exerciseId: uuid("exercise_id").notNull(),

    // denormalise name so history doesn’t break if you rename later
    exerciseName: text("exercise_name").notNull(),

    notes: text("notes"),

    order: integer("order").notNull().default(0),
  },
  (t) => ({
    workoutIdx: index("workout_exercises_workout_idx").on(t.workoutId),
    exerciseIdx: index("workout_exercises_exercise_idx").on(t.exerciseId),
    workoutOrderIdx: index("workout_exercises_workout_order_idx").on(
      t.workoutId,
      t.order
    ),
  })
);

export const sets = pgTable(
  "sets",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    workoutExerciseId: uuid("workout_exercise_id")
      .notNull()
      .references(() => workoutExercises.id, { onDelete: "cascade" }),

    setNumber: integer("set_number").notNull(),

    // numeric allows 0.5kg etc (e.g. 102.5)
    load: numeric("load", { precision: 6, scale: 2 }),
    reps: integer("reps"),
    rir: integer("rir"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    weIdx: index("sets_workout_exercise_idx").on(t.workoutExerciseId),
    setNumberIdx: uniqueIndex("sets_unique_set_number").on(
      t.workoutExerciseId,
      t.setNumber
    ),
  })
);

// Core exercise definition
export const exercises = pgTable("exercises", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),

  warmupSetsMin: integer("warmup_sets_min").notNull(),
  warmupSetsMax: integer("warmup_sets_max").notNull(),

  repRangeMin: integer("rep_range_min").notNull(),
  repRangeMax: integer("rep_range_max").notNull(),

  restSecondsMin: integer("rest_seconds_min").notNull(),
  restSecondsMax: integer("rest_seconds_max").notNull(),
});

// Substitutions (1-to-many)
export const exerciseSubstitutions = pgTable("exercise_substitutions", {
  id: uuid("id").defaultRandom().primaryKey(),
  exerciseId: uuid("exercise_id")
    .notNull()
    .references(() => exercises.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  order: integer("order").notNull().default(0),
});

// Target RIR per set (1-to-many)
export const exerciseTargetRir = pgTable("exercise_target_rir", {
  id: uuid("id").defaultRandom().primaryKey(),
  exerciseId: uuid("exercise_id")
    .notNull()
    .references(() => exercises.id, { onDelete: "cascade" }),
  setNumber: integer("set_number").notNull(), // 1,2,3...
  rir: integer("rir").notNull(),
});
