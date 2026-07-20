-- Strength + Endurance program seed (idempotent).
-- Paste the whole file into the Neon SQL Editor and click Run.
-- Migrates the two new columns in place (no data loss) and seeds the program as a draft.

BEGIN;
  ALTER TABLE programs ALTER COLUMN total_weeks DROP NOT NULL;
  ALTER TABLE programs ALTER COLUMN total_weeks DROP DEFAULT;
  ALTER TABLE workout_sets ADD COLUMN IF NOT EXISTS rir INTEGER;
  ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS target_sets INTEGER NOT NULL DEFAULT 3;
  ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS rep_range_low INTEGER;
  ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS rep_range_high INTEGER;
  ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS target_rir_per_set INTEGER[] NOT NULL DEFAULT '{}';
  ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS rest_seconds INTEGER;
  ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS rest_seconds_high INTEGER;
  ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS notes TEXT;
  ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS warmup_sets_low INTEGER;
  ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS warmup_sets_high INTEGER;
  ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS is_main BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE routine_exercises DROP COLUMN IF EXISTS target_rir;
  DO $$
DECLARE d RECORD;
BEGIN
  FOR d IN SELECT id, MIN(id) OVER (PARTITION BY name) AS keep_id FROM exercises LOOP
    IF d.id <> d.keep_id THEN
      UPDATE routine_exercises SET exercise_id = d.keep_id WHERE exercise_id = d.id;
      UPDATE routine_exercise_subs SET exercise_id = d.keep_id WHERE exercise_id = d.id;
      UPDATE workout_exercises SET exercise_id = d.keep_id WHERE exercise_id = d.id;
      DELETE FROM exercises WHERE id = d.id;
    END IF;
  END LOOP;
END $$;
  CREATE UNIQUE INDEX IF NOT EXISTS exercises_name_key ON exercises (name);
COMMIT;

DO $do$
DECLARE
  prog_name text := $name$Strength + Endurance — 3-day full-body strength block$name$;
  prog_desc text := $desc$3-day full-body strength block run alongside swimming, cycling and running. Goal: maintain and build strength on the main compound lifts while most training volume goes to endurance. Units: kg.

Weekly schedule
Mon — Day C (Overhead / Upper), AM. Run club (hard) at lunch = key run of the week.
Tue — Day A (Squat / Push), AM. Day after run club — autoregulate if legs are sore.
Wed — Swim (AM, work from home).
Thu — Day B (Hinge / Row), AM. Optional easy 5k at lunch.
Fri — Rest / optional easy spin.
Sat — Long run OR long ride (key endurance session).
Sun — Recovery (walk, easy swim or mobility).

