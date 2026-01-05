import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { WebSocket } from "ws";
import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq } from "drizzle-orm";
import { workoutTemplates } from "@/src/db/schema";

neonConfig.webSocketConstructor = WebSocket;

const pool = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED! });
const db = drizzle(pool);

const seed = [
  {
    id: "template-1",
    name: "Upper 1",
    exerciseIds: [
      "exercise-1",
      "exercise-2",
      "exercise-3",
      "exercise-4",
      "exercise-5",
      "exercise-6",
      "exercise-7",
      "exercise-8",
    ],
  },
  {
    id: "template-2",
    name: "Lower 1",
    exerciseIds: [
      "exercise-9",
      "exercise-10",
      "exercise-11",
      "exercise-12",
      "exercise-13",
      "exercise-14",
    ],
  },
];

async function main() {
  for (const temp of seed) {
    // Upsert-ish: delete existing related rows then re-insert
    await db.delete(workoutTemplates).where(eq(workoutTemplates.id, temp.id));

    await db.insert(workoutTemplates).values({
      id: temp.id,
      userId: "demo-user",
      createdAt: new Date(),
      templateName: temp.name,
      exerciseIds: temp.exerciseIds,
    });
  }

  console.log("✅ Seeded templates");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
