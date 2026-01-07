// import { Button } from "@/components/ui/button";
// import { Card, CardContent, CardTitle } from "@/components/ui/card";
// import { Input } from "@/components/ui/input";
// import WorkoutPlanEditForm from "@/components/workout-plan-edit-form";
// import React, { useEffect, useState } from "react";

// async function EditWorkoutPlan({
//   params,
// }: {
//   params: Promise<{ id: string }>;
// }) {
//   const { id } = await params;
//   l

//   useEffect(() => {
//     const url = "/api/workout-plans/" + id;
//     fetch(url)
//       .then((res) => res.json())
//       .then((data) => {
//         console.log("Fetched workout plan:", data);
//         setWorkoutPlan(data.plan);
//       })
//       .catch((err) => {
//         console.error("Error fetching exercise exercises:", err);
//       });
//   }, []);

//   if (!workoutPlan) {
//     return <div className="p-4">Workout not found</div>;
//   }

//   return <WorkoutPlanEditForm />;
// }

// export default EditWorkoutPlan;
