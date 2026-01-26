"use client";

import Navbar from "@/components/navbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEffect, useState } from "react";

interface InputValues {
  id: string;
  name: string;
  repRange: { min: string; max: string };
  restSeconds: { min: string; max: string };
  warmupSets: { min: string; max: string };
  substitutions: string;
  targetRirBySet: string;
}

function Exercises() {
  const [exerciseId, setExerciseId] = useState("");
  const [exerciseName, setExerciseName] = useState("");
  const [substitutions, setSubstitutions] = useState<string[]>([]);
  const [warmupSets, setWarmupSets] = useState<Record<string, number>>({});
  const [repRange, setRepRange] = useState<Record<string, number>>({});
  const [restSeconds, setRestSeconds] = useState<Record<string, number>>({});
  const [targetRirBySet, setTargetRirBySet] = useState<number[]>([]);

  const initialInputValues = {
    id: "",
    name: "",
    repRange: { min: "", max: "" },
    restSeconds: { min: "", max: "" },
    warmupSets: { min: "", max: "" },
    substitutions: "",
    targetRirBySet: "",
  };
  const [inputValues, setInputValues] =
    useState<InputValues>(initialInputValues);

  const [exercises, setExercises] = useState<
    Array<{
      id: string;
      name: string;
      repRange: { min: number; max: number };
      restSeconds: { min: number; max: number };
      warmupSets: { min: number; max: number };
      substitutions: string[];
      targetRirBySet: number[];
    }>
  >([]);

  useEffect(() => {
    const url = "/api/exercises";
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        console.log("Fetched exercises:", data);
        setExercises(data.exercises);
      })
      .catch((err) => {
        console.error("Error fetching exercise exercises:", err);
      });
  }, []);

  const handleClick = async (id?: string) => {
    const payload = {
      exerciseId: id,
      exerciseName,
      substitutions,
      warmupSets: {
        min: warmupSets["min"] || 0,
        max: warmupSets["max"] || 0,
      },
      repRange: {
        min: repRange["min"] || 0,
        max: repRange["max"] || 0,
      },
      restSeconds: {
        min: restSeconds["min"] || 0,
        max: restSeconds["max"] || 0,
      },
      targetRirBySet,
    };

    const url = "/api/exercises";
    const method = "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || "Failed to save exercise");
    }
    setExerciseId("");
    setExerciseName("");
    setSubstitutions([]);
    setWarmupSets({});
    setRepRange({});
    setRestSeconds({});
    setTargetRirBySet([]);
    setInputValues(initialInputValues);

    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        console.log("Fetched exercises:", data);
        setExercises(data.exercises);
      })
      .catch((err) => {
        console.error("Error fetching exercise exercises:", err);
      });
  };

  return (
    <>
      <Navbar />
      <div className="p-4">
        <Card>
          <CardTitle className="ml-4">Exercises</CardTitle>
          <CardContent>
            <div className="flex flex-col gap-6">
              <div className="relative w-full">
                <Label className="absolute bg-[#161616] -top-2 left-1.5 px-1.75">
                  Name
                </Label>
                <Input
                  placeholder="Barbell Incline Press"
                  value={inputValues.name}
                  onChange={(e) => {
                    setInputValues((prev) => ({
                      ...prev,
                      name: e.target.value,
                    }));
                    setExerciseName(e.target.value.trim());
                  }}
                />
              </div>
              <div className="relative w-full">
                <Label className="absolute bg-[#161616] -top-2 left-1.5 px-1.75">
                  Substitutions
                </Label>
                <Input
                  placeholder="Smith Machine Incline Press, DB Incline Press"
                  value={inputValues.substitutions}
                  onChange={(e) => {
                    setInputValues((prev) => ({
                      ...prev,
                      substitutions: e.target.value,
                    }));
                    setSubstitutions(
                      e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    );
                  }}
                />
              </div>
              <div className="flex gap-4">
                <div className="relative w-full">
                  <Label className="absolute bg-[#161616] -top-2 left-1.5 px-1.75">
                    Min Warmup Sets
                  </Label>
                  <Input
                    placeholder="2"
                    value={inputValues.warmupSets.min}
                    onChange={(e) => {
                      const value = e.target.value;
                      // Allow only digits
                      if (!/^[0-9]*$/.test(value)) {
                        return;
                      }

                      setInputValues((prev) => ({
                        ...prev,
                        warmupSets: {
                          ...prev.warmupSets,
                          min: value,
                        },
                      }));
                      setWarmupSets({
                        ...warmupSets,
                        min: parseInt(value) || 0,
                      });
                    }}
                  />
                </div>
                <div className="relative w-full">
                  <Label className="absolute bg-[#161616] -top-2 left-1.5 px-1.75">
                    Max Warmup Sets
                  </Label>
                  <Input
                    placeholder="4"
                    value={inputValues.warmupSets.max}
                    onChange={(e) => {
                      const value = e.target.value;
                      // Allow only digits
                      if (!/^[0-9]*$/.test(value)) {
                        return;
                      }
                      setInputValues((prev) => ({
                        ...prev,
                        warmupSets: {
                          ...prev.warmupSets,
                          max: value,
                        },
                      }));
                      setWarmupSets({
                        ...warmupSets,
                        max: parseInt(value) || 0,
                      });
                    }}
                  />
                </div>
              </div>
              <div className="flex gap-4">
                <div className="relative w-full">
                  <Label className="absolute bg-[#161616] -top-2 left-1.5 px-1.75">
                    Min Rep Range
                  </Label>
                  <Input
                    placeholder="6"
                    value={inputValues.repRange.min}
                    onChange={(e) => {
                      const value = e.target.value;
                      // Allow only digits
                      if (!/^[0-9]*$/.test(value)) {
                        return;
                      }
                      setInputValues((prev) => ({
                        ...prev,
                        repRange: {
                          ...prev.repRange,
                          min: value,
                        },
                      }));
                      setRepRange({
                        ...repRange,
                        min: parseInt(value) || 0,
                      });
                    }}
                  />
                </div>
                <div className="relative w-full">
                  <Label className="absolute bg-[#161616] -top-2 left-1.5 px-1.75">
                    Max Rep Range
                  </Label>
                  <Input
                    placeholder="8"
                    value={inputValues.repRange.max}
                    onChange={(e) => {
                      const value = e.target.value;
                      // Allow only digits
                      if (!/^[0-9]*$/.test(value)) {
                        return;
                      }
                      setInputValues((prev) => ({
                        ...prev,
                        repRange: {
                          ...prev.repRange,
                          max: value,
                        },
                      }));
                      setRepRange({
                        ...repRange,
                        max: parseInt(value) || 0,
                      });
                    }}
                  />
                </div>
              </div>
              <div className="flex gap-4">
                <div className="relative w-full">
                  <Label className="absolute bg-[#161616] -top-2 left-1.5 px-1.75">
                    Min Rest Seconds
                  </Label>
                  <Input
                    placeholder="180"
                    value={inputValues.restSeconds.min}
                    onChange={(e) => {
                      const value = e.target.value;
                      // Allow only digits
                      if (!/^[0-9]*$/.test(value)) {
                        return;
                      }
                      setInputValues((prev) => ({
                        ...prev,
                        restSeconds: {
                          ...prev.restSeconds,
                          min: value,
                        },
                      }));
                      setRestSeconds({
                        ...restSeconds,
                        min: parseInt(value) || 0,
                      });
                    }}
                  />
                </div>
                <div className="relative w-full">
                  <Label className="absolute bg-[#161616] -top-2 left-1.5 px-1.75">
                    Max Rest Seconds
                  </Label>
                  <Input
                    placeholder="300"
                    value={inputValues.restSeconds.max}
                    onChange={(e) => {
                      const value = e.target.value;
                      // Allow only digits
                      if (!/^[0-9]*$/.test(value)) {
                        return;
                      }
                      setInputValues((prev) => ({
                        ...prev,
                        restSeconds: {
                          ...prev.restSeconds,
                          max: value,
                        },
                      }));
                      setRestSeconds({
                        ...restSeconds,
                        max: parseInt(value) || 0,
                      });
                    }}
                  />
                </div>
              </div>
              <div className="relative w-full">
                <Label className="absolute bg-[#161616] -top-2 left-1.5 px-1.75">
                  Target RIR By Set
                </Label>
                <Input
                  placeholder="1, 0"
                  value={inputValues.targetRirBySet}
                  onChange={(e) => {
                    const value = e.target.value;
                    // Allow only digits, commas, and spaces
                    if (!/^[0-9,\s]*$/.test(value)) {
                      return;
                    }
                    setInputValues((prev) => ({
                      ...prev,
                      targetRirBySet: value,
                    }));
                    const parsed = value
                      .split(",")
                      .map((s) => s.trim())
                      .filter((v) => v !== "")
                      .map(Number);
                    setTargetRirBySet(parsed);
                  }}
                />
              </div>
              {exerciseId && (
                <Button onClick={() => handleClick(exerciseId)}>
                  Update Exercise
                </Button>
              )}
              <Button onClick={() => handleClick()}>Create Exercise</Button>
            </div>
          </CardContent>
        </Card>
        <div className="mt-6">
          <h2 className="text-2xl mb-4">Existing Exercises</h2>
          {exercises.length === 0 && <p>No exercises available.</p>}
          {exercises.length > 0 &&
            exercises.map((exercise) => (
              <Card
                key={exercise.id}
                className="mb-4"
                onClick={() => {
                  setExerciseId(exercise.id);
                  setExerciseName(exercise.name);
                  setSubstitutions(exercise.substitutions);
                  setWarmupSets(exercise.warmupSets);
                  setRepRange(exercise.repRange);
                  setRestSeconds(exercise.restSeconds);
                  setTargetRirBySet(exercise.targetRirBySet);
                  setInputValues({
                    id: exercise.id,
                    name: exercise.name,
                    repRange: {
                      min: exercise.repRange.min.toString(),
                      max: exercise.repRange.max.toString(),
                    },
                    restSeconds: {
                      min: exercise.restSeconds.min.toString(),
                      max: exercise.restSeconds.max.toString(),
                    },
                    warmupSets: {
                      min: exercise.warmupSets.min.toString(),
                      max: exercise.warmupSets.max.toString(),
                    },
                    substitutions: exercise.substitutions.join(", "),
                    targetRirBySet: exercise.targetRirBySet.join(", "),
                  });
                }}
              >
                <CardContent className="flex flex-col gap-4">
                  <h3 className="text-xl font-semibold">{exercise.name}</h3>
                  <div className="flex gap-2 -mt-1">
                    <Badge
                      key={exercise.id + "-warmup-sets-badge"}
                      variant="outline"
                    >
                      Warmup Sets: {exercise.warmupSets.min} -{" "}
                      {exercise.warmupSets.max}
                    </Badge>
                    <Badge
                      key={exercise.id + "-rep-range-badge"}
                      variant="outline"
                    >
                      Rep Range: {exercise.repRange.min} -{" "}
                      {exercise.repRange.max}
                    </Badge>
                    <Badge key={exercise.id + "-rest-badge"} variant="outline">
                      Rest: {Math.round(exercise.restSeconds.min / 60)} -{" "}
                      {Math.round(exercise.restSeconds.max / 60)} mins
                    </Badge>
                  </div>
                  <div className="flex flex-col text-sm">
                    <div className="font-semibold">Substitutions:</div>
                    <div>{exercise.substitutions.join(", ")}</div>
                  </div>
                  <div className="flex flex-col text-sm">
                    <div className="font-semibold">Target RIR By Set:</div>
                    <div>{exercise.targetRirBySet.join(", ")}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
        </div>
      </div>
    </>
  );
}

export default Exercises;
