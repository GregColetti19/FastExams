import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Upload per-file progress as a 5-segment stepped track that fills as it advances
 * (the "building" beat). Active step = coral, done = teal, final done = gold.
 * Stages, in order: processing → ready → generating → done (4 stages, 5 segments = edges).
 */
export const UPLOAD_STAGES = ["processing", "ready", "generating", "done"] as const;
export type UploadStage = (typeof UPLOAD_STAGES)[number];

const SEGMENTS = 5;

export function StepTrack({ stage }: { stage: UploadStage }) {
  const stageIdx = UPLOAD_STAGES.indexOf(stage);
  // map 0..3 stages onto 0..5 filled segments
  const filled = Math.round(((stageIdx + 1) / UPLOAD_STAGES.length) * SEGMENTS);
  const done = stage === "done";

  return (
    <div className="flex gap-1" role="progressbar" aria-valuenow={filled} aria-valuemax={SEGMENTS}>
      {Array.from({ length: SEGMENTS }).map((_, i) => {
        const isFilled = i < filled;
        const isActiveEdge = i === filled - 1 && !done;
        return (
          <span
            key={i}
            className={cn(
              "h-1.5 flex-1 rounded-pill motion-safe:transition-colors motion-safe:duration-tempo",
              !isFilled && "bg-surface-inset",
              isFilled && done && "bg-gold",
              isFilled && !done && isActiveEdge && "bg-coral",
              isFilled && !done && !isActiveEdge && "bg-teal-400"
            )}
          />
        );
      })}
    </div>
  );
}

/** Status label for the active stage — coral while working, teal/gold when done. */
export function StageLabel({ stage }: { stage: UploadStage }) {
  const label: Record<UploadStage, string> = {
    processing: "processing…",
    ready: "ready",
    generating: "generating questions…",
    done: "done",
  };
  const color = stage === "done" ? "text-teal-200" : stage === "ready" ? "text-teal-300" : "text-coral-soft";
  return <span className={cn("text-xs", color)}>{label[stage]}</span>;
}
