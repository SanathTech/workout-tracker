const db = require('./index');
const { migrate } = require('./migrations');

// Seeds the "Strength + Endurance" 3-day full-body strength block as a draft
// program. Safe to run against the live DB: it migrates the two new columns
// (programs.total_weeks nullable, workout_sets.rir) in place without touching
// logged history, ensures every exercise it references exists, and only creates
// the program if one with the same name isn't already there.
//
//   node src/db/seed-program.js   (or: npm run db:seed-program)

const PROGRAM_NAME = 'Strength + Endurance — 3-day full-body strength block';

const PROGRAM_DESCRIPTION = `3-day full-body strength block run alongside swimming, cycling and running. Goal: maintain and build strength on the main compound lifts while most training volume goes to endurance. Units: kg.

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
Autoregulate around endurance fatigue — after a hard run/ride, drop 1 set or ~5% load. Deload every 6–8 weeks: halve the sets, keep the loads, then push again.`;

// name -> [muscle_group, description]. Existing library exercises are matched by
// name and reused; only the missing ones are inserted.
const EXERCISES = {
  // Legs
  'Barbell Back Squat': ['Legs', 'Barbell squat with the bar on the upper back; main lower-body strength lift.'],
  'Front Squat': ['Legs', 'Squat with the barbell racked across the front of the shoulders.'],
  'Hack Squat': ['Legs', 'Machine squat with the back supported against an angled pad.'],
  'Barbell RDL': ['Legs', 'Romanian deadlift with a barbell; hip hinge targeting hamstrings and glutes.'],
  'DB RDL': ['Legs', 'Romanian deadlift holding dumbbells.'],
  'Trap-Bar RDL': ['Legs', 'Romanian deadlift using a trap/hex bar.'],
  'Bulgarian Split Squat': ['Legs', 'Rear-foot-elevated split squat; single-leg strength and stability.'],
  'Walking Lunge': ['Legs', 'Alternating forward lunges performed while moving forward.'],
  'Leg Press': ['Legs', 'Press a weighted platform away from you using your legs on a machine.'],
  'Standing Calf Raise': ['Legs', 'Raise onto the toes while standing against resistance.'],
  'Seated Calf Raise': ['Legs', 'Calf raise performed seated with the knees bent.'],
  'Leg Press Calf Press': ['Legs', 'Calf raise by pushing through the toes on the leg-press platform.'],
  'Lying Leg Curl': ['Legs', 'Prone hamstring curl on a machine.'],
  'Seated Leg Curl': ['Legs', 'Hamstring curl performed seated on a machine.'],
  'Nordic Ham Curl': ['Legs', 'Bodyweight eccentric hamstring curl with the ankles anchored.'],
  // Chest
  'Weighted Dips': ['Chest', 'Parallel-bar dips with added load; chest and triceps press.'],
  'Machine Chest Press': ['Chest', 'Seated chest press on a machine.'],
  'Incline DB Press': ['Chest', 'Dumbbell press on an inclined bench targeting the upper chest.'],
  'Barbell Incline Press': ['Chest', 'Barbell bench press on an inclined bench.'],
  'Machine Incline Press': ['Chest', 'Incline chest press on a machine.'],
  'Flat DB Press': ['Chest', 'Flat-bench dumbbell press.'],
  'Bench Press': ['Chest', 'Lie on a bench and press a barbell upward from chest height.'],
  // Back
  'Weighted Pull-Up': ['Back', 'Pull-up with added load once bodyweight reps are easy.'],
  'Assisted Pull-Up': ['Back', 'Pull-up with machine or band assistance.'],
  'Neutral-Grip Pull-Up': ['Back', 'Pull-up with the palms facing each other.'],
  'Chest-Supported Row': ['Back', 'Row with the chest supported on a pad to remove lower-back involvement.'],
  'Lat Pulldown': ['Back', 'Pull a cable bar down to chest level, targeting the lats.'],
  'Barbell Row': ['Back', 'Hinge at the hips and row a barbell to your lower chest.'],
  'Seated Cable Row': ['Back', 'Row a cable attachment toward your torso while seated.'],
  // Shoulders
  'Barbell Overhead Press': ['Shoulders', 'Standing barbell press from the shoulders overhead.'],
  'Seated DB Shoulder Press': ['Shoulders', 'Seated dumbbell overhead press.'],
  'Machine Shoulder Press': ['Shoulders', 'Overhead press performed on a machine.'],
  'Lateral Raise': ['Shoulders', 'Raise dumbbells out to the sides to shoulder height; medial delts.'],
  'Cable Lateral Raise': ['Shoulders', 'Lateral raise using a cable for constant tension.'],
  'Machine Lateral Raise': ['Shoulders', 'Lateral raise performed on a machine.'],
  'Face Pull': ['Shoulders', 'Pull a rope toward your face; rear delts and rotator cuff.'],
  'Reverse Pec Deck': ['Shoulders', 'Rear-delt fly on the pec-deck machine.'],
  'Band Pull-Apart': ['Shoulders', 'Pull a resistance band apart; rear delts and upper back.'],
  // Arms
  'EZ-Bar Curl': ['Arms', 'Biceps curl using an EZ bar.'],
  'DB Curl': ['Arms', 'Dumbbell biceps curl.'],
  'Cable Curl': ['Arms', 'Biceps curl using a cable.'],
  'Triceps Pressdown': ['Arms', 'Cable triceps pressdown with a rope or bar.'],
  'Overhead Cable Extension': ['Arms', 'Overhead triceps extension using a cable.'],
  'Close-Grip Dip': ['Arms', 'Upright dip with a narrow grip to bias the triceps.'],
  // Core
  'Hanging Leg Raise': ['Core', 'Hang from a bar and raise the legs, controlling the descent.'],
  'Cable Crunch': ['Core', 'Kneel and crunch toward the floor using a cable machine.'],
  'Lying Leg Raise': ['Core', 'Lie on your back and raise the legs to 90 degrees.'],
};

