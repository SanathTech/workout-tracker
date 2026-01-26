"use client";

import React, { useEffect, useState } from "react";
import { Card, CardContent, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Exercise } from "@/app/workout-templates/page";
import { Badge } from "./ui/badge";
import { cn } from "@/lib/utils";

interface WorkoutPlan {
  id: string;
  userId: string;
  createdAt: Date;
  name: string;
  weeks: number;
  daysPerWeek: number;
  workouts: string[];
}

function WorkoutPlanEditForm({ id }: { id: string }) {
  const [currentDay, setCurrentDay] = React.useState(1);
  const [initialWorkouts, setInitialWorkouts] = useState<string[]>([]);
  const [workoutPlan, setWorkoutPlan] = useState<WorkoutPlan>();
  const [templates, setTemplates] = useState<
    Array<{ id: string; templateName: string; exerciseIds: string[] }>
  >([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [workoutName, setWorkoutName] = useState("");
  const [isUpdated, setIsUpdated] = useState(false);

  useEffect(() => {
    const url = "/api/workout-plans/" + id;
    const workoutTemplatesUrl = "/api/workout-templates";
    const exercisesUrl = "/api/exercises";
    let workoutPlan = {} as WorkoutPlan;
    let templates = [] as Array<{
      id: string;
      templateName: string;
      exerciseIds: string[];
    }>;
    Promise.all([
      fetch(url)
        .then((res) => res.json())
        .then((data) => {
          console.log("Fetched workout plan:", data);
          workoutPlan = data.plan;
          setWorkoutPlan(workoutPlan);
          setInitialWorkouts(workoutPlan.workouts);
        })
        .catch((err) => {
          console.error("Error fetching workout plan:", err);
        }),
      fetch(workoutTemplatesUrl)
        .then((res) => res.json())
        .then((data) => {
          console.log("Fetched workout templates:", data);
          templates = data.templates;
          setTemplates(templates);
        })
        .catch((err) => {
          console.error("Error fetching workout templates:", err);
        }),

      fetch(exercisesUrl)
        .then((res) => res.json())
        .then((data) => {
          console.log("Fetched exercises:", data);
          setExercises(data.exercises);
        })
        .catch((err) => {
          console.error("Error fetching exercise exercises:", err);
        }),
    ]).then(() =>
      setWorkoutName(
        templates.find(
          (t) => t.templateName === workoutPlan?.workouts[currentDay - 1],
        )?.templateName || "",
      ),
    );
  }, []);

  useEffect(() => {
    if (!workoutPlan) return;
    const updated = workoutPlan.workouts.some(
      (w, idx) => w !== initialWorkouts[idx],
    );
    setIsUpdated(updated);
  }, [workoutPlan]);

  const handleClick = () => {
    if (!workoutPlan) return;

    fetch("/api/workout-plans", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workoutPlanId: workoutPlan.id,
        workoutPlanName: workoutPlan.name,
        weeks: workoutPlan.weeks,
        daysPerWeek: workoutPlan.daysPerWeek,
        workouts: workoutPlan.workouts.map((w, idx) => {
          const { templateName: workoutName, exerciseIds } = templates.find(
            (t) => t.templateName === w,
          ) || { templateName: "", exerciseIds: [] };
          return {
            workoutName,
            exerciseIds,
          };
        }),
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        console.log("Workout plan created:", data);
      })
      .catch((err) => {
        console.error("Error creating workout plan:", err);
      });
  };

  if (!workoutPlan) {
    return <div className="p-4">Loading Workout Plan...</div>;
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <Card>
        <CardTitle className="ml-4">Day {currentDay}</CardTitle>
        <CardContent className="flex flex-col gap-4">
          <div>Workout Plan Name</div>
          <Input
            placeholder="Enter workout name"
            value={workoutPlan.name}
            onChange={(e) =>
              setWorkoutPlan((prev) =>
                prev ? { ...prev, name: e.target.value } : prev,
              )
            }
          />
          <div>Day {currentDay} Workout</div>
          {workoutName ? (
            <div>{workoutName}</div>
          ) : (
            <div>No workout selected</div>
          )}
          <div className="flex flex-col gap-4">
            <div>
              <Button
                onClick={() => {
                  setWorkoutName(
                    templates.find(
                      (t) =>
                        t.templateName ===
                        workoutPlan?.workouts[currentDay - 2],
                    )?.templateName || "",
                  );
                  setCurrentDay((prev) => Math.max(1, prev - 1));
                }}
                disabled={currentDay === 1}
              >
                Previous Day
              </Button>
              <Button
                className="ml-2"
                onClick={() => {
                  setWorkoutName(
                    templates.find(
                      (t) =>
                        t.templateName === workoutPlan?.workouts[currentDay],
                    )?.templateName || "",
                  );
                  setCurrentDay((prev) =>
                    Math.min(workoutPlan.daysPerWeek, prev + 1),
                  );
                }}
                disabled={currentDay === workoutPlan.daysPerWeek}
              >
                Next Day
              </Button>
            </div>
            <Button
              disabled={
                !isUpdated ||
                workoutPlan.workouts.length < workoutPlan.daysPerWeek
              }
              onClick={handleClick}
            >
              {initialWorkouts.length !== 0 ? "Update" : "Create"} Workout Plan
            </Button>
          </div>
        </CardContent>
      </Card>
      <div className="mt-6">
        <h2 className="text-2xl mb-4">Existing Templates</h2>
        {templates.length === 0 && <p>No templates available.</p>}
        {templates.map((template) => (
          <Card
            key={template.id}
            className={cn(
              "mb-4 cursor-pointer",
              template.templateName === workoutName && "border-2 border-white",
            )}
            onClick={() => {
              setWorkoutName(template.templateName);
              setWorkoutPlan((prev) =>
                prev
                  ? {
                      ...prev,
                      workouts: [
                        ...prev.workouts.slice(0, currentDay - 1),
                        template.templateName,
                        ...prev.workouts.slice(currentDay),
                      ],
                    }
                  : prev,
              );
            }}
          >
            <CardContent>
              <h3 className="text-xl font-semibold">{template.templateName}</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {template.exerciseIds.map((id) => {
                  const ex = exercises.find((ex) => ex.id === id);
                  if (!ex) return null;
                  return (
                    <Badge key={id} variant="secondary">
                      {ex.name}
                    </Badge>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default WorkoutPlanEditForm;
