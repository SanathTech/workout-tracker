ALTER TABLE "workouts" ADD COLUMN "workout_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "week" integer;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "day" integer;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_workout_plan_id_workout_plans_id_fk" FOREIGN KEY ("workout_plan_id") REFERENCES "public"."workout_plans"("id") ON DELETE no action ON UPDATE no action;