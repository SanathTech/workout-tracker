import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/src/db";
import { workoutPlans } from "@/src/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

const CreateWorkoutPlansSchema = z.object({
  workoutPlanId: z.undefined().optional(),
  workoutPlanName: z.string(),
  weeks: z.number().int().min(1),
  daysPerWeek: z.number().int().min(1),
  workouts: z
    .array(
      z.object({
        workoutName: z.string().min(1),
        exerciseIds: z.array(z.string().min(1)).optional(),
      })
    )
    .optional(),
});

const UpdateWorkoutPlansSchema = z.object({
  workoutPlanId: z.uuid(),
  workoutPlanName: z.string(),
  weeks: z.number().int().min(1),
  daysPerWeek: z.number().int().min(1),
  workouts: z.array(
    z.object({
      workoutName: z.string().min(1),
      exerciseIds: z.array(z.string().min(1)).optional(),
    })
  ),
});

export const WorkoutPlansSchema = z.union([
  CreateWorkoutPlansSchema,
  UpdateWorkoutPlansSchema,
]);

export async function GET(): Promise<NextResponse> {
  try {
    const plans = await db.select().from(workoutPlans);

    return NextResponse.json({ plans }, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch workout plans" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const body = await req.json();
  const parsed = WorkoutPlansSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: z.treeifyError(parsed.error) },
      { status: 400 }
    );
  }

  const { workoutPlanId, workoutPlanName, weeks, daysPerWeek, workouts } =
    parsed.data;

  // TODO: replace with real auth
  const userId = "demo-user";

  try {
    const result = await db.transaction(async (tx) => {
      let workout_plan: { id: string };

      if (workoutPlanId) {
        const updated = await tx
          .update(workoutPlans)
          .set({
            name: workoutPlanName,
            weeks,
            daysPerWeek,
            workouts: workouts.map((w) => w.workoutName),
          })
          .where(eq(workoutPlans.id, workoutPlanId))
          .returning({ id: workoutPlans.id });

        if (updated.length === 0) {
          throw new Error(`Workout plan not found: ${workoutPlanId}`);
        }

        workout_plan = updated[0];
      } else {
        const inserted = await tx
          .insert(workoutPlans)
          .values({
            name: workoutPlanName,
            userId,
            weeks,
            daysPerWeek,
            workouts: [],
          })
          .returning({ id: workoutPlans.id });

        workout_plan = inserted[0];
      }

      return { workoutPlanId: workout_plan.id };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to save workout plan" },
      { status: 500 }
    );
  }
}
