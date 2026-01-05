import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/src/db";
import {
  exercises,
  exerciseSubstitutions,
  exerciseTargetRir,
} from "@/src/db/schema";
import { asc, eq } from "drizzle-orm";

export const runtime = "nodejs";

const CreateExerciseSchema = z.object({
  exerciseId: z.undefined().optional(),
  exerciseName: z.string(),
  substitutions: z.array(z.string().min(1)).optional(),
  warmupSets: z.object({
    min: z.number().int().min(0),
    max: z.number().int().min(0),
  }),
  repRange: z.object({
    min: z.number().int().min(0),
    max: z.number().int().min(0),
  }),
  restSeconds: z.object({
    min: z.number().int().min(0),
    max: z.number().int().min(0),
  }),
  targetRirBySet: z.array(z.number().int().min(0).max(10)).optional(),
});

const UpdateExerciseSchema = z.object({
  exerciseId: z.uuid(),
  exerciseName: z.string(),
  substitutions: z.array(z.string().min(1)).optional(),
  warmupSets: z.object({
    min: z.number().int().min(0),
    max: z.number().int().min(0),
  }),
  repRange: z.object({
    min: z.number().int().min(0),
    max: z.number().int().min(0),
  }),
  restSeconds: z.object({
    min: z.number().int().min(0),
    max: z.number().int().min(0),
  }),
  targetRirBySet: z.array(z.number().int().min(0).max(10)).optional(),
});

export const ExercisesSchema = z.union([
  CreateExerciseSchema,
  UpdateExerciseSchema,
]);

export async function GET(): Promise<NextResponse> {
  try {
    const rows = await db.select().from(exercises);
    const subs = await db
      .select()
      .from(exerciseSubstitutions)
      .orderBy(asc(exerciseSubstitutions.order));

    const rirs = await db
      .select()
      .from(exerciseTargetRir)
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

    const exercisesArray = rows.map((r) => ({
      id: r.id,
      name: r.name,
      substitutions: subsByExercise.get(r.id) ?? [],
      warmupSets: { min: r.warmupSetsMin, max: r.warmupSetsMax },
      repRange: { min: r.repRangeMin, max: r.repRangeMax },
      restSeconds: { min: r.restSecondsMin, max: r.restSecondsMax },
      targetRirBySet: rirsByExercise.get(r.id) ?? [],
    }));

    return NextResponse.json(
      {
        exercises: exercisesArray,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch workout exerciseslist" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const body = await req.json();
  const parsed = ExercisesSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: z.treeifyError(parsed.error) },
      { status: 400 }
    );
  }

  const {
    exerciseId,
    exerciseName,
    substitutions,
    warmupSets,
    repRange,
    restSeconds,
    targetRirBySet,
  } = parsed.data;

  try {
    const result = await db.transaction(async (tx) => {
      let exercise: { id: string };

      if (exerciseId) {
        const updated = await tx
          .update(exercises)
          .set({
            name: exerciseName,
            warmupSetsMin: warmupSets.min,
            warmupSetsMax: warmupSets.max,
            repRangeMin: repRange.min,
            repRangeMax: repRange.max,
            restSecondsMin: restSeconds.min,
            restSecondsMax: restSeconds.max,
          })
          .where(eq(exercises.id, exerciseId))
          .returning({ id: exercises.id });

        if (updated.length === 0) {
          throw new Error(`Exercise not found: ${exerciseId}`);
        }

        exercise = updated[0];
      } else {
        // Insert new
        const inserted = await tx
          .insert(exercises)
          .values({
            name: exerciseName,
            warmupSetsMin: warmupSets.min,
            warmupSetsMax: warmupSets.max,
            repRangeMin: repRange.min,
            repRangeMax: repRange.max,
            restSecondsMin: restSeconds.min,
            restSecondsMax: restSeconds.max,
          })
          .returning({ id: exercises.id });

        exercise = inserted[0];
      }

      await tx
        .delete(exerciseSubstitutions)
        .where(eq(exerciseSubstitutions.exerciseId, exercise.id));

      if (substitutions?.length) {
        await tx.insert(exerciseSubstitutions).values(
          substitutions.map((name, i) => ({
            exerciseId: exercise.id,
            name,
            order: i,
          }))
        );
      }

      await tx
        .delete(exerciseTargetRir)
        .where(eq(exerciseTargetRir.exerciseId, exercise.id));

      if (targetRirBySet?.length) {
        await tx.insert(exerciseTargetRir).values(
          targetRirBySet.map((rir, i) => ({
            exerciseId: exercise.id,
            setNumber: i + 1,
            rir,
          }))
        );
      }

      return { exerciseId: exercise.id };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to save workout" },
      { status: 500 }
    );
  }
}
