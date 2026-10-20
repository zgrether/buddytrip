import { describe, it, expect } from "vitest";
import { computeStrokePlayStandings, computeStrokeTeamStandings, teamOfScrambleGroups } from "./strokePlay";

/**
 * #1674 — a scramble ranks PLAY GROUPS, so its team standings need a
 * group -> team map. The finalize summary mapped groups through the person map,
 * found nothing, and said a scramble awarding real points would award none.
 * `teamOfScrambleGroups` is now the one rule the view and the server's finalize
 * both read.
 */

const teamOf = (u: string) => ({ ann: "red", bob: "red", cat: "blue", dan: "blue" } as Record<string, string>)[u];
const groups = [
  { id: "g1", userIds: ["ann", "bob"] },
  { id: "g2", userIds: ["cat", "dan"] },
];

describe("teamOfScrambleGroups", () => {
  it("maps each group to its members' team", () => {
    expect(teamOfScrambleGroups(groups, teamOf)).toEqual({ g1: "red", g2: "blue" });
  });

  it("the first member with a team decides it", () => {
    expect(teamOfScrambleGroups([{ id: "g", userIds: ["zed", "cat", "ann"] }], teamOf)).toEqual({ g: "blue" });
  });

  it("a group nobody on a team plays in has no team", () => {
    expect(teamOfScrambleGroups([{ id: "g", userIds: ["zed"] }], teamOf)).toEqual({});
  });
});

describe("a scramble's team standings come from its GROUPS (#1674)", () => {
  // Group totals, ranked like the server ranks them: lowest strokes first.
  const standings = computeStrokePlayStandings(["g1", "g2"], [
    { participant_id: "g1", value: 60 },
    { participant_id: "g2", value: 63 },
  ]);

  it("through the group map: one row per team, in order", () => {
    const rows = computeStrokeTeamStandings(standings, teamOfScrambleGroups(groups, teamOf));
    expect(rows.map((r) => [r.teamId, r.position])).toEqual([["red", 1], ["blue", 2]]);
  });

  it("CONTROL: through the person map (the bug) there is nothing to award", () => {
    const personMap: Record<string, string> = { ann: "red", bob: "red", cat: "blue", dan: "blue" };
    expect(computeStrokeTeamStandings(standings, personMap)).toEqual([]);
  });
});
