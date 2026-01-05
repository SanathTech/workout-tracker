// src/db/queries/workouts.ts
import { db } from "@/src/db";
import { workouts, workoutExercises, sets } from "@/src/db/schema";
import { eq, asc, inArray } from "drizzle-orm";

export async function getWorkoutForEdit(workoutId: string) {
  const [workout] = await db
    .select()
    .from(workouts)
    .where(eq(workouts.id, workoutId));

  if (!workout) return null;

  const exercises = await db
    .select()
    .from(workoutExercises)
    .where(eq(workoutExercises.workoutId, workoutId))
    .orderBy(asc(workoutExercises.order));

  const exerciseIds = exercises.map((e) => e.id);

  const allSets = await db
    .select()
    .from(sets)
    .where(inArray(sets.workoutExerciseId, exerciseIds))
    .orderBy(asc(sets.setNumber));

  const setsByExercise = new Map<string, typeof allSets>();

  for (const s of allSets) {
    const arr = setsByExercise.get(s.workoutExerciseId) ?? [];
    arr.push(s);
    setsByExercise.set(s.workoutExerciseId, arr);
  }

  return {
    id: workout.id,
    workoutName: workout.workoutName ?? "Unnamed Workout",
    workoutNotes: workout.notes ?? "",
    exercises: exercises.map((ex) => ({
      exerciseId: ex.exerciseId,
      performedAsName: ex.exerciseName,
      notes: ex.notes ?? "",
      sets:
        setsByExercise.get(ex.id)?.map((s) => ({
          load: s.load?.toString() ?? "",
          reps: s.reps?.toString() ?? "",
          rir: s.rir?.toString() ?? "",
        })) ?? [],
    })),
  };
}

export async function getAllWorkoutsSummary() {
  const rows = await db
    .select()
    .from(workouts)
    .orderBy(asc(workouts.startedAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.workoutName ?? "Unnamed Workout",
    startedAt: r.startedAt,
  }));
}
