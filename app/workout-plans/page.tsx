"use client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import React from "react";

function WorkoutPlans() {
  const [workoutPlans, setWorkoutPlans] = React.useState<
    { id: string; name: string; weeks: number; daysPerWeek: number }[]
  >([]);
  const [name, setName] = React.useState("");
  const [weeks, setWeeks] = React.useState(0);
  const [daysPerWeek, setDaysPerWeek] = React.useState(0);

  return (
    <div className="flex flex-col gap-4 p-4">
      <Card>
        <CardTitle className="ml-4">Workout Plans</CardTitle>
        <CardContent>
          {workoutPlans.length === 0 && <p>No workout plans created yet.</p>}
          {workoutPlans.length > 0 && (
            <ul className="flex flex-col gap-4">
              {workoutPlans.map((plan) => (
                <li key={plan.id} className="flex justify-between">
                  <div>{plan.name}</div>
                  <Button>Edit</Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardTitle className="ml-4">Create New Workout Plan</CardTitle>
        <CardContent>
          <div className="flex flex-col gap-4">
            <div>Workout Plan Name</div>
            <Input
              placeholder="Enter workout plan name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div>How many weeks?</div>
            <Input
              placeholder="Enter number of weeks"
              value={weeks}
              onChange={(e) => setWeeks(parseInt(e.target.value))}
            />
            <div>How many days per week?</div>
            <Input
              placeholder="Enter number of days per week"
              value={daysPerWeek}
              onChange={(e) => setDaysPerWeek(parseInt(e.target.value))}
            />
            <Button
              onClick={() => {
                setWorkoutPlans([
                  ...workoutPlans,
                  { id: Math.random().toString(), name, weeks, daysPerWeek },
                ]);
                setName("");
                setWeeks(0);
                setDaysPerWeek(0);
              }}
            >
              Create Workout Plan
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default WorkoutPlans;
