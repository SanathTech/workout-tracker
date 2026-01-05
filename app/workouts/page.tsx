import { getAllWorkoutsSummary } from "@/src/db/queries/workouts";

export default async function Workouts() {
  const workouts = await getAllWorkoutsSummary();

  if (!workouts) {
    return <div className="p-4">Workouts not found</div>;
  }

  return (
    <div>
      <ul>
        {workouts.map((workout) => (
          <li key={workout.id}>
            <a href={`/workouts/${workout.id}`}>
              {workout.name} on{" "}
              {new Date(workout.startedAt).toLocaleDateString()}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
