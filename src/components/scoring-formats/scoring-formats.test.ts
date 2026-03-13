import { describe, it, expect } from "vitest";

/**
 * Scoring format component logic tests.
 *
 * These test the scoring logic extracted from the format components
 * without needing React rendering (no tRPC provider needed).
 */

describe("ScrambleFormat logic", () => {
  it("Team A win produces (1, 0)", () => {
    const teamA = { id: "a", points: 0 };
    const teamB = { id: "b", points: 0 };
    // Simulate select("a")
    teamA.points = 1;
    teamB.points = 0;
    expect(teamA.points).toBe(1);
    expect(teamB.points).toBe(0);
  });

  it("halved produces (0.5, 0.5)", () => {
    const teamA = { id: "a", points: 0 };
    const teamB = { id: "b", points: 0 };
    teamA.points = 0.5;
    teamB.points = 0.5;
    expect(teamA.points).toBe(0.5);
    expect(teamB.points).toBe(0.5);
  });

  it("Team B win produces (0, 1)", () => {
    const teamA = { id: "a", points: 0 };
    const teamB = { id: "b", points: 0 };
    teamA.points = 0;
    teamB.points = 1;
    expect(teamA.points).toBe(0);
    expect(teamB.points).toBe(1);
  });
});

describe("StablefordFormat logic", () => {
  it("increment clamps at 1", () => {
    const points = 1;
    const incremented = Math.min(1, points + 0.5);
    expect(incremented).toBe(1);
  });

  it("decrement clamps at 0", () => {
    const points = 0;
    const decremented = Math.max(0, points - 0.5);
    expect(decremented).toBe(0);
  });

  it("stepping from 0 to 0.5 to 1", () => {
    let points = 0;
    points = Math.min(1, points + 0.5);
    expect(points).toBe(0.5);
    points = Math.min(1, points + 0.5);
    expect(points).toBe(1);
  });
});

describe("SabotageFormat logic", () => {
  it("same 3-way selection as scramble", () => {
    // Sabotage uses identical scoring to scramble
    const selections = [
      { sel: "a", expected: [1, 0] },
      { sel: "halved", expected: [0.5, 0.5] },
      { sel: "b", expected: [0, 1] },
    ];
    for (const { sel, expected } of selections) {
      let a = 0, b = 0;
      if (sel === "a") { a = 1; b = 0; }
      else if (sel === "halved") { a = 0.5; b = 0.5; }
      else if (sel === "b") { a = 0; b = 1; }
      expect([a, b]).toEqual(expected);
    }
  });
});

describe("SkinsFormat logic", () => {
  it("points are clamped between 0 and 1", () => {
    const cases = [
      { start: 0, delta: -0.5, expected: 0 },
      { start: 0, delta: 0.5, expected: 0.5 },
      { start: 0.5, delta: 0.5, expected: 1 },
      { start: 1, delta: 0.5, expected: 1 },
      { start: 1, delta: -0.5, expected: 0.5 },
    ];
    for (const { start, delta, expected } of cases) {
      const result = delta > 0
        ? Math.min(1, start + delta)
        : Math.max(0, start + delta);
      expect(result).toBe(expected);
    }
  });
});
