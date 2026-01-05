import path from "path";
import dotenv from "dotenv";
import { WebSocket } from "ws";
import { neonConfig } from "@neondatabase/serverless";
import type { Config } from "drizzle-kit";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

neonConfig.webSocketConstructor = WebSocket;

const url =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL;

if (!url) throw new Error("Missing DB url in .env.local");

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
} satisfies Config;
