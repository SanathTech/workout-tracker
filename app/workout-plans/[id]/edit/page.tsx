import Navbar from "@/components/navbar";
import WorkoutPlanEditForm from "@/components/workout-plan-edit-form";

async function EditWorkoutPlan({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <>
      <Navbar />
      <WorkoutPlanEditForm id={id} />
    </>
  );
}

export default EditWorkoutPlan;
