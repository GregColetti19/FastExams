import { describe, it, expect } from "vitest";
import { masteryColor, masteryLabel, masteryFromCard } from "../mastery";
import { State } from "ts-fsrs";

describe("masteryColor", () => {
  it("returns gold at 100 (mastered), never a teal", () => {
    expect(masteryColor(100, "dark")).toBe("#e8c674");
    expect(masteryColor(100, "light")).toBe("#c99328");
  });

  it("never returns a red/alarm color at any value", () => {
    // no-red invariant: scan the whole 0–100 range in both modes
    const reds = ["#f", "#e0", "#d0", "#c0"]; // crude: high-R low-G/B prefixes we forbid for mastery
    for (const mode of ["dark", "light"] as const) {
      for (let p = 0; p <= 99; p++) {
        const c = masteryColor(p, mode).toLowerCase();
        // all non-mastered colors are from the teal ramp — G channel dominates
        const r = parseInt(c.slice(1, 3), 16);
        const g = parseInt(c.slice(3, 5), 16);
        expect(g).toBeGreaterThanOrEqual(r); // green ≥ red → cool, not alarm
      }
    }
  });

  it("dark ramp brightens toward mastery, light ramp deepens", () => {
    expect(masteryColor(10, "dark")).toBe("#24604f"); // dim
    expect(masteryColor(90, "dark")).toBe("#9fe1cb"); // bright
    expect(masteryColor(10, "light")).toBe("#9fe1cb"); // pale
    expect(masteryColor(90, "light")).toBe("#085041"); // deep
  });
});

describe("masteryLabel", () => {
  it("mastered at 100, cool below 35, blank in between", () => {
    expect(masteryLabel(100)).toBe("mastered");
    expect(masteryLabel(34)).toBe("cool");
    expect(masteryLabel(0)).toBe("cool");
    expect(masteryLabel(35)).toBe("");
    expect(masteryLabel(80)).toBe("");
  });

  it("never says 'failing' or 'weak'", () => {
    for (let p = 0; p <= 100; p++) {
      expect(["mastered", "cool", ""]).toContain(masteryLabel(p));
    }
  });
});

describe("masteryFromCard", () => {
  it("new card is 0", () => {
    expect(masteryFromCard({ state: State.New, stability: 0 })).toBe(0);
  });

  it("rises monotonically with stability and caps at 100", () => {
    const low = masteryFromCard({ state: State.Review, stability: 2 });
    const mid = masteryFromCard({ state: State.Review, stability: 30 });
    const high = masteryFromCard({ state: State.Review, stability: 200 });
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
    expect(high).toBeLessThanOrEqual(100);
    expect(masteryFromCard({ state: State.Review, stability: 5000 })).toBe(100);
  });
});
