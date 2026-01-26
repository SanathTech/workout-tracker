import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/src/db";
import { workoutPlans } from "@/src/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  {
    params,
  }: {
    params: Promise<{ id: string }>;
  }
): Promise<NextResponse> {
  const { id } = await params;

  try {
    const plan = await db
      .select()
      .from(workoutPlans)
      .where(eq(workoutPlans.id, id))
      .limit(1);

    return NextResponse.json({ plan: plan[0] ?? null }, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch workout plan: " + id },
      { status: 500 }
    );
  }
}
