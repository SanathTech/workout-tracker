import Navbar from "@/components/navbar";
import WorkoutPlanOverview from "@/components/workout-plan-overview";
import { getWorkoutsForPlan } from "@/src/db/queries/workouts";

async function WorkoutPlan({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workouts = await getWorkoutsForPlan(id);

  console.log("workouts:", workouts);

  return (
    <>
      <Navbar url={`/workout-plans`} />
      <WorkoutPlanOverview workoutPlanId={id} workouts={workouts} />
    </>
  );
}

export default WorkoutPlan;
