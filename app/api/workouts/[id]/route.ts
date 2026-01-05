import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/src/db";
import { workouts, workoutExercises, sets } from "@/src/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

const WorkoutDraftSchema = z.object({
  workoutName: z.string().min(1),
  workoutNotes: z.string().optional(),
  exercises: z.array(
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
  ),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: workoutId } = await params;

  const body = await req.json();
  const parsed = WorkoutDraftSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { workoutName, workoutNotes, exercises: exs } = parsed.data;

  // TODO: real auth later
  const userId = "demo-user";

  try {
    await db.transaction(async (tx) => {
      // 1) Update workout notes
      await tx
        .update(workouts)
        .set({ workoutName, notes: workoutNotes?.trim() || null })
        .where(eq(workouts.id, workoutId));

      // 2) Delete existing exercises + sets
      await tx
        .delete(workoutExercises)
        .where(eq(workoutExercises.workoutId, workoutId));

      // 3) Reinsert exercises + sets
      for (let order = 0; order < exs.length; order++) {
        const ex = exs[order];

        const hasSets = ex.sets.length > 0;
        const hasNotes = !!ex.exerciseNotes?.trim();
        if (!hasSets && !hasNotes) continue;

        const [we] = await tx
          .insert(workoutExercises)
          .values({
            workoutId,
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
              load: s.load == null ? null : s.load.toString(),
              reps: s.reps ?? null,
              rir: s.rir ?? null,
            }))
          );
        }
      }
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to update workout" },
      { status: 500 }
    );
  }
}
