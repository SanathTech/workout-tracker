import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/src/db";
import { workouts, workoutExercises, sets } from "@/src/db/schema";
import { getExercises } from "@/src/db/queries/exercises";

export const runtime = "nodejs";

const WorkoutDraftSchema = z.object({
  workoutName: z.string().min(1).optional(),
  workoutNotes: z.string().optional(),
  exercises: z
    .array(
      z.object({
        exerciseId: z.string().min(1),
        performedAsName: z.string().min(1),
        exerciseNotes: z.string().optional(),
        sets: z.array(
          z.object({
            setNumber: z.number().int().min(1),
            load: z.number().nonnegative().optional(),
            reps: z.number().int().nonnegative().optional(),
            rir: z.number().int().min(0).max(10).optional(),
          })
        ),
      })
    )
    .optional(),
  workoutPlanId: z.string().uuid().optional(),
  week: z.number().int().min(1).optional(),
  day: z.number().int().min(1).optional(),
});

export async function POST(req: Request): Promise<NextResponse> {
  const body = await req.json();
  const parsed = WorkoutDraftSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  if (!parsed.data.exercises || parsed.data.exercises.length === 0) {
    const exerciseDetails = await getExercises(parsed.data.workoutName);
    const exercises = exerciseDetails.map((ex) => ({
      exerciseId: ex.id,
      performedAsName: ex.name,
      sets: ex.targetRirBySet.map((rir, index) => ({
        setNumber: index + 1,
        load: undefined,
        reps: undefined,
        rir: rir,
      })),
    }));
    parsed.data.exercises = exercises;
  }

  const {
    workoutName,
    workoutNotes,
    exercises: exs,
    workoutPlanId,
    week,
    day,
  } = parsed.data;

  // TODO: replace with real auth
  const userId = "demo-user";

  try {
    const result = await db.transaction(async (tx) => {
      // 1) Workout
      const [workout] = await tx
        .insert(workouts)
        .values({
          userId,
          workoutName: workoutName?.trim() || null,
          notes: workoutNotes?.trim() || null,
          workoutPlanId: workoutPlanId || null,
          week: week || null,
          day: day || null,
        })
        .returning({ id: workouts.id });

      // 2) Exercises + sets
      for (let order = 0; order < exs.length; order++) {
        const ex = exs[order];

        const hasSets = ex.sets.length > 0;
        const hasNotes = !!ex.exerciseNotes?.trim();
        if (!hasSets && !hasNotes) continue;

        const [we] = await tx
          .insert(workoutExercises)
          .values({
            workoutId: workout.id,
            exerciseId: ex.exerciseId,
            exerciseName: ex.performedAsName,
            notes: ex.exerciseNotes?.trim() || null,
            order,
          })
          .returning({ id: workoutExercises.id });

        if (hasSets) {
          await tx.insert(sets).values(
            ex.sets.map((s) => ({
              workoutExerciseId: we.id,
              setNumber: s.setNumber,
              load: s.load == null ? null : s.load.toString(), // numeric
              reps: s.reps ?? null,
              rir: s.rir ?? null,
            }))
          );
        }
      }

      console.log("Created workout", workout.id);

      return { workoutId: workout.id };
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
