import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/src/db";
import { workoutPlans } from "@/src/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

export async function GET({
  params,
}: {
  params: { id: string };
}): Promise<NextResponse> {
  try {
    const plan = await db
      .select()
      .from(workoutPlans)
      .where(eq(workoutPlans.id, params.id))
      .limit(1);

    return NextResponse.json({ plan }, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch workout plan: " + params.id },
      { status: 500 }
    );
  }
}
