import Navbar from "@/components/navbar";
import WorkoutForm from "@/components/workout-form";
import { getExercises } from "@/src/db/queries/exercises";
import { getWorkoutForEdit } from "@/src/db/queries/workouts";

export default async function EditWorkoutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const workout = await getWorkoutForEdit(id);

  if (!workout) {
    return <div className="p-4">Workout not found</div>;
  }

  const exercises = await getExercises(workout.workoutName);

  return (
    <>
      <Navbar url={`/workout-plans/${workout.workoutPlanId}`} />
      <WorkoutForm exercises={exercises} initialWorkout={workout} />
    </>
  );
}
