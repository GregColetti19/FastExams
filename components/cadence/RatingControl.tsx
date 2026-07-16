"use client";
import * as React from "react";
import { Button } from "./Button";
import { binaryGrade, type Grade } from "@/lib/fsrs";

/**
 * Flashcard rating control (§8.5). Default = binary: "Again" / "Got it".
 * Emits an FSRS Grade so FlashcardRuntime consumes it without knowing the scale.
 * Swap this component (e.g. a 1–5 confidence scale) without touching the runtime —
 * as long as the replacement calls onGrade(grade).
 */
export function RatingControl({ onGrade }: { onGrade: (g: Grade) => void }) {
  return (
    <div className="flex gap-3">
      <Button
        variant="ghost"
        size="lg"
        className="flex-1 border-coral/50 text-coral-soft hover:border-coral"
        onClick={() => onGrade(binaryGrade(false))}
      >
        Again
      </Button>
      <Button variant="confirm" size="lg" className="flex-1" onClick={() => onGrade(binaryGrade(true))}>
        Got it
      </Button>
    </div>
  );
}
