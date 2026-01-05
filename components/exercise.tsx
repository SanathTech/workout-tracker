"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MinusIcon, PlusIcon } from "lucide-react";
import { Card, CardContent } from "./ui/card";
import { ExerciseDetails, Range } from "@/src/db/queries/exercises";

export type ExerciseEntry = {
  performedAsName: string;
  notes: string;
  sets: Array<{ load: string; reps: string; rir: string }>;
};

type ExerciseProps = {
  exercise: ExerciseDetails;
  value: ExerciseEntry;
  onChange: (next: ExerciseEntry) => void;
};

export default function Exercise({ exercise, value, onChange }: ExerciseProps) {
  const formatRange = (r: Range) => `${r.min} - ${r.max}`;
  const formatRest = (r: Range) =>
    `${Math.round(r.min / 60)} - ${Math.round(r.max / 60)} mins`;

  const badges = [
    { label: "Warmup Sets", value: formatRange(exercise.warmupSets) },
    { label: "Rep Range", value: formatRange(exercise.repRange) },
    { label: "Rest", value: formatRest(exercise.restSeconds) },
  ];

  const targetRir = exercise.targetRirBySet;

  return (
    <Card className="bg-[#161616]">
      <CardContent className="flex flex-col gap-6">
        {/* Selector */}
        <div className="w-full">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="bg-[#161616] w-full">
                {value.performedAsName}
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent className="w-[calc(100vw-82px)] bg-[#161616]">
              <DropdownMenuItem
                onClick={() =>
                  onChange({ ...value, performedAsName: exercise.name })
                }
              >
                {exercise.name}
              </DropdownMenuItem>

              {exercise.substitutions.map((substitution, index) => (
                <DropdownMenuItem
                  key={index}
                  onClick={() =>
                    onChange({ ...value, performedAsName: substitution })
                  }
                >
                  {substitution}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Details */}
        <div className="flex gap-2 -mt-1">
          {badges.map((badge, index) => (
            <Badge key={index} variant="outline">
              {badge.label}: {badge.value}
            </Badge>
          ))}
        </div>

        {/* Tracker */}
        <div className="flex flex-col gap-6">
          {value.sets.map((set, index) => (
            <div className="flex gap-6" key={index}>
              <div className="relative w-full">
                <Label className="absolute bg-[#161616] -top-2 left-1.5 px-1.75">
                  Load
                </Label>
                <Input
                  className="text-center"
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min={0}
                  placeholder="25"
                  value={set.load}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      sets: value.sets.map((item, i) =>
                        i === index ? { ...item, load: e.target.value } : item
                      ),
                    })
                  }
                  id={`load-${exercise.id}-${index}`}
                />
              </div>

              <div className="relative w-full">
                <Label className="absolute bg-[#161616] -top-2 left-1.5 px-1.75">
                  Reps
                </Label>
                <Input
                  className="text-center"
                  type="number"
                  inputMode="numeric"
                  step="1"
                  min={0}
                  placeholder="6"
                  value={set.reps}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      sets: value.sets.map((item, i) =>
                        i === index ? { ...item, reps: e.target.value } : item
                      ),
                    })
                  }
                  id={`reps-${exercise.id}-${index}`}
                />
              </div>

              <div className="relative w-full">
                <Label className="absolute bg-[#161616] -top-2 left-1.5 px-1.75">
                  RIR
                </Label>
                <Input
                  className="text-center"
                  type="number"
                  inputMode="numeric"
                  step="1"
                  min={0}
                  max={5}
                  placeholder={(targetRir[index] ?? 0).toString()}
                  value={set.rir}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      sets: value.sets.map((item, i) =>
                        i === index ? { ...item, rir: e.target.value } : item
                      ),
                    })
                  }
                  id={`rir-${exercise.id}-${index}`}
                />
              </div>
            </div>
          ))}

          <div className="flex gap-6 max-w-full">
            <Button
              className="flex-1 bg-[#161616]"
              variant="outline"
              onClick={() =>
                onChange({
                  ...value,
                  sets: [
                    ...value.sets,
                    {
                      load: "",
                      reps: "",
                      rir: "", // empty so placeholder shows
                    },
                  ],
                })
              }
            >
              <PlusIcon className="h-4 w-4" /> Add Set
            </Button>

            <Button
              className="flex-1 bg-[#161616]"
              variant="outline"
              onClick={() =>
                onChange({
                  ...value,
                  sets:
                    value.sets.length > 1
                      ? value.sets.slice(0, -1)
                      : value.sets,
                })
              }
            >
              <MinusIcon className="h-4 w-4" /> Remove Set
            </Button>
          </div>
        </div>

        {/* Notes */}
        <div className="relative">
          <Label className="absolute bg-[#161616] -top-2 left-1.5 px-1.75">
            Notes
          </Label>
          <Textarea
            id={`notes-${exercise.id}`}
            placeholder="Type your notes here."
            value={value.notes}
            onChange={(e) => onChange({ ...value, notes: e.target.value })}
          />
        </div>
      </CardContent>
    </Card>
  );
}
