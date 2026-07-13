-- One-time update: flag the main lifts on the EXISTING "Strength + Endurance"
-- program. Run AFTER migrate.sql (which adds the is_main column). Matches rows
-- by routine + exercise name, so it only touches this program. Idempotent.
BEGIN;
UPDATE routine_exercises re SET is_main = true
FROM routines r, exercises e
WHERE re.routine_id = r.id AND re.exercise_id = e.id
  AND r.program_id = (SELECT id FROM programs WHERE name = $tag$Strength + Endurance — 3-day full-body strength block$tag$)
  AND (
    (r.name = $tag$Day C — Overhead / Upper$tag$ AND e.name = $tag$Barbell Overhead Press$tag$)
    OR (r.name = $tag$Day A — Squat / Push$tag$ AND e.name = $tag$Barbell Back Squat$tag$)
    OR (r.name = $tag$Day B — Hinge / Row$tag$ AND e.name = $tag$Barbell RDL$tag$)
  );
COMMIT;
