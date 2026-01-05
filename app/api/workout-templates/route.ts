import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/src/db";
import { workoutTemplates } from "@/src/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

const WorkoutTemplatesSchema = z.object({
  workoutName: z.string().min(1),
  exerciseIds: z.array(z.string().min(1)).optional(),
});

export async function GET(): Promise<NextResponse> {
  try {
    const templates = await db.select().from(workoutTemplates);

    return NextResponse.json({ templates }, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch workout templates" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const body = await req.json();
  const parsed = WorkoutTemplatesSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { workoutName, exerciseIds } = parsed.data;

  // TODO: replace with real auth
  const userId = "demo-user";

  try {
    const result = await db.transaction(async (tx) => {
      const templates = await db.select().from(workoutTemplates);
      let workout_templates;

      if (templates.find((t) => t.templateName === workoutName)) {
        [workout_templates] = await tx
          .update(workoutTemplates)
          .set({ templateName: workoutName, exerciseIds })
          .where(
            eq(
              workoutTemplates.id,
              templates.find((t) => t.templateName === workoutName)!.id
            )
          )
          .returning({ id: workoutTemplates.id });

        console.log("Updated workout template", workout_templates.id);
      } else {
        [workout_templates] = await tx
          .insert(workoutTemplates)
          .values({
            id: `template-${templates.length + 1}`,
            templateName: workoutName,
            userId,
            exerciseIds: exerciseIds || [],
          })
          .returning({ id: workoutTemplates.id });

        console.log("Created workout template", workout_templates.id);
      }

      return { workoutTemplateId: workout_templates.id };
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
