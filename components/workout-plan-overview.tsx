"use client";

import React, { useEffect } from "react";
import { Card, CardContent, CardTitle } from "./ui/card";
import { useRouter } from "next/navigation";
import { WorkoutDraft } from "./workout-form";
import { CheckCircle2Icon } from "lucide-react";

function WorkoutPlanOverview({
  workoutPlanId,
  workouts,
}: {
  workoutPlanId: string;
  workouts: Array<{
    id: string;
    name: string;
    workoutPlanId: string;
    week: number;
    day: number;
  }>;
}) {
  const router = useRouter();
  const [workoutPlan, setWorkoutPlan] = React.useState<{
    id: string;
    userId: string;
    createdAt: Date;
    name: string;
    weeks: number;
    daysPerWeek: number;
    workouts: string[];
  }>();

  useEffect(() => {
    const url = "/api/workout-plans/" + workoutPlanId;
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        console.log("Fetched workout plan:", data);
        setWorkoutPlan(data.plan);
      })
      .catch((err) => {
        console.error("Error fetching workout plan:", err);
      });
  }, [workoutPlanId]);

  const weeks = workoutPlan ? workoutPlan.weeks : 0;

  const handleClick = async (
    workout: { id: string | null; name: string },
    week: number,
    day: number,
  ) => {
    if (workout.id) {
      return router.push(`/workouts/${workout.id}`);
    }
    const payload: WorkoutDraft = {
      workoutName: workout.name.trim() || undefined,
      workoutPlanId,
      week,
      day,
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
                <div className="font-semibold mb-2">Week {weekIndex + 1}</div>
                <div>
                  {workoutPlan?.workouts.map((workout, idx) => {
                    const id =
                      workouts.find(
                        (w) =>
                          w.name === workout &&
                          w.week === weekIndex + 1 &&
                          w.day === idx + 1,
                      )?.id || null;
                    return (
                      <div
                        key={idx}
                        onClick={() =>
                          handleClick(
                            {
                              id,
                              name: workout,
                            },
                            weekIndex + 1,
                            idx + 1,
                          )
                        }
                        className="p-2 border rounded mb-2 flex items-center justify-between"
                      >
                        <div>
                          Day {idx + 1}: {workout}
                        </div>
                        {id && (
                          <CheckCircle2Icon className="inline-block ml-2 text-green-500" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default WorkoutPlanOverview;