// The three sessions, in training-cycle order (Mon Day C → Tue Day A → Thu Day B).
// The app is sequence-driven, so this order is what "next workout" cycles through.
// rir arrays are per working set; "2 → 1" main-lift targets ramp across sets,
// single/near-failure targets repeat. rest is in seconds. warmup is [low, high]
// ramp-up sets (shown as a chip); omit for exercises that need none.
const SESSIONS = [
  {
    name: 'Day C — Overhead / Upper',
    exercises: [
      { name: 'Barbell Overhead Press', sets: 3, repLow: 4, repHigh: 6, rir: [2, 2, 1], rest: 180, warmup: [2, 3], main: true,
        subs: ['Seated DB Shoulder Press', 'Machine Shoulder Press'],
        notes: 'Main vertical press. Brace, press in a straight line past the forehead.' },
      { name: 'Weighted Pull-Up', sets: 3, repLow: 6, repHigh: 10, rir: [1, 1, 1], rest: 150, warmup: [1, 2],
        subs: ['Lat Pulldown', 'Neutral-Grip Pull-Up'],
        notes: 'First vertical pull of the week. Add load once bodyweight is easy; full ROM, control the negative.' },
      { name: 'Flat DB Press', sets: 2, repLow: 8, repHigh: 12, rir: [1, 1], rest: 120, warmup: [1, 2],
        subs: ['Machine Chest Press', 'Bench Press'],
        notes: 'First horizontal press of the week. Flat or incline; chase reps in the range before adding load.' },
      { name: 'Lying Leg Curl', sets: 3, repLow: 8, repHigh: 12, rir: [1, 1, 1], rest: 90, warmup: [1, 1],
        subs: ['Seated Leg Curl', 'Nordic Ham Curl'],
        notes: 'Hamstring health for runners; balances the RDL. Big stretch at the bottom.' },
      { name: 'EZ-Bar Curl', sets: 2, repLow: 8, repHigh: 12, rir: [1, 1], rest: 60,
        subs: ['DB Curl', 'Cable Curl'],
        notes: 'Keep some direct arm work. Target 0–1 RIR.' },
      { name: 'Triceps Pressdown', sets: 2, repLow: 10, repHigh: 15, rir: [1, 1], rest: 60,
        subs: ['Overhead Cable Extension', 'Close-Grip Dip'],
        notes: 'Rope or bar, whichever feels better. Target 0–1 RIR.' },
    ],
  },
  {
    name: 'Day A — Squat / Push',
    exercises: [
      { name: 'Barbell Back Squat', sets: 3, repLow: 4, repHigh: 6, rir: [2, 2, 1], rest: 180, warmup: [2, 3], main: true,
        subs: ['Front Squat', 'Hack Squat'],
        notes: 'Main lower-body strength lift. Brace hard, controlled descent, full depth.' },
      { name: 'Weighted Dips', sets: 3, repLow: 6, repHigh: 8, rir: [1, 1, 1], rest: 150, warmup: [1, 2],
        subs: ['Machine Chest Press', 'Incline DB Press'],
        notes: 'Lean forward = chest bias, upright = triceps. Add load at top of range.' },
      { name: 'Weighted Pull-Up', sets: 3, repLow: 6, repHigh: 8, rir: [1, 1, 1], rest: 150, warmup: [1, 2],
        subs: ['Lat Pulldown', 'Assisted Pull-Up'],
        notes: 'Second vertical pull of the week. Add load once bodyweight is easy; full ROM.' },
      { name: 'Seated DB Shoulder Press', sets: 2, repLow: 8, repHigh: 10, rir: [1, 1], rest: 120, warmup: [1, 2],
        subs: ['Barbell Overhead Press', 'Machine Shoulder Press'],
        notes: 'Secondary press (OHP is the Day C main).' },
      { name: 'Standing Calf Raise', sets: 2, repLow: 8, repHigh: 12, rir: [1, 1], rest: 90, warmup: [1, 1],
        subs: ['Leg Press Calf Press', 'Seated Calf Raise'],
        notes: '1–2 s pause at the bottom, full stretch. Target 0–1 RIR.' },
      { name: 'Hanging Leg Raise', sets: 2, repLow: 10, repHigh: 15, rir: [1, 1], rest: 60,
        subs: ['Cable Crunch', 'Lying Leg Raise'],
        notes: 'Optional core. Control down, no swinging.' },
    ],
  },
  {
    name: 'Day B — Hinge / Row',
    exercises: [
      { name: 'Barbell RDL', sets: 3, repLow: 5, repHigh: 8, rir: [2, 2, 1], rest: 180, warmup: [2, 3], main: true,
        subs: ['DB RDL', 'Trap-Bar RDL'],
        notes: 'Main hinge. Hips back, bar over mid-foot, neutral spine, deep stretch.' },
      { name: 'Incline DB Press', sets: 3, repLow: 6, repHigh: 10, rir: [1, 1, 1], rest: 150, warmup: [1, 2],
        subs: ['Barbell Incline Press', 'Machine Incline Press'],
        notes: '30–45° bench. 1 s pause at the bottom.' },
      { name: 'Chest-Supported Row', sets: 3, repLow: 8, repHigh: 10, rir: [1, 1, 1], rest: 120, warmup: [1, 2],
        subs: ['Barbell Row', 'Seated Cable Row'],
        notes: 'Squeeze shoulder blades, elbows ~45°. Balances the pressing.' },
      { name: 'Bulgarian Split Squat', sets: 2, repLow: 8, repHigh: 12, rir: [1, 1], rest: 120, warmup: [1, 2],
        subs: ['Walking Lunge', 'Leg Press'],
        notes: '8–12 per leg. Single-leg strength & stability — carries over to running.' },
      { name: 'Lateral Raise', sets: 3, repLow: 12, repHigh: 15, rir: [0, 0, 0], rest: 60,
        subs: ['Cable Lateral Raise', 'Machine Lateral Raise'],
        notes: 'Lead with the elbow; smooth, controlled reps.' },
      { name: 'Face Pull', sets: 2, repLow: 15, repHigh: 20, rir: [1, 1], rest: 60,
        subs: ['Reverse Pec Deck', 'Band Pull-Apart'],
        notes: 'Optional. Shoulder health — worth keeping given swim volume.' },
    ],
  },
];

