import { describe, it, expect } from "vitest";
import { computeScores } from "./scoring";

describe("computeScores", () => {
  const teamIds = ["team-a", "team-b"];

  it("computes scores from round results", () => {
    const scores = computeScores(
      teamIds,
      [
        { roundId: "r1", pointsAvailable: 4, teamPoints: { "team-a": 3, "team-b": 1 } },
        { roundId: "r2", pointsAvailable: 4, teamPoints: { "team-a": 2, "team-b": 2 } },
      ],
      []
    );

    expect(scores[0].roundPoints).toBe(5);
    expect(scores[1].roundPoints).toBe(3);
    expect(scores[0].totalPoints).toBe(5);
  });

  it("includes side event points", () => {
    const scores = computeScores(
      teamIds,
      [{ roundId: "r1", pointsAvailable: 4, teamPoints: { "team-a": 2, "team-b": 2 } }],
      [{ sideEventId: "s1", result: { "team-a": 1, "team-b": 0 } }]
    );

    expect(scores[0].sidePoints).toBe(1);
    expect(scores[0].totalPoints).toBe(3);
    expect(scores[1].totalPoints).toBe(2);
  });

  it("returns zero scores for teams with no results", () => {
    const scores = computeScores(teamIds, [], []);
    expect(scores[0].totalPoints).toBe(0);
    expect(scores[1].totalPoints).toBe(0);
  });
});
