-- One-time update: apply warm-up sets + refreshed notes to the EXISTING
-- "Strength + Endurance" program. Run AFTER migrate.sql (which adds the
-- warmup_sets_low/high columns). Matches rows by routine + exercise name,
-- so it only touches this program. Idempotent — safe to run more than once.
BEGIN;
UPDATE routine_exercises re SET
  notes = $tag$Main vertical press. Brace, press in a straight line past the forehead.$tag$,
  warmup_sets_low = 2, warmup_sets_high = 3
FROM routines r, exercises e
WHERE re.routine_id = r.id AND re.exercise_id = e.id
  AND r.program_id = (SELECT id FROM programs WHERE name = $tag$Strength + Endurance — 3-day full-body strength block$tag$)
  AND r.name = $tag$Day C — Overhead / Upper$tag$ AND e.name = $tag$Barbell Overhead Press$tag$;

UPDATE routine_exercises re SET
  notes = $tag$First vertical pull of the week. Add load once bodyweight is easy; full ROM, control the negative.$tag$,
  warmup_sets_low = 1, warmup_sets_high = 2
FROM routines r, exercises e
WHERE re.routine_id = r.id AND re.exercise_id = e.id
  AND r.program_id = (SELECT id FROM programs WHERE name = $tag$Strength + Endurance — 3-day full-body strength block$tag$)
  AND r.name = $tag$Day C — Overhead / Upper$tag$ AND e.name = $tag$Weighted Pull-Up$tag$;

UPDATE routine_exercises re SET
  notes = $tag$First horizontal press of the week. Flat or incline; chase reps in the range before adding load.$tag$,
  warmup_sets_low = 1, warmup_sets_high = 2
FROM routines r, exercises e
WHERE re.routine_id = r.id AND re.exercise_id = e.id
  AND r.program_id = (SELECT id FROM programs WHERE name = $tag$Strength + Endurance — 3-day full-body strength block$tag$)
  AND r.name = $tag$Day C — Overhead / Upper$tag$ AND e.name = $tag$Flat DB Press$tag$;

UPDATE routine_exercises re SET
  notes = $tag$Hamstring health for runners; balances the RDL. Big stretch at the bottom.$tag$,
  warmup_sets_low = 1, warmup_sets_high = 1
FROM routines r, exercises e
WHERE re.routine_id = r.id AND re.exercise_id = e.id
  AND r.program_id = (SELECT id FROM programs WHERE name = $tag$Strength + Endurance — 3-day full-body strength block$tag$)
  AND r.name = $tag$Day C — Overhead / Upper$tag$ AND e.name = $tag$Lying Leg Curl$tag$;

UPDATE routine_exercises re SET
  notes = $tag$Keep some direct arm work. Target 0–1 RIR.$tag$,
  warmup_sets_low = NULL, warmup_sets_high = NULL
FROM routines r, exercises e
WHERE re.routine_id = r.id AND re.exercise_id = e.id
  AND r.program_id = (SELECT id FROM programs WHERE name = $tag$Strength + Endurance — 3-day full-body strength block$tag$)
  AND r.name = $tag$Day C — Overhead / Upper$tag$ AND e.name = $tag$EZ-Bar Curl$tag$;

UPDATE routine_exercises re SET
  notes = $tag$Rope or bar, whichever feels better. Target 0–1 RIR.$tag$,
  warmup_sets_low = NULL, warmup_sets_high = NULL
FROM routines r, exercises e
WHERE re.routine_id = r.id AND re.exercise_id = e.id
  AND r.program_id = (SELECT id FROM programs WHERE name = $tag$Strength + Endurance — 3-day full-body strength block$tag$)
  AND r.name = $tag$Day C — Overhead / Upper$tag$ AND e.name = $tag$Triceps Pressdown$tag$;

UPDATE routine_exercises re SET
  notes = $tag$Main lower-body strength lift. Brace hard, controlled descent, full depth.$tag$,
  warmup_sets_low = 2, warmup_sets_high = 3
FROM routines r, exercises e
WHERE re.routine_id = r.id AND re.exercise_id = e.id
  AND r.program_id = (SELECT id FROM programs WHERE name = $tag$Strength + Endurance — 3-day full-body strength block$tag$)
  AND r.name = $tag$Day A — Squat / Push$tag$ AND e.name = $tag$Barbell Back Squat$tag$;

UPDATE routine_exercises re SET
  notes = $tag$Lean forward = chest bias, upright = triceps. Add load at top of range.$tag$,
  warmup_sets_low = 1, warmup_sets_high = 2
FROM routines r, exercises e
WHERE re.routine_id = r.id AND re.exercise_id = e.id
  AND r.program_id = (SELECT id FROM programs WHERE name = $tag$Strength + Endurance — 3-day full-body strength block$tag$)
  AND r.name = $tag$Day A — Squat / Push$tag$ AND e.name = $tag$Weighted Dips$tag$;

UPDATE routine_exercises re SET
  notes = $tag$Second vertical pull of the week. Add load once bodyweight is easy; full ROM.$tag$,
  warmup_sets_low = 1, warmup_sets_high = 2
