"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverAnchor,
} from "@/components/ui/popover";
import Navbar from "@/components/navbar";

export type Exercise = {
  id: string;
  name: string;
  substitutions: string[];
  warmupSets: { min: number; max: number };
  repRange: { min: number; max: number };
  restSeconds: { min: number; max: number };
  targetRirBySet: number[];
};

function WorkoutTemplates() {
  const [workoutName, setWorkoutName] = useState("");
  const [templates, setTemplates] = useState<
    Array<{ id: string; templateName: string; exerciseIds: string[] }>
  >([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Exercise[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectedIds = useMemo(
    () => new Set(selected.map((x) => x.id)),
    [selected],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return exercises;

    // simple contains match; tweak as needed
    const matches = exercises.filter((e) => e.name.toLowerCase().includes(q));
    return matches;
  }, [exercises, query]);

  const available = useMemo(() => {
    return filtered.filter((ex) => !selectedIds.has(ex.id));
  }, [filtered, selectedIds]);

  function addExercise(ex: Exercise) {
    if (selectedIds.has(ex.id)) return;
    setSelected([...selected, ex]);
    setQuery("");
    // keep open so user can keep adding quickly
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function removeExercise(id: string) {
    setSelected(selected.filter((x) => x.id !== id));
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function clearAll() {
    setSelected([]);
    setQuery("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  const popoverOpen = open && filtered.length > 0;

  useEffect(() => {
    setHighlightedIndex(0);
  }, [query, selected.length]);

  useEffect(() => {
    if (!popoverOpen) return;

    const el = optionRefs.current[highlightedIndex];
    if (!el) return;

    el.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, popoverOpen, available.length]);

  useEffect(() => {
    const workoutTemplatesUrl = "/api/workout-templates";
    fetch(workoutTemplatesUrl)
      .then((res) => res.json())
      .then((data) => {
        console.log("Fetched workout templates:", data);
        setTemplates(data.templates);
      })
      .catch((err) => {
        console.error("Error fetching workout templates:", err);
      });

    const exercisesUrl = "/api/exercises";
    fetch(exercisesUrl)
      .then((res) => res.json())
      .then((data) => {
        console.log("Fetched exercises:", data);
        setExercises(data.exercises);
      })
      .catch((err) => {
        console.error("Error fetching exercise exercises:", err);
      });
  }, []);

  const handleClick = async () => {
    const payload = {
      workoutName: workoutName,
      exerciseIds: selected.map((ex) => ex.id),
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
    setSelected([]);

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
    <>
      <Navbar />
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
                  placeholder="Upper 1"
                  value={workoutName}
                  onChange={(e) => setWorkoutName(e.target.value)}
                />
              </div>
              <div className="w-full space-y-2">
                {/* Selected badges */}
                {selected.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {selected.map((ex) => (
                      <Badge
                        key={ex.id}
                        variant="secondary"
                        className="gap-1 pr-1"
                      >
                        <span>{ex.name}</span>
                        <button
                          type="button"
                          onClick={() => removeExercise(ex.id)}
                          className="rounded-sm p-1 hover:bg-muted"
                          aria-label={`Remove ${ex.name}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={clearAll}
                      className="h-7"
                    >
                      Clear
                    </Button>
                  </div>
                )}

                {/* Input + Popover */}
                <Popover open={popoverOpen} onOpenChange={setOpen}>
                  <PopoverAnchor asChild>
                    <div className="relative">
                      <Input
                        id="exercises-input"
                        ref={inputRef}
                        value={query}
                        placeholder={"Search exercises..."}
                        onChange={(e) => {
                          setQuery(e.target.value);
                          setOpen(true);
                        }}
                        onFocus={() => setOpen(true)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setOpen(false);
                            return;
                          }

                          if (e.key === "Enter") {
                            const highlighted = available[highlightedIndex];
                            if (highlighted) {
                              e.preventDefault();
                              addExercise(highlighted);
                            }
                            return;
                          }

                          // Backspace to remove last chip when query empty
                          if (
                            e.key === "Backspace" &&
                            query.length === 0 &&
                            selected.length > 0
                          ) {
                            removeExercise(selected[selected.length - 1].id);
                          }

                          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                            e.preventDefault();
                            setHighlightedIndex((prev) => {
                              const maxIndex = available.length - 1;
                              if (maxIndex < 0) return 0;
                              if (e.key === "ArrowDown")
                                return prev >= maxIndex ? 0 : prev + 1;
                              return prev <= 0 ? maxIndex : prev - 1;
                            });
                          }
                        }}
                      />

                      {/* Optional hint */}
                      <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        {open ? "Esc" : ""}
                      </div>
                    </div>
                  </PopoverAnchor>

                  <PopoverContent
                    align="start"
                    className="w-(--radix-popover-trigger-width) p-1"
                    sideOffset={6}
                    onOpenAutoFocus={(e) => e.preventDefault()}
                    onInteractOutside={(e) => {
                      // If you click the input again, don't treat it as "outside" and don't close.
                      const target = e.target as HTMLElement | null;
                      if (target && target.id === "exercises-input") {
                        e.preventDefault();
                      }
                    }}
                  >
                    <div ref={listRef} className="max-h-64 overflow-auto">
                      {available.map((ex, idx) => (
                        <button
                          key={ex.id}
                          ref={(node) => {
                            optionRefs.current[idx] = node;
                          }}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => addExercise(ex)}
                          className={[
                            "w-full rounded-sm px-2 py-1.5 text-left text-sm",
                            "hover:bg-muted focus:outline-none focus:ring-1 focus:ring-ring",
                            highlightedIndex === idx
                              ? "bg-accent text-accent-foreground"
                              : "",
                          ].join(" ")}
                        >
                          <div className="flex flex-col gap-1">
                            <span>{ex.name}</span>
                            <div className="flex gap-2 text-xs text-muted-foreground">
                              <span>
                                {ex.repRange.min}-{ex.repRange.max} reps
                              </span>
                              <span>
                                {ex.restSeconds.min}-{ex.restSeconds.max}s rest
                              </span>
                              <span>
                                {ex.warmupSets.min}-{ex.warmupSets.max} warmup
                                sets
                              </span>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
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
              className="mb-4 cursor-pointer"
              onClick={() => {
                setWorkoutName(template.templateName);
                setSelected(
                  template.exerciseIds
                    .map((id) => exercises.find((ex) => ex.id === id))
                    .filter((ex): ex is Exercise => !!ex),
                );
              }}
            >
              <CardContent>
                <h3 className="text-xl font-semibold">
                  {template.templateName}
                </h3>
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
    </>
  );
}

export default WorkoutTemplates;
