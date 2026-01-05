"use client";

import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { WorkoutDraft } from "@/components/workout-form";
import { useRouter } from "next/navigation";

function WorkoutPlan() {
  const weeks = 12;
  const workouts = [
    { id: null, name: "Upper 1" },
    { id: null, name: "Lower 1" },
    { id: null, name: "Upper 2" },
    { id: null, name: "Lower 2" },
    { id: null, name: "Arms/Delts" },
  ];
  const router = useRouter();

  const handleClick = async (workout: { id: string | null; name: string }) => {
    if (workout.id) {
      return router.push(`/workouts/${workout.id}`);
    }
    const payload: WorkoutDraft = {
      workoutName: workout.name.trim() || undefined,
    };

    const url = "/api/workouts";

    const method = "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || "Failed to save workout");
    }

    const data = await res.json();
    router.push(`/workouts/${data.workoutId}`);
  };

  return (
    <div className="p-4">
      <Card>
        <CardTitle className="ml-4">Workout Plan Overview</CardTitle>
        <CardContent>
          <div className="flex flex-col gap-4">
            {Array.from({ length: weeks }, (_, weekIndex) => (
              <div key={weekIndex}>
                <div>Week {weekIndex + 1}</div>
                <div>
                  {workouts.map((workout, idx) => (
                    <div key={idx} onClick={() => handleClick(workout)}>
                      Day {idx + 1}: {workout.name}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default WorkoutPlan;
