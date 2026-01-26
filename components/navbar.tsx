"use client";
import { Button } from "./ui/button";
import { HomeIcon } from "lucide-react";
import { useRouter } from "next/navigation";

function Navbar({ url }: { url?: string }) {
  const router = useRouter();
  return (
    <div className="grid grid-cols-3 w-full items-center gap-4 p-4 bg-card text-white">
      <div>
        <Button
          onClick={() => {
            url ? router.push(url) : router.back();
          }}
        >
          Back
        </Button>
      </div>
      <h1>Workout Tracker</h1>
      <div className="ml-auto">
        <Button
          onClick={() => {
            router.push("/");
          }}
        >
          <HomeIcon />
        </Button>
      </div>
    </div>
  );
}

export default Navbar;
