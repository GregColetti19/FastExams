"use client";
import * as React from "react";
import { Button } from "./Button";
import { Rating, type Grade } from "@/lib/fsrs";

/**
 * Flashcard self-rating (§8.5). FSRS's own 4-grade scale — Again/Hard/Good/Easy —
 * used directly, no separate 1–5 layer: FSRS's stability/difficulty math is
 * tuned for exactly these 4 buckets, so mapping a finer scale down to them
 * would add a UI layer with no precision gain.
 */
export function RatingControl({ onGrade }: { onGrade: (g: Grade) => void }) {
  return (
    <div className="flex gap-2">
      <Button
        variant="ghost"
        size="lg"
        className="flex-1 border-coral/50 text-coral-soft hover:border-coral"
        onClick={() => onGrade(Rating.Again)}
      >
        Again
      </Button>
      <Button
        variant="ghost"
        size="lg"
        className="flex-1"
        onClick={() => onGrade(Rating.Hard)}
      >
        Hard
      </Button>
      <Button variant="confirm" size="lg" className="flex-1" onClick={() => onGrade(Rating.Good)}>
        Good
      </Button>
      <Button
        variant="confirm"
        size="lg"
        className="flex-1 bg-teal-600 hover:bg-teal-500"
        onClick={() => onGrade(Rating.Easy)}
      >
        Easy
      </Button>
    </div>
  );
}
