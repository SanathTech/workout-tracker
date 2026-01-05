import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { WebSocket } from "ws";
import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq } from "drizzle-orm";

import {
  exercises,
  exerciseSubstitutions,
  exerciseTargetRir,
} from "../src/db/schema";

neonConfig.webSocketConstructor = WebSocket;

const pool = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED! });
const db = drizzle(pool);

const seed = [
  {
    id: "exercise-1",
    name: "Barbell Incline Press",
    substitutions: ["DB Incline Press", "Smith Machine Incline Press"],
    warmupSets: { min: 3, max: 5 },
    repRange: { min: 6, max: 8 },
    restSeconds: { min: 180, max: 300 },
    targetRirBySet: [1, 0],
  },
  {
    id: "exercise-2",
    name: "Pec Deck",
    substitutions: ["DB Flye", "Cable Flye"],
    warmupSets: { min: 1, max: 2 },
    repRange: { min: 6, max: 8 },
    restSeconds: { min: 60, max: 120 },
    targetRirBySet: [0, 0],
  },
  {
    id: "exercise-3",
    name: "Incline DB Y-Raise",
    substitutions: ["Cable Y-Raise", "Machine Lateral Raise"],
    warmupSets: { min: 0, max: 1 },
    repRange: { min: 8, max: 10 },
    restSeconds: { min: 60, max: 120 },
    targetRirBySet: [0, 0],
  },
  {
    id: "exercise-4",
    name: "Pull-Up (Wide Grip)",
    substitutions: ["Lat Pulldown (Wide Grip)", "1-Arm Cable Pulldown"],
    warmupSets: { min: 1, max: 2 },
    repRange: { min: 6, max: 8 },
    restSeconds: { min: 120, max: 180 },
    targetRirBySet: [1, 0],
  },
  {
    id: "exercise-5",
    name: "Kelso Shrug",
    substitutions: ["Seated Cable Kelso Shrug", "Incline DB Kelso Shrug"],
    warmupSets: { min: 1, max: 2 },
    repRange: { min: 6, max: 8 },
    restSeconds: { min: 120, max: 180 },
    targetRirBySet: [1, 0],
  },
  {
    id: "exercise-6",
    name: "EZ-Bar Preacher Curl",
    substitutions: ["Machine Preacher Curl", "DB Preacher Curl"],
    warmupSets: { min: 0, max: 1 },
    repRange: { min: 6, max: 8 },
    restSeconds: { min: 60, max: 120 },
    targetRirBySet: [0, 0],
  },
  {
    id: "exercise-7",
    name: "Triceps Pressdown",
    substitutions: ["Close-Grip Bench Press", "Smith Machine JM Press"],
    warmupSets: { min: 0, max: 1 },
    repRange: { min: 6, max: 8 },
    restSeconds: { min: 60, max: 120 },
    targetRirBySet: [0, 0],
  },
  {
    id: "exercise-8",
    name: "Dragon Flag",
    substitutions: ["Bent-Knee Dragon Flag", "Lying Leg Raise"],
    warmupSets: { min: 0, max: 1 },
    repRange: { min: 6, max: 8 },
    restSeconds: { min: 60, max: 120 },
    targetRirBySet: [0, 0],
  },
  {
    id: "exercise-9",
    name: "Lying Leg Curl",
    substitutions: ["Seated Leg Curl", "Nordic Ham Curl"],
    warmupSets: { min: 1, max: 2 },
    repRange: { min: 6, max: 8 },
    restSeconds: { min: 60, max: 120 },
    targetRirBySet: [0, 0],
  },
  {
    id: "exercise-10",
    name: "Squat (Your Choice)",
    substitutions: [],
    warmupSets: { min: 2, max: 4 },
    repRange: { min: 6, max: 8 },
    restSeconds: { min: 180, max: 300 },
    targetRirBySet: [1, 0],
  },
  {
    id: "exercise-11",
    name: "Smith Machine Lunge",
    substitutions: ["DB Lunge", "Barbell Lunge"],
    warmupSets: { min: 2, max: 4 },
    repRange: { min: 6, max: 8 },
    restSeconds: { min: 120, max: 240 },
    targetRirBySet: [0],
  },
  {
    id: "exercise-12",
    name: "Leg Extension",
    substitutions: ["Reverse Nordic", "Sissy Squat"],
    warmupSets: { min: 1, max: 2 },
    repRange: { min: 6, max: 8 },
    restSeconds: { min: 60, max: 120 },
    targetRirBySet: [0, 0],
  },
  {
    id: "exercise-13",
    name: "Machine Hip Abduction",
    substitutions: ["Cable Hip Abduction", "Standing Plate Abduction"],
    warmupSets: { min: 0, max: 1 },
    repRange: { min: 6, max: 8 },
    restSeconds: { min: 60, max: 120 },
    targetRirBySet: [0],
  },
  {
    id: "exercise-14",
    name: "Standing Calf Raise",
    substitutions: ["Leg Press Calf Press", "Donkey Calf Raise"],
    warmupSets: { min: 0, max: 1 },
    repRange: { min: 6, max: 8 },
    restSeconds: { min: 60, max: 120 },
    targetRirBySet: [0, 0],
  },
] as const;

async function main() {
  for (const ex of seed) {
    // Upsert-ish: delete existing related rows then re-insert
    await db
      .delete(exerciseSubstitutions)
      .where(eq(exerciseSubstitutions.exerciseId, ex.id));
    await db
      .delete(exerciseTargetRir)
      .where(eq(exerciseTargetRir.exerciseId, ex.id));
    await db.delete(exercises).where(eq(exercises.id, ex.id));

    await db.insert(exercises).values({
      id: ex.id,
      name: ex.name,
      warmupSetsMin: ex.warmupSets.min,
      warmupSetsMax: ex.warmupSets.max,
      repRangeMin: ex.repRange.min,
      repRangeMax: ex.repRange.max,
      restSecondsMin: ex.restSeconds.min,
      restSecondsMax: ex.restSeconds.max,
    });

    if (ex.substitutions.length > 0) {
      await db.insert(exerciseSubstitutions).values(
        ex.substitutions.map((name, i) => ({
          exerciseId: ex.id,
          name,
          order: i,
        }))
      );
    }

    await db.insert(exerciseTargetRir).values(
      ex.targetRirBySet.map((rir, i) => ({
        exerciseId: ex.id,
        setNumber: i + 1,
        rir,
      }))
    );
  }

  console.log("✅ Seeded exercises");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
