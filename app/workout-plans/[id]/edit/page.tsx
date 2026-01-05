"use client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import React from "react";

function EditWorkoutPlan() {
  const days = 5;
  const [currentDay, setCurrentDay] = React.useState(1);
  const [exercises, setExercises] = React.useState<string[]>([]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <Card>
        <CardTitle className="ml-4">Day {currentDay}</CardTitle>
        <CardContent className="flex flex-col gap-4">
          <div>Workout Name</div>
          <Input placeholder="Enter workout name" />
          <div>Exercises</div>
          {exercises.length === 0 && <p>No exercises added yet.</p>}
          {exercises.map((ex, idx) => (
            <div key={idx}>{ex}</div>
          ))}
          <div className="flex flex-col gap-4">
            <div>
              <Button
                onClick={() => setCurrentDay((prev) => Math.max(1, prev - 1))}
                disabled={currentDay === 1}
              >
                Previous Day
              </Button>
              <Button
                className="ml-2"
                onClick={() =>
                  setCurrentDay((prev) => Math.min(days, prev + 1))
                }
                disabled={currentDay === days}
              >
                Next Day
              </Button>
            </div>
            <Button>Create Workout Plan</Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardTitle className="ml-4">Add Exercise</CardTitle>
        <CardContent className="flex flex-col gap-4">
          <div className="flex gap-2">
            <div className="w-full">Exercise Name</div>
            <Input placeholder="Enter exercise name" />
          </div>
          <div className="flex gap-2">
            <div className="w-full">Warm-up Sets</div>
            <Input placeholder="e.g., 2-3 sets" />
          </div>
          <div className="flex gap-2">
            <div className="w-full">Working Sets</div>
            <Input placeholder="e.g., 3-5 sets" />
          </div>
          <div className="flex gap-2">
            <div className="w-full">Rep Range</div>
            <Input placeholder="e.g., 8-12 reps" />
          </div>
          <div className="flex gap-2">
            <div className="w-full">Rest Period</div>
            <Input placeholder="e.g., 60-90 seconds" />
          </div>
          <div className="flex gap-2">
            <div className="w-full">Reps in Reserve</div>
            <Input placeholder="e.g., 1-2 RIR" />
          </div>
          <div className="flex gap-2">
            <div className="w-full">Subsitutions</div>
            <Input placeholder="Enter substitution names separated by commas" />
          </div>
          <Button
            className="mt-4"
            onClick={() => setExercises((prev) => [...prev, "New Exercise"])}
          >
            Add Exercise
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default EditWorkoutPlan;
