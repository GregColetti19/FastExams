"use client";
import * as React from "react";
import { useTheme } from "./ThemeProvider";
import type { HorizonDay } from "@/lib/review/queue";
import { masteryColor } from "@/lib/mastery";

/**
 * Return horizon (§8.2, Cadence signature). Today = coral (act now), future = teal.
 * Reassures the load stays flat — never a scary spike. Bars scale to the busiest day.
 */
export function ReviewHorizon({ days }: { days: HorizonDay[] }) {
  const mode = useTheme();
  const max = Math.max(1, ...days.map((d) => d.count));
  const future = mode === "dark" ? "#3da583" : "#1d9e75";

  return (
    <div>
      <div className="flex items-end gap-1.5" style={{ height: 72 }}>
        {days.map((d) => {
          const h = d.count === 0 ? 2 : Math.max(4, (d.count / max) * 72);
          const isToday = d.offset === 0;
          return (
            <div key={d.offset} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[10px] tabular-nums text-ink-muted">{d.count || ""}</span>
              <div
                className="w-full rounded-t motion-safe:transition-[height] motion-safe:duration-tempo"
                style={{ height: h, background: isToday ? "#d85a30" : future, opacity: d.count === 0 ? 0.3 : 1 }}
                title={`${d.count} cards`}
              />
              <span className="text-[10px] text-ink-muted">
                {d.offset === 0 ? "today" : `+${d.offset}`}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-ink-muted">
        cards you clear today come back spaced out — the loop closing.
      </p>
    </div>
  );
}
