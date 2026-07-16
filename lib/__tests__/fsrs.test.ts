import { describe, it, expect } from "vitest";
import { newCard, review, binaryGrade, Rating, State } from "../fsrs";

describe("binaryGrade", () => {
  it("maps Got it → Good, Again → Again", () => {
    expect(binaryGrade(true)).toBe(Rating.Good);
    expect(binaryGrade(false)).toBe(Rating.Again);
  });
});

describe("newCard", () => {
  it("starts in New state with zero reps/lapses", () => {
    const c = newCard(new Date("2026-01-01"));
    expect(c.state).toBe(State.New);
    expect(c.reps).toBe(0);
    expect(c.lapses).toBe(0);
  });
});

describe("review", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  it("Got it pushes next review into the future and grows stability", () => {
    const c0 = newCard(now);
    const c1 = review(c0, binaryGrade(true), now);
    expect(c1.reps).toBe(1);
    expect(c1.due.getTime()).toBeGreaterThan(now.getTime());
  });

  // graduate a card into Review state by clearing short-term learning steps at their due times
  function graduate(): ReturnType<typeof newCard> {
    let c = newCard(now);
    let t = now;
    for (let i = 0; i < 8 && c.state !== State.Review; i++) {
      c = review(c, binaryGrade(true), t);
      t = new Date(c.due);
    }
    return c;
  }

  it("Again counts a lapse once the card is in Review state", () => {
    const c = graduate();
    expect(c.state).toBe(State.Review);
    const lapsesBefore = c.lapses;
    const after = review(c, binaryGrade(false), new Date(c.due));
    expect(after.lapses).toBe(lapsesBefore + 1);
  });

  it("spaces successful Review reviews out (interval grows day over day)", () => {
    let c = graduate();
    expect(c.state).toBe(State.Review);
    const firstInterval = c.due.getTime() - c.last_review!.getTime();
    // one more good review from a graduated card → a longer interval
    const next = review(c, binaryGrade(true), new Date(c.due));
    const secondInterval = next.due.getTime() - next.last_review!.getTime();
    expect(secondInterval).toBeGreaterThan(firstInterval);
  });
});
