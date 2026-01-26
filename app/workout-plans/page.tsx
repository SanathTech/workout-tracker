"use client";
import Navbar from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "next/navigation";
import React, { useEffect } from "react";

function WorkoutPlans() {
  const router = useRouter();
  const [workoutPlans, setWorkoutPlans] = React.useState<
    | {
        id: string;
        userId: string;
        createdAt: Date;
        name: string;
        weeks: number;
        daysPerWeek: number;
        workouts: string[];
      }[]
    | null
  >(null);
  const [name, setName] = React.useState("");
  const [weeks, setWeeks] = React.useState(0);
  const [daysPerWeek, setDaysPerWeek] = React.useState(0);
  const [inputValues, setInputValues] = React.useState({
    name: "",
    weeks: "",
    daysPerWeek: "",
  });

  useEffect(() => {
    const workoutPlansUrl = "/api/workout-plans";
    fetch(workoutPlansUrl)
      .then((res) => res.json())
      .then((data) => {
        console.log("Fetched workout plans:", data);
        setWorkoutPlans(data.plans);
      })
      .catch((err) => {
        console.error("Error fetching workout plans:", err);
      });
  }, []);

  const handleClick = async () => {
    const payload = {
      workoutPlanId: undefined,
      workoutPlanName: name,
      weeks,
      daysPerWeek,
      workouts: [],
    };

    const url = "/api/workout-plans";

    const method = "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || "Failed to save workout plan");
    }

    setName("");
    setWeeks(0);
    setDaysPerWeek(0);

    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        console.log("Fetched workout plans:", data);
        setWorkoutPlans(data.plans);
      })
      .catch((err) => {
        console.error("Error fetching workout plans:", err);
      });
  };

  if (!workoutPlans) {
    return <div>Loading...</div>;
  }

  return (
    <>
      <Navbar />
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
                    <Button
                      onClick={() => {
                        router.push(`/workout-plans/${plan.id}`);
                      }}
                    >
                      Start
                    </Button>
                    <Button
                      onClick={() => {
                        router.push(`/workout-plans/${plan.id}/edit`);
                      }}
                    >
                      Edit
                    </Button>
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
              <div className="relative w-full">
                <Label className="absolute bg-[#161616] -top-2 left-1.5 px-1.75">
                  Workout Plan Name
                </Label>
                <Input
                  placeholder="Enter workout plan name"
                  value={inputValues.name}
                  onChange={(e) => {
                    const value = e.target.value;
                    setInputValues((prev) => ({
                      ...prev,
                      name: value,
                    }));
                    setName(value);
                  }}
                />
              </div>
              <div className="relative w-full">
                <Label className="absolute bg-[#161616] -top-2 left-1.5 px-1.75">
                  How many weeks?
                </Label>
                <Input
                  placeholder="Enter number of weeks"
                  value={inputValues.weeks}
                  onChange={(e) => {
                    const value = e.target.value;
                    // Allow only digits
                    if (!/^[0-9]*$/.test(value)) {
                      return;
                    }

                    setInputValues((prev) => ({
                      ...prev,
                      weeks: value,
                    }));
                    setWeeks(parseInt(value) || 0);
                  }}
                />
              </div>
              <div className="relative w-full">
                <Label className="absolute bg-[#161616] -top-2 left-1.5 px-1.75">
                  How many days per week?
                </Label>
                <Input
                  placeholder="Enter number of days per week"
                  value={inputValues.daysPerWeek}
                  onChange={(e) => {
                    const value = e.target.value;
                    // Allow only digits
                    if (!/^[0-9]*$/.test(value)) {
                      return;
                    }

                    setInputValues((prev) => ({
                      ...prev,
                      daysPerWeek: value,
                    }));
                    setDaysPerWeek(parseInt(value) || 0);
                  }}
                />
              </div>
              <Button onClick={handleClick}>Create Workout Plan</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export default WorkoutPlans;
