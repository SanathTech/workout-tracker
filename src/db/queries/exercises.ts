import { eq, asc, inArray } from "drizzle-orm";
import {
  exercises,
  exerciseSubstitutions,
  exerciseTargetRir,
  workoutTemplates,
} from "../schema";
import { db } from "..";

export type Range = { min: number; max: number };

export interface ExerciseDetails {
  id: string;
  name: string;
  substitutions: string[];
  warmupSets: Range;
  repRange: Range;
  restSeconds: Range;
  targetRirBySet: number[];
}

export async function getExercises(name?: string): Promise<ExerciseDetails[]> {
  let rows;
  if (name) {
    const template = await db
      .select()
      .from(workoutTemplates)
      .where(eq(workoutTemplates.templateName, name))
      .limit(1);
    if (template.length === 0) return [];
    rows = await db
      .select()
      .from(exercises)
      .where(inArray(exercises.id, template[0].exerciseIds));
  } else {
    rows = await db.select().from(exercises);
  }

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);

  const subs = await db
    .select()
    .from(exerciseSubstitutions)
    .where(inArray(exerciseSubstitutions.exerciseId, ids))
    .orderBy(asc(exerciseSubstitutions.order));

  const rirs = await db
    .select()
    .from(exerciseTargetRir)
    .where(inArray(exerciseTargetRir.exerciseId, ids))
    .orderBy(asc(exerciseTargetRir.setNumber));

  const subsByExercise = new Map<string, string[]>();
  for (const s of subs) {
    const arr = subsByExercise.get(s.exerciseId) ?? [];
    arr.push(s.name);
    subsByExercise.set(s.exerciseId, arr);
  }

  const rirsByExercise = new Map<string, number[]>();
  for (const r of rirs) {
    const arr = rirsByExercise.get(r.exerciseId) ?? [];
    arr.push(r.rir);
    rirsByExercise.set(r.exerciseId, arr);
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    substitutions: subsByExercise.get(r.id) ?? [],
    warmupSets: { min: r.warmupSetsMin, max: r.warmupSetsMax },
    repRange: { min: r.repRangeMin, max: r.repRangeMax },
    restSeconds: { min: r.restSecondsMin, max: r.restSecondsMax },
    targetRirBySet: rirsByExercise.get(r.id) ?? [],
  }));
}
