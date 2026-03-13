import { describe, it, expect } from "vitest";
import {
  computeScores,
  computeRemaining,
  computeScoreSummary,
  type RoundResult,
  type SideEventScore,
  type RoundInfo,
  type SideEventInfo,
} from "./scoring";

describe("computeScores", () => {
  it("returns zero scores when no results", () => {
    const result = computeScores(["team-a", "team-b"], [], []);
    expect(result).toEqual([
      { teamId: "team-a", roundPoints: 0, sidePoints: 0, totalPoints: 0 },
      { teamId: "team-b", roundPoints: 0, sidePoints: 0, totalPoints: 0 },
    ]);
  });

  it("tallies round points correctly", () => {
    const rounds: RoundResult[] = [
      { roundId: "r1", pointsAvailable: 10, teamPoints: { "team-a": 7, "team-b": 3 } },
      { roundId: "r2", pointsAvailable: 10, teamPoints: { "team-a": 4, "team-b": 6 } },
    ];
    const result = computeScores(["team-a", "team-b"], rounds, []);
    expect(result[0]).toMatchObject({ teamId: "team-a", roundPoints: 11, totalPoints: 11 });
    expect(result[1]).toMatchObject({ teamId: "team-b", roundPoints: 9, totalPoints: 9 });
  });

  it("tallies side event points", () => {
    const sides: SideEventScore[] = [
      { sideEventId: "s1", pointsAvailable: 5, result: { "team-a": 5, "team-b": 0 } },
    ];
    const result = computeScores(["team-a", "team-b"], [], sides);
    expect(result[0]).toMatchObject({ sidePoints: 5, totalPoints: 5 });
    expect(result[1]).toMatchObject({ sidePoints: 0, totalPoints: 0 });
  });

  it("combines round and side event points", () => {
    const rounds: RoundResult[] = [
      { roundId: "r1", pointsAvailable: 10, teamPoints: { "team-a": 6, "team-b": 4 } },
    ];
    const sides: SideEventScore[] = [
      { sideEventId: "s1", pointsAvailable: 5, result: { "team-a": 2, "team-b": 3 } },
    ];
    const result = computeScores(["team-a", "team-b"], rounds, sides);
    expect(result[0]).toMatchObject({ roundPoints: 6, sidePoints: 2, totalPoints: 8 });
    expect(result[1]).toMatchObject({ roundPoints: 4, sidePoints: 3, totalPoints: 7 });
  });

  it("handles fractional points (0.5 halved)", () => {
    const rounds: RoundResult[] = [
      { roundId: "r1", pointsAvailable: 1, teamPoints: { "team-a": 0.5, "team-b": 0.5 } },
    ];
    const result = computeScores(["team-a", "team-b"], rounds, []);
    expect(result[0].totalPoints).toBe(0.5);
    expect(result[1].totalPoints).toBe(0.5);
  });

  it("ignores points for unknown teams", () => {
    const rounds: RoundResult[] = [
      { roundId: "r1", pointsAvailable: 10, teamPoints: { "team-a": 7, "team-x": 3 } },
    ];
    const result = computeScores(["team-a", "team-b"], rounds, []);
    expect(result[0]).toMatchObject({ roundPoints: 7 });
    expect(result[1]).toMatchObject({ roundPoints: 0 });
  });
});

describe("computeRemaining", () => {
  it("returns 0 when everything is complete", () => {
    const rounds: RoundInfo[] = [
      { roundId: "r1", pointsAvailable: 10, hasResults: true },
    ];
    const sides: SideEventInfo[] = [
      { sideEventId: "s1", pointsAvailable: 5, isComplete: true },
    ];
    expect(computeRemaining(rounds, sides)).toBe(0);
  });

  it("sums points from rounds without results", () => {
    const rounds: RoundInfo[] = [
      { roundId: "r1", pointsAvailable: 10, hasResults: true },
      { roundId: "r2", pointsAvailable: 8, hasResults: false },
      { roundId: "r3", pointsAvailable: 12, hasResults: false },
    ];
    expect(computeRemaining(rounds, [])).toBe(20);
  });

  it("sums points from incomplete side events", () => {
    const sides: SideEventInfo[] = [
      { sideEventId: "s1", pointsAvailable: 5, isComplete: false },
      { sideEventId: "s2", pointsAvailable: 3, isComplete: true },
    ];
    expect(computeRemaining([], sides)).toBe(5);
  });
});

describe("computeScoreSummary", () => {
  it("returns scores and remaining combined", () => {
    const rounds: RoundResult[] = [
      { roundId: "r1", pointsAvailable: 10, teamPoints: { a: 6, b: 4 } },
    ];
    const allRounds: RoundInfo[] = [
      { roundId: "r1", pointsAvailable: 10, hasResults: true },
      { roundId: "r2", pointsAvailable: 10, hasResults: false },
    ];
    const result = computeScoreSummary(["a", "b"], rounds, [], allRounds, []);
    expect(result.teamScores[0]).toMatchObject({ teamId: "a", totalPoints: 6 });
    expect(result.remaining).toBe(10);
  });
});
