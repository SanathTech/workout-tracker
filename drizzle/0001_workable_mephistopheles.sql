CREATE TABLE "workout_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"weeks" integer NOT NULL,
	"days_per_week" integer NOT NULL,
	"workouts" text[] NOT NULL
);
--> statement-breakpoint
CREATE INDEX "workout_plans_user_created_at_idx" ON "workout_plans" USING btree ("user_id","created_at");