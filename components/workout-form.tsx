"use client";

import { useMemo, useState } from "react";
import type { ExerciseDetails } from "@/src/db/queries/exercises";
import Exercise, { ExerciseEntry } from "@/components/exercise";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Input } from "./ui/input";

export type WorkoutDraft = {
  workoutId?: string;
  workoutName?: string;
  workoutNotes?: string;
  exercises?: Array<{
    exerciseId: string;
    performedAsName: string;
    exerciseNotes?: string;
    sets: Array<{
      setNumber: number;
      load?: number;
      reps?: number;
      rir?: number;
    }>;
  }>;
};

function toNum(v: string) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export default function WorkoutForm({
  exercises,
  initialWorkout,
}: {
  exercises: ExerciseDetails[];
  initialWorkout?: {
    id: string;
    workoutName: string;
    workoutNotes: string;
    exercises: Array<{
      exerciseId: string;
      performedAsName: string;
      notes: string;
      sets: Array<{ load: string; reps: string; rir: string }>;
    }>;
  };
}) {
  const initialEntries = useMemo(() => {
    if (!initialWorkout) {
      const obj: Record<string, ExerciseEntry> = {};
      for (const ex of exercises) {
        obj[ex.id] = {
          performedAsName: ex.name,
          notes: "", // <--- new
          sets: ex.targetRirBySet.map((rir) => ({
            load: "",
            reps: "",
            rir: String(rir),
          })),
        };
      }
      return obj;
    }

    const map: Record<string, ExerciseEntry> = {};
    for (const ex of initialWorkout.exercises) {
      map[ex.exerciseId] = {
        performedAsName: ex.performedAsName,
        notes: ex.notes,
        sets: ex.sets.length ? ex.sets : [{ load: "", reps: "", rir: "" }],
      };
    }
    return map;
  }, [initialWorkout, exercises]);

  const [entries, setEntries] =
    useState<Record<string, ExerciseEntry>>(initialEntries);
  const [workoutId] = useState(initialWorkout?.id);
  const [workoutName, setWorkoutName] = useState(
    initialWorkout?.workoutName ?? ""
  );
  const [notes, setNotes] = useState(initialWorkout?.workoutNotes ?? "");

  async function saveWorkout() {
    const payload: WorkoutDraft = {
      workoutName: workoutName.trim() || undefined,
      workoutNotes: notes.trim() || undefined,
      exercises: exercises
        .map((ex) => {
          const entry = entries[ex.id];
          return {
            exerciseId: ex.id,
            performedAsName: entry.performedAsName,
            exerciseNotes: entry.notes.trim() || undefined, // ✅ add this
            sets: entry.sets
              .map((s, i) => ({
                setNumber: i + 1,
                load: s.load === "" ? undefined : toNum(s.load),
                reps: s.reps === "" ? undefined : toNum(s.reps),
                rir: s.rir === "" ? undefined : toNum(s.rir),
              }))
              .filter((s) => s.load != null || s.reps != null || s.rir != null),
          };
        })
        .filter((e) => e.sets.length > 0 || e.exerciseNotes), // ✅ keep exercise if notes exist
    };

    const url = workoutId ? `/api/workouts/${workoutId}` : "/api/workouts";

    const method = workoutId ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || "Failed to save workout");
    }

    // optional: clear state or show a toast
  }

  return (
    <div className="flex flex-col w-full max-w-md gap-6 p-4">
      {/* Global notes for the whole workout */}
      <Card className="bg-[#161616]">
        <CardContent className="flex flex-col gap-6">
          <div className="relative">
            <Label className="absolute bg-[#161616] -top-2 left-1.5 px-1.75">
              Workout Name
            </Label>
            <Input
              className="text-center"
              placeholder="Name your workout"
              value={workoutName}
              onChange={(e) => setWorkoutName(e.target.value)}
            />
          </div>
          <div className="relative">
            <Label className="absolute bg-[#161616] -top-2 left-1.5 px-1.75">
              Workout Notes
            </Label>
            <Textarea
              placeholder="How did the session feel?"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {exercises.map((exercise) => (
        <Exercise
          key={exercise.id}
          exercise={exercise}
          value={entries[exercise.id]}
          onChange={(next) =>
            setEntries((prev) => ({ ...prev, [exercise.id]: next }))
          }
        />
      ))}
      <Button
        className="flex-1 bg-[#161616]"
        variant="outline"
        onClick={() => void saveWorkout()}
      >
        Save Workout
      </Button>
    </div>
  );
}
