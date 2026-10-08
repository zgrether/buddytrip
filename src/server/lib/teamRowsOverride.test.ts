import { describe, it, expect } from "vitest";
import { withTeamRowsOverride } from "./competitionLeaderboard";

/**
 * The leaderboard's what-if (PR 8c): a preview asks the board's own maths what a
 * re-credit would do, by swapping one game's team rows before anything is
 * computed — never a second copy of the roll-up (CLAUDE.md #8).
 */

describe("withTeamRowsOverride — the board's what-if replaces ONE game's team rows and nothing else", () => {
  const rows = [
    { game_id: "g1", entity_id: "red", entity_type: "team", position: 2, raw_score: 142, value_kind: "rank", credited_team_id: "red" },
    { game_id: "g1", entity_id: "blue", entity_type: "team", position: 1, raw_score: 71, value_kind: "rank", credited_team_id: "blue" },
    { game_id: "g1", entity_id: "e1", entity_type: "entrant", position: 1, raw_score: null, value_kind: "rank", credited_team_id: "red" },
    { game_id: "g2", entity_id: "red", entity_type: "team", position: 1, raw_score: 9, value_kind: "rank", credited_team_id: "red" },
  ];

  it("no override → the same array", () => {
    expect(withTeamRowsOverride(rows, undefined)).toBe(rows);
  });

  it("g1's team rows are swapped; g1's entrant row and g2's rows are untouched", () => {
    const out = withTeamRowsOverride(
      rows,
      new Map([["g1", [
        { entity_id: "red", position: 1, raw_score: 70 },
        { entity_id: "blue", position: 2, raw_score: 143 },
      ]]])
    );
    expect(out).toEqual([
      rows[2],
      rows[3],
      { game_id: "g1", entity_id: "red", entity_type: "team", position: 1, raw_score: 70, value_kind: "rank", credited_team_id: "red" },
      { game_id: "g1", entity_id: "blue", entity_type: "team", position: 2, raw_score: 143, value_kind: "rank", credited_team_id: "blue" },
    ]);
  });
});
