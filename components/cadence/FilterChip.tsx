"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Analytics filter chip (§8.6). Tap to include/exclude an exam from the visuals.
 * Excluded = muted + strikethrough. Interactive; parent recomputes on toggle.
 */
export function FilterChip({
  label,
  active,
  onToggle,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={cn(
        "rounded-pill border px-3 py-1 text-xs transition-colors duration-150",
        active
          ? "border-border-strong bg-surface-inset text-ink"
          : "border-border-hair text-ink-muted line-through opacity-60"
      )}
    >
      {label}
    </button>
  );
}
