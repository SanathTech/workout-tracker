import WorkoutForm from "@/components/workout-form";
import { getExercises } from "@/src/db/queries/exercises";

export default async function Home() {
  const exercises = await getExercises();
  return <WorkoutForm exercises={exercises} />;
}