FROM routines r, exercises e
WHERE re.routine_id = r.id AND re.exercise_id = e.id
  AND r.program_id = (SELECT id FROM programs WHERE name = $tag$Strength + Endurance — 3-day full-body strength block$tag$)
  AND r.name = $tag$Day A — Squat / Push$tag$ AND e.name = $tag$Weighted Pull-Up$tag$;

UPDATE routine_exercises re SET
  notes = $tag$Secondary press (OHP is the Day C main).$tag$,
  warmup_sets_low = 1, warmup_sets_high = 2
FROM routines r, exercises e
WHERE re.routine_id = r.id AND re.exercise_id = e.id
  AND r.program_id = (SELECT id FROM programs WHERE name = $tag$Strength + Endurance — 3-day full-body strength block$tag$)
  AND r.name = $tag$Day A — Squat / Push$tag$ AND e.name = $tag$Seated DB Shoulder Press$tag$;

UPDATE routine_exercises re SET
  notes = $tag$1–2 s pause at the bottom, full stretch. Target 0–1 RIR.$tag$,
  warmup_sets_low = 1, warmup_sets_high = 1
FROM routines r, exercises e
WHERE re.routine_id = r.id AND re.exercise_id = e.id
  AND r.program_id = (SELECT id FROM programs WHERE name = $tag$Strength + Endurance — 3-day full-body strength block$tag$)
  AND r.name = $tag$Day A — Squat / Push$tag$ AND e.name = $tag$Standing Calf Raise$tag$;

UPDATE routine_exercises re SET
  notes = $tag$Optional core. Control down, no swinging.$tag$,
  warmup_sets_low = NULL, warmup_sets_high = NULL
FROM routines r, exercises e
WHERE re.routine_id = r.id AND re.exercise_id = e.id
  AND r.program_id = (SELECT id FROM programs WHERE name = $tag$Strength + Endurance — 3-day full-body strength block$tag$)
  AND r.name = $tag$Day A — Squat / Push$tag$ AND e.name = $tag$Hanging Leg Raise$tag$;

UPDATE routine_exercises re SET
  notes = $tag$Main hinge. Hips back, bar over mid-foot, neutral spine, deep stretch.$tag$,
  warmup_sets_low = 2, warmup_sets_high = 3
FROM routines r, exercises e
WHERE re.routine_id = r.id AND re.exercise_id = e.id
  AND r.program_id = (SELECT id FROM programs WHERE name = $tag$Strength + Endurance — 3-day full-body strength block$tag$)
  AND r.name = $tag$Day B — Hinge / Row$tag$ AND e.name = $tag$Barbell RDL$tag$;

UPDATE routine_exercises re SET
  notes = $tag$30–45° bench. 1 s pause at the bottom.$tag$,
  warmup_sets_low = 1, warmup_sets_high = 2
FROM routines r, exercises e
WHERE re.routine_id = r.id AND re.exercise_id = e.id
  AND r.program_id = (SELECT id FROM programs WHERE name = $tag$Strength + Endurance — 3-day full-body strength block$tag$)
  AND r.name = $tag$Day B — Hinge / Row$tag$ AND e.name = $tag$Incline DB Press$tag$;

UPDATE routine_exercises re SET
  notes = $tag$Squeeze shoulder blades, elbows ~45°. Balances the pressing.$tag$,
  warmup_sets_low = 1, warmup_sets_high = 2
FROM routines r, exercises e
WHERE re.routine_id = r.id AND re.exercise_id = e.id
  AND r.program_id = (SELECT id FROM programs WHERE name = $tag$Strength + Endurance — 3-day full-body strength block$tag$)
  AND r.name = $tag$Day B — Hinge / Row$tag$ AND e.name = $tag$Chest-Supported Row$tag$;

UPDATE routine_exercises re SET
  notes = $tag$8–12 per leg. Single-leg strength & stability — carries over to running.$tag$,
  warmup_sets_low = 1, warmup_sets_high = 2
FROM routines r, exercises e
WHERE re.routine_id = r.id AND re.exercise_id = e.id
  AND r.program_id = (SELECT id FROM programs WHERE name = $tag$Strength + Endurance — 3-day full-body strength block$tag$)
  AND r.name = $tag$Day B — Hinge / Row$tag$ AND e.name = $tag$Bulgarian Split Squat$tag$;

UPDATE routine_exercises re SET
  notes = $tag$Lead with the elbow; smooth, controlled reps.$tag$,
  warmup_sets_low = NULL, warmup_sets_high = NULL
FROM routines r, exercises e
WHERE re.routine_id = r.id AND re.exercise_id = e.id
  AND r.program_id = (SELECT id FROM programs WHERE name = $tag$Strength + Endurance — 3-day full-body strength block$tag$)
  AND r.name = $tag$Day B — Hinge / Row$tag$ AND e.name = $tag$Lateral Raise$tag$;

UPDATE routine_exercises re SET
  notes = $tag$Optional. Shoulder health — worth keeping given swim volume.$tag$,
  warmup_sets_low = NULL, warmup_sets_high = NULL
FROM routines r, exercises e
WHERE re.routine_id = r.id AND re.exercise_id = e.id
  AND r.program_id = (SELECT id FROM programs WHERE name = $tag$Strength + Endurance — 3-day full-body strength block$tag$)
  AND r.name = $tag$Day B — Hinge / Row$tag$ AND e.name = $tag$Face Pull$tag$;

COMMIT;
