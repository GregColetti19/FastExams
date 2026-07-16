"use client";
import * as React from "react";
import { IconTrophy } from "@tabler/icons-react";
import { masteryColor } from "@/lib/mastery";
import { useTheme } from "./ThemeProvider";
import { cn } from "@/lib/utils";

/**
 * Mastery visuals. Color always from masteryColor() — gold at 100, teal-spectrum below.
 * Never red. `pct` is 0–100.
 */

export function MasteryRing({ pct, size = 44 }: { pct: number; size?: number }) {
  const mode = useTheme();
  const stroke = 4;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const color = masteryColor(clamped, mode);
  const mastered = clamped >= 100;

  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="motion-safe:transition-all motion-safe:duration-tempo">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - clamped / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-tempo"
        />
      </svg>
      {mastered && (
        <IconTrophy size={size * 0.4} stroke={1.5} color={color} className="absolute" />
      )}
    </span>
  );
}

export function MasteryBar({ pct, className }: { pct: number; className?: string }) {
  const mode = useTheme();
  const clamped = Math.max(0, Math.min(100, pct));
  const color = masteryColor(clamped, mode);
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-pill bg-surface-inset", className)}>
      <div
        className="h-full rounded-pill motion-safe:transition-[width] motion-safe:duration-tempo"
        style={{ width: `${clamped}%`, background: color }}
      />
    </div>
  );
}
