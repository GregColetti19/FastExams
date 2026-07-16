import * as React from "react";
import { IconFileText, IconSparkles } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

/**
 * Where a question came from. Never alarm coloring.
 * - pastExam: shows the year
 * - ai: neutral; low confidence renders muted + hints the override affordance
 *   (the actual override menu is wired at the runtime, this just marks it)
 */
export function OriginBadge({
  origin,
  year,
  lowConfidence,
  className,
}: {
  origin: "pastExam" | "ai";
  year?: number | string;
  lowConfidence?: boolean;
  className?: string;
}) {
  if (origin === "pastExam") {
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-xs text-ink-muted", className)}>
        <IconFileText size={13} stroke={1.75} />
        Past exam {year}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs",
        lowConfidence ? "text-coral-soft" : "text-ink-muted",
        className
      )}
    >
      <IconSparkles size={13} stroke={1.75} />
      AI{lowConfidence ? " · low confidence" : ""}
    </span>
  );
}