Progression — double progression
Main lifts: start ~2 RIR, work to 1 RIR. When you hit the top of the rep range on all sets, add 2.5 kg next session and drop back to the bottom of the range.
Secondary compounds: same rule, keep 1 RIR. Isolation: chase reps to the top of the range first, then a small load bump (0–1 RIR).
Autoregulate around endurance fatigue — after a hard run/ride, drop 1 set or ~5% load. Deload every 6–8 weeks: halve the sets, keep the loads, then push again.$desc$;
  exmeta jsonb := $json${"Barbell Back Squat":["Legs","Barbell squat with the bar on the upper back; main lower-body strength lift."],"Front Squat":["Legs","Squat with the barbell racked across the front of the shoulders."],"Hack Squat":["Legs","Machine squat with the back supported against an angled pad."],"Barbell RDL":["Legs","Romanian deadlift with a barbell; hip hinge targeting hamstrings and glutes."],"DB RDL":["Legs","Romanian deadlift holding dumbbells."],"Trap-Bar RDL":["Legs","Romanian deadlift using a trap/hex bar."],"Bulgarian Split Squat":["Legs","Rear-foot-elevated split squat; single-leg strength and stability."],"Walking Lunge":["Legs","Alternating forward lunges performed while moving forward."],"Leg Press":["Legs","Press a weighted platform away from you using your legs on a machine."],"Standing Calf Raise":["Legs","Raise onto the toes while standing against resistance."],"Seated Calf Raise":["Legs","Calf raise performed seated with the knees bent."],"Leg Press Calf Press":["Legs","Calf raise by pushing through the toes on the leg-press platform."],"Lying Leg Curl":["Legs","Prone hamstring curl on a machine."],"Seated Leg Curl":["Legs","Hamstring curl performed seated on a machine."],"Nordic Ham Curl":["Legs","Bodyweight eccentric hamstring curl with the ankles anchored."],"Weighted Dips":["Chest","Parallel-bar dips with added load; chest and triceps press."],"Machine Chest Press":["Chest","Seated chest press on a machine."],"Incline DB Press":["Chest","Dumbbell press on an inclined bench targeting the upper chest."],"Barbell Incline Press":["Chest","Barbell bench press on an inclined bench."],"Machine Incline Press":["Chest","Incline chest press on a machine."],"Flat DB Press":["Chest","Flat-bench dumbbell press."],"Bench Press":["Chest","Lie on a bench and press a barbell upward from chest height."],"Weighted Pull-Up":["Back","Pull-up with added load once bodyweight reps are easy."],"Assisted Pull-Up":["Back","Pull-up with machine or band assistance."],"Neutral-Grip Pull-Up":["Back","Pull-up with the palms facing each other."],"Chest-Supported Row":["Back","Row with the chest supported on a pad to remove lower-back involvement."],"Lat Pulldown":["Back","Pull a cable bar down to chest level, targeting the lats."],"Barbell Row":["Back","Hinge at the hips and row a barbell to your lower chest."],"Seated Cable Row":["Back","Row a cable attachment toward your torso while seated."],"Barbell Overhead Press":["Shoulders","Standing barbell press from the shoulders overhead."],"Seated DB Shoulder Press":["Shoulders","Seated dumbbell overhead press."],"Machine Shoulder Press":["Shoulders","Overhead press performed on a machine."],"Lateral Raise":["Shoulders","Raise dumbbells out to the sides to shoulder height; medial delts."],"Cable Lateral Raise":["Shoulders","Lateral raise using a cable for constant tension."],"Machine Lateral Raise":["Shoulders","Lateral raise performed on a machine."],"Face Pull":["Shoulders","Pull a rope toward your face; rear delts and rotator cuff."],"Reverse Pec Deck":["Shoulders","Rear-delt fly on the pec-deck machine."],"Band Pull-Apart":["Shoulders","Pull a resistance band apart; rear delts and upper back."],"EZ-Bar Curl":["Arms","Biceps curl using an EZ bar."],"DB Curl":["Arms","Dumbbell biceps curl."],"Cable Curl":["Arms","Biceps curl using a cable."],"Triceps Pressdown":["Arms","Cable triceps pressdown with a rope or bar."],"Overhead Cable Extension":["Arms","Overhead triceps extension using a cable."],"Close-Grip Dip":["Arms","Upright dip with a narrow grip to bias the triceps."],"Hanging Leg Raise":["Core","Hang from a bar and raise the legs, controlling the descent."],"Cable Crunch":["Core","Kneel and crunch toward the floor using a cable machine."],"Lying Leg Raise":["Core","Lie on your back and raise the legs to 90 degrees."]}$json$;
  sessions jsonb := $json$[{"name":"Day C — Overhead / Upper","exercises":[{"name":"Barbell Overhead Press","sets":3,"repLow":4,"repHigh":6,"rir":[2,2,1],"rest":180,"warmup":[2,3],"main":true,"subs":["Seated DB Shoulder Press","Machine Shoulder Press"],"notes":"Main vertical press. Brace, press in a straight line past the forehead."},{"name":"Weighted Pull-Up","sets":3,"repLow":6,"repHigh":10,"rir":[1,1,1],"rest":150,"warmup":[1,2],"main":true,"subs":["Lat Pulldown","Neutral-Grip Pull-Up"],"notes":"First vertical pull of the week. Add load once bodyweight is easy; full ROM, control the negative."},{"name":"Flat DB Press","sets":2,"repLow":8,"repHigh":12,"rir":[1,1],"rest":120,"warmup":[1,2],"subs":["Machine Chest Press","Bench Press"],"notes":"First horizontal press of the week. Flat or incline; chase reps in the range before adding load."},{"name":"Lying Leg Curl","sets":3,"repLow":8,"repHigh":12,"rir":[1,1,1],"rest":90,"warmup":[1,1],"subs":["Seated Leg Curl","Nordic Ham Curl"],"notes":"Hamstring health for runners; balances the RDL. Big stretch at the bottom."},{"name":"EZ-Bar Curl","sets":2,"repLow":8,"repHigh":12,"rir":[1,1],"rest":60,"subs":["DB Curl","Cable Curl"],"notes":"Keep some direct arm work. Target 0–1 RIR."},{"name":"Triceps Pressdown","sets":2,"repLow":10,"repHigh":15,"rir":[1,1],"rest":60,"subs":["Overhead Cable Extension","Close-Grip Dip"],"notes":"Rope or bar, whichever feels better. Target 0–1 RIR."}]},{"name":"Day A — Squat / Push","exercises":[{"name":"Barbell Back Squat","sets":3,"repLow":4,"repHigh":6,"rir":[2,2,1],"rest":180,"warmup":[2,3],"main":true,"subs":["Front Squat","Hack Squat"],"notes":"Main lower-body strength lift. Brace hard, controlled descent, full depth."},{"name":"Weighted Dips","sets":3,"repLow":6,"repHigh":8,"rir":[1,1,1],"rest":150,"warmup":[1,2],"main":true,"subs":["Machine Chest Press","Incline DB Press"],"notes":"Lean forward = chest bias, upright = triceps. Add load at top of range."},{"name":"Weighted Pull-Up","sets":3,"repLow":6,"repHigh":8,"rir":[1,1,1],"rest":150,"warmup":[1,2],"main":true,"subs":["Lat Pulldown","Assisted Pull-Up"],"notes":"Second vertical pull of the week. Add load once bodyweight is easy; full ROM."},{"name":"Seated DB Shoulder Press","sets":2,"repLow":8,"repHigh":10,"rir":[1,1],"rest":120,"warmup":[1,2],"subs":["Barbell Overhead Press","Machine Shoulder Press"],"notes":"Secondary press (OHP is the Day C main)."},{"name":"Standing Calf Raise","sets":2,"repLow":8,"repHigh":12,"rir":[1,1],"rest":90,"warmup":[1,1],"subs":["Leg Press Calf Press","Seated Calf Raise"],"notes":"1–2 s pause at the bottom, full stretch. Target 0–1 RIR."},{"name":"Hanging Leg Raise","sets":2,"repLow":10,"repHigh":15,"rir":[1,1],"rest":60,"subs":["Cable Crunch","Lying Leg Raise"],"notes":"Optional core. Control down, no swinging."}]},{"name":"Day B — Hinge / Row","exercises":[{"name":"Barbell RDL","sets":3,"repLow":5,"repHigh":8,"rir":[2,2,1],"rest":180,"warmup":[2,3],"main":true,"subs":["DB RDL","Trap-Bar RDL"],"notes":"Main hinge. Hips back, bar over mid-foot, neutral spine, deep stretch."},{"name":"Incline DB Press","sets":3,"repLow":6,"repHigh":10,"rir":[1,1,1],"rest":150,"warmup":[1,2],"main":true,"subs":["Barbell Incline Press","Machine Incline Press"],"notes":"30–45° bench. 1 s pause at the bottom."},{"name":"Chest-Supported Row","sets":3,"repLow":8,"repHigh":10,"rir":[1,1,1],"rest":120,"warmup":[1,2],"main":true,"subs":["Barbell Row","Seated Cable Row"],"notes":"Squeeze shoulder blades, elbows ~45°. Balances the pressing."},{"name":"Bulgarian Split Squat","sets":2,"repLow":8,"repHigh":12,"rir":[1,1],"rest":120,"warmup":[1,2],"subs":["Walking Lunge","Leg Press"],"notes":"8–12 per leg. Single-leg strength & stability — carries over to running."},{"name":"Lateral Raise","sets":3,"repLow":12,"repHigh":15,"rir":[0,0,0],"rest":60,"subs":["Cable Lateral Raise","Machine Lateral Raise"],"notes":"Lead with the elbow; smooth, controlled reps."},{"name":"Face Pull","sets":2,"repLow":15,"repHigh":20,"rir":[1,1],"rest":60,"subs":["Reverse Pec Deck","Band Pull-Apart"],"notes":"Optional. Shoulder health — worth keeping given swim volume."}]}]$json$;
  prog_id int; routine_id int; re_id int; ex_id int; sub_id int;
  s jsonb; e jsonb; sub text;
  ridx int; eidx int; sidx int;
