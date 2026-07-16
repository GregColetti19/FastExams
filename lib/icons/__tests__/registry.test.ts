import { describe, it, expect } from "vitest";
import { resolveIcon, seedAccent, iconRegistry, ACCENTS, DEFAULT_ICON } from "../registry";

describe("resolveIcon", () => {
  it("returns the mapped component for a known name", () => {
    expect(resolveIcon("brain")).toBe(iconRegistry.brain);
  });
  it("falls back to default for unknown/empty names (never throws, never evals)", () => {
    expect(resolveIcon("definitely-not-an-icon")).toBe(iconRegistry[DEFAULT_ICON]);
    expect(resolveIcon(null)).toBe(iconRegistry[DEFAULT_ICON]);
    expect(resolveIcon(undefined)).toBe(iconRegistry[DEFAULT_ICON]);
  });
});

describe("seedAccent", () => {
  it("is deterministic for the same seed", () => {
    expect(seedAccent("exam-123")).toBe(seedAccent("exam-123"));
  });
  it("always returns a color from the curated set", () => {
    for (const s of ["a", "b", "exam-xyz", "", "long-seed-string-here"]) {
      expect(ACCENTS).toContain(seedAccent(s) as (typeof ACCENTS)[number]);
    }
  });
});
