import * as React from "react";
import { resolveIcon } from "@/lib/icons/registry";
import { cn } from "@/lib/utils";

/**
 * Exam identity chip: the per-exam icon tinted with its seeded accent.
 * Accent lives ONLY here — it never encodes mastery/state.
 */
export function IconChip({
  name,
  accent,
  size = 36,
  className,
}: {
  name: string | null | undefined;
  accent: string;
  size?: number;
  className?: string;
}) {
  const Icon = resolveIcon(name);
  return (
    <span
      className={cn("inline-flex items-center justify-center rounded-chip", className)}
      style={{ width: size, height: size, background: `${accent}22`, color: accent }}
    >
      <Icon size={size * 0.55} stroke={1.75} />
    </span>
  );
}
