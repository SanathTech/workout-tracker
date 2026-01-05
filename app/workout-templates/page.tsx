"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEffect, useState } from "react";

function WorkoutTemplates() {
  const [workoutName, setWorkoutName] = useState("");
  const [exerciseIds, setExerciseIds] = useState<string[]>([]);
  const [templates, setTemplates] = useState<
    Array<{ id: string; templateName: string; exerciseIds: string[] }>
  >([]);

  useEffect(() => {
    const url = "/api/workout-templates";
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        console.log("Fetched workout templates:", data);
        setTemplates(data.templates);
      })
      .catch((err) => {
        console.error("Error fetching workout templates:", err);
      });
  }, []);

  const handleClick = async () => {
    const payload = {
      workoutName: workoutName,
      exerciseIds,
    };

    const url = "/api/workout-templates";

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

    setWorkoutName("");
    setExerciseIds([]);

    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        console.log("Fetched workout templates:", data);
        setTemplates(data.templates);
      })
      .catch((err) => {
        console.error("Error fetching workout templates:", err);
      });
  };

  return (
    <div className="p-4">
      <Card>
        <CardTitle className="ml-4">Workout Templates</CardTitle>
        <CardContent>
          <div className="flex flex-col gap-6">
            <div className="relative w-full">
              <Label className="absolute bg-[#161616] -top-2 left-1.5 px-1.75">
                Name
              </Label>
              <Input
                placeholder="Enter template name"
                value={workoutName}
                onChange={(e) => setWorkoutName(e.target.value)}
              />
            </div>
            <div className="relative w-full">
              <Label className="absolute bg-[#161616] -top-2 left-1.5 px-1.75">
                Exercise Ids
              </Label>
              <Input
                placeholder="Add exercise ids to the template"
                value={exerciseIds}
                onChange={(e) =>
                  setExerciseIds(e.target.value.replaceAll(" ", "").split(","))
                }
              />
            </div>
            <Button onClick={handleClick}>Create Template</Button>
          </div>
        </CardContent>
      </Card>
      <div className="mt-6">
        <h2 className="text-2xl mb-4">Existing Templates</h2>
        {templates.length === 0 && <p>No templates available.</p>}
        {templates.map((template) => (
          <Card
            key={template.id}
            className="mb-4"
            onClick={() => {
              setWorkoutName(template.templateName);
              setExerciseIds(template.exerciseIds);
            }}
          >
            <CardContent>
              <h3 className="text-xl font-semibold">{template.templateName}</h3>
              <p className="text-sm text-gray-400">
                Exercise IDs: {template.exerciseIds.join(", ")}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default WorkoutTemplates;
