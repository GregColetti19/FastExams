import type { Card } from "ts-fsrs";
import { State } from "ts-fsrs";

/**
 * Mastery → color. Single source of truth for "color = state".
 * dark: bright teal = mastered. light: deep teal = mastered. gold at 100.
 */
export function masteryColor(pct: number, mode: "dark" | "light" = "dark"): string {
  if (pct >= 100) return mode === "dark" ? "#e8c674" : "#c99328"; // gold — mastered
  const dark = ["#24604f", "#2e7a64", "#3da583", "#4bb795", "#5dcaa5", "#9fe1cb"];
  const light = ["#9fe1cb", "#5dcaa5", "#3da583", "#1d9e75", "#0f6e56", "#085041"];
  const ramp = mode === "dark" ? dark : light;
  const idx = pct < 20 ? 0 : pct < 40 ? 1 : pct < 55 ? 2 : pct < 70 ? 3 : pct < 85 ? 4 : 5;
  return ramp[idx];
}

export function masteryLabel(pct: number): string {
  if (pct >= 100) return "mastered";
  if (pct < 35) return "cool"; // reframed "weak" — never "failing"
  return ""; // mid/high just shows the number
}

/**
 * Mastery derived from FSRS stability. Stability = days until retrievability
 * decays to 90%. We map that to 0–100 on a log curve: brand-new card ≈ 0,
 * a card stable for ~180d (well into long-term memory) ≈ 100.
 * Review/Relearning cards cap below 100 so only durably-known cards show gold.
 * ponytail: log-of-stability heuristic; swap for a retention-target formula if it reads wrong.
 */
const MASTERY_STABILITY_CEIL = 180; // days of stability that reads as "mastered"

export function masteryFromCard(card: Pick<Card, "stability" | "state">): number {
  if (card.state === State.New || !card.stability) return 0;
  const pct = Math.round((Math.log1p(card.stability) / Math.log1p(MASTERY_STABILITY_CEIL)) * 100);
  return Math.min(pct, 100);
}