BEGIN
  IF EXISTS (SELECT 1 FROM programs WHERE name = prog_name) THEN
    RAISE NOTICE 'Program "%" already exists - skipping seed.', prog_name;
    RETURN;
  END IF;

  INSERT INTO programs (name, description, total_weeks, status)
  VALUES (prog_name, prog_desc, NULL, 'draft') RETURNING id INTO prog_id;

  ridx := 0;
  FOR s IN SELECT value FROM jsonb_array_elements(sessions) LOOP
    INSERT INTO routines (program_id, name, sort_order)
    VALUES (prog_id, s->>'name', ridx) RETURNING id INTO routine_id;

    eidx := 0;
    FOR e IN SELECT value FROM jsonb_array_elements(s->'exercises') LOOP
      SELECT id INTO ex_id FROM exercises WHERE name = e->>'name' ORDER BY id LIMIT 1;
      IF ex_id IS NULL THEN
        INSERT INTO exercises (name, muscle_group, description)
        VALUES (e->>'name', (exmeta->(e->>'name'))->>0, (exmeta->(e->>'name'))->>1)
        RETURNING id INTO ex_id;
      END IF;

      INSERT INTO routine_exercises
        (routine_id, exercise_id, sort_order, target_sets, rep_range_low, rep_range_high, target_rir_per_set, rest_seconds, notes, warmup_sets_low, warmup_sets_high, is_main)
      VALUES (
        routine_id, ex_id, eidx,
        (e->>'sets')::int, (e->>'repLow')::int, (e->>'repHigh')::int,
        ARRAY(SELECT jsonb_array_elements_text(e->'rir')::int),
        (e->>'rest')::int, e->>'notes',
        (e->'warmup'->>0)::int, (e->'warmup'->>1)::int,
        COALESCE((e->>'main')::boolean, false)
      ) RETURNING id INTO re_id;

      sidx := 0;
      FOR sub IN SELECT value FROM jsonb_array_elements_text(e->'subs') LOOP
        SELECT id INTO sub_id FROM exercises WHERE name = sub ORDER BY id LIMIT 1;
        IF sub_id IS NULL THEN
          INSERT INTO exercises (name, muscle_group, description)
          VALUES (sub, (exmeta->sub)->>0, (exmeta->sub)->>1)
          RETURNING id INTO sub_id;
        END IF;
        INSERT INTO routine_exercise_subs (routine_exercise_id, exercise_id, sort_order)
        VALUES (re_id, sub_id, sidx);
        sidx := sidx + 1;
      END LOOP;

      eidx := eidx + 1;
    END LOOP;
    ridx := ridx + 1;
  END LOOP;

  RAISE NOTICE 'Seeded program "%" (id %) as a draft.', prog_name, prog_id;
END
$do$;
