const db = require('./index');

const exercises = [
  // Chest
  { name: 'Bench Press', muscle_group: 'Chest', description: 'Lie on a bench and press a barbell upward from chest height.' },
  { name: 'Incline Bench Press', muscle_group: 'Chest', description: 'Bench press performed on an inclined bench targeting upper chest.' },
  { name: 'Push-Up', muscle_group: 'Chest', description: 'Bodyweight exercise targeting chest, shoulders, and triceps.' },
  { name: 'Chest Fly', muscle_group: 'Chest', description: 'Isolation movement using dumbbells or cables to stretch and contract the chest.' },
  { name: 'Decline Bench Press', muscle_group: 'Chest', description: 'Bench press on a declined bench targeting lower chest.' },

  // Back
  { name: 'Pull-Up', muscle_group: 'Back', description: 'Bodyweight exercise pulling body up to a bar, targeting lats and biceps.' },
  { name: 'Barbell Row', muscle_group: 'Back', description: 'Hinge at the hips and row a barbell to your lower chest.' },
  { name: 'Lat Pulldown', muscle_group: 'Back', description: 'Pull a cable bar down to chest level, targeting the latissimus dorsi.' },
  { name: 'Seated Cable Row', muscle_group: 'Back', description: 'Row a cable attachment toward your torso while seated.' },
  { name: 'Deadlift', muscle_group: 'Back', description: 'Pick a loaded barbell off the floor using a hip hinge motion.' },

  // Shoulders
  { name: 'Overhead Press', muscle_group: 'Shoulders', description: 'Press a barbell or dumbbells from shoulder height overhead.' },
  { name: 'Lateral Raise', muscle_group: 'Shoulders', description: 'Raise dumbbells out to the sides to shoulder height, targeting medial delts.' },
  { name: 'Front Raise', muscle_group: 'Shoulders', description: 'Raise dumbbells straight in front of you to shoulder height.' },
  { name: 'Face Pull', muscle_group: 'Shoulders', description: 'Pull a rope attachment toward your face, targeting rear delts and rotator cuff.' },
  { name: 'Arnold Press', muscle_group: 'Shoulders', description: 'Rotating dumbbell press that works all three heads of the deltoid.' },

  // Legs
  { name: 'Squat', muscle_group: 'Legs', description: 'Lower your body by bending knees with a barbell on your back.' },
  { name: 'Leg Press', muscle_group: 'Legs', description: 'Press a weighted platform away from you using your legs on a machine.' },
  { name: 'Romanian Deadlift', muscle_group: 'Legs', description: 'Hip hinge movement targeting hamstrings and glutes.' },
  { name: 'Leg Curl', muscle_group: 'Legs', description: 'Curl your legs up against resistance on a leg curl machine.' },
  { name: 'Calf Raise', muscle_group: 'Legs', description: 'Rise up on your toes against resistance to target the calves.' },
  { name: 'Lunges', muscle_group: 'Legs', description: 'Step forward and lower your back knee toward the ground.' },
  { name: 'Leg Extension', muscle_group: 'Legs', description: 'Extend your legs against resistance on a machine, targeting quads.' },

  // Arms
  { name: 'Bicep Curl', muscle_group: 'Arms', description: 'Curl a dumbbell or barbell from your hips to your shoulders.' },
  { name: 'Hammer Curl', muscle_group: 'Arms', description: 'Neutral-grip curl targeting biceps and brachialis.' },
  { name: 'Tricep Pushdown', muscle_group: 'Arms', description: 'Push a cable attachment downward using only your triceps.' },
  { name: 'Skull Crusher', muscle_group: 'Arms', description: 'Lower a barbell or dumbbells toward your forehead, targeting triceps.' },
  { name: 'Dips', muscle_group: 'Arms', description: 'Lower and press your body weight on parallel bars, targeting triceps and chest.' },
  { name: 'Preacher Curl', muscle_group: 'Arms', description: 'Curl with your arms resting on a preacher bench for isolation.' },

  // Core
  { name: 'Plank', muscle_group: 'Core', description: 'Hold a push-up position on forearms and toes, engaging the core.' },
  { name: 'Crunches', muscle_group: 'Core', description: 'Lie on your back and curl your shoulders toward your pelvis.' },
  { name: 'Russian Twist', muscle_group: 'Core', description: 'Seated, rotate your torso left and right with a weight.' },
  { name: 'Leg Raise', muscle_group: 'Core', description: 'Lie on your back and raise your legs to 90 degrees.' },
  { name: 'Dead Bug', muscle_group: 'Core', description: 'Opposite arm and leg extension while keeping lower back flat on floor.' },
  { name: 'Cable Crunch', muscle_group: 'Core', description: 'Kneel and crunch toward the floor using a cable machine.' },
];

async function seed() {
  try {
    for (const ex of exercises) {
      await db.query(
        `INSERT INTO exercises (name, muscle_group, description)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [ex.name, ex.muscle_group, ex.description]
      );
    }
    console.log(`✅ Seeded ${exercises.length} exercises.`);
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
  } finally {
    await db.pool.end();
  }
}

seed();
