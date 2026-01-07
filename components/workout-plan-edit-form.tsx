import React from "react";
import { Card, CardContent, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Button } from "./ui/button";

function WorkoutPlanEditForm() {
  const days = 5;
  const [currentDay, setCurrentDay] = React.useState(1);
  return (
    <div className="flex flex-col gap-4 p-4">
      <Card>
        <CardTitle className="ml-4">Day {currentDay}</CardTitle>
        <CardContent className="flex flex-col gap-4">
          <div>Workout Name</div>
          <Input placeholder="Enter workout name" />
          <div>Exercises</div>
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
    </div>
  );
}

export default WorkoutPlanEditForm;