async function ensureExercise(client, name) {
  const found = await client.query('SELECT id FROM exercises WHERE name = $1 ORDER BY id LIMIT 1', [name]);
  if (found.rows.length) return found.rows[0].id;
  const meta = EXERCISES[name];
  if (!meta) throw new Error(`No muscle group / description defined for exercise "${name}"`);
  const { rows } = await client.query(
    'INSERT INTO exercises (name, muscle_group, description) VALUES ($1, $2, $3) RETURNING id',
    [name, meta[0], meta[1]]
  );
  return rows[0].id;
}

async function run() {
  const client = await db.pool.connect();
  try {
    await migrate(client);

    const existing = await client.query('SELECT id FROM programs WHERE name = $1', [PROGRAM_NAME]);
    if (existing.rows.length) {
      console.log(`ℹ️  Program "${PROGRAM_NAME}" already exists (id ${existing.rows[0].id}) — skipping. Delete it first to re-seed.`);
      return;
    }

    await client.query('BEGIN');

    const progRes = await client.query(
      `INSERT INTO programs (name, description, total_weeks, status)
       VALUES ($1, $2, NULL, 'draft') RETURNING id`,
      [PROGRAM_NAME, PROGRAM_DESCRIPTION]
    );
    const programId = progRes.rows[0].id;

    for (let r = 0; r < SESSIONS.length; r++) {
      const session = SESSIONS[r];
      const routineRes = await client.query(
        'INSERT INTO routines (program_id, name, sort_order) VALUES ($1, $2, $3) RETURNING id',
        [programId, session.name, r]
      );
      const routineId = routineRes.rows[0].id;

      for (let e = 0; e < session.exercises.length; e++) {
        const ex = session.exercises[e];
        const exerciseId = await ensureExercise(client, ex.name);
        const reRes = await client.query(
          `INSERT INTO routine_exercises
             (routine_id, exercise_id, sort_order, target_sets, rep_range_low, rep_range_high, target_rir_per_set, rest_seconds, notes, warmup_sets_low, warmup_sets_high, is_main)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
          [routineId, exerciseId, e, ex.sets, ex.repLow, ex.repHigh, ex.rir, ex.rest, ex.notes, ex.warmup?.[0] ?? null, ex.warmup?.[1] ?? null, ex.main === true]
        );
        const reId = reRes.rows[0].id;

        for (let s = 0; s < ex.subs.length; s++) {
          const subId = await ensureExercise(client, ex.subs[s]);
          await client.query(
            'INSERT INTO routine_exercise_subs (routine_exercise_id, exercise_id, sort_order) VALUES ($1, $2, $3)',
            [reId, subId, s]
          );
        }
      }
    }

    await client.query('COMMIT');
    console.log(`✅ Seeded program "${PROGRAM_NAME}" (id ${programId}) with ${SESSIONS.length} routines as a draft.`);
    console.log('   Open the app → Program → Start program to activate it.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Program seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await db.pool.end();
  }
}

run();
