import { describe, it, expect } from "vitest";
import { cupCountsInHalves, type HalfPointsGame } from "./halfPoints";

/**
 * Does a cup count in halves? (Zach's half-points rule, and his look on #1694.)
 * Yes only on a Cup where every game pays exactly 1 point per match.
 */

const match = (over: Partial<HalfPointsGame> = {}): HalfPointsGame => ({
  gameTypeId: "gtt_match_play",
  competitionFormat: null,
  pointsTotal: 4,
  legacyValue: null,
  pairedMatchValues: [null, null, null, null],
  ...over,
});

describe("cupCountsInHalves", () => {
  it("a Cup of match games at 1 point a match: yes", () => {
    expect(cupCountsInHalves("match_play", [match(), match({ pointsTotal: 2, pairedMatchValues: [null, null] })])).toBe(true);
  });

  it("one game at 2 points a match: no", () => {
    expect(cupCountsInHalves("match_play", [match(), match({ pointsTotal: 8 })])).toBe(false);
  });

  it("an even share that is not 1 (5 points over 4 matches): no", () => {
    expect(cupCountsInHalves("match_play", [match({ pointsTotal: 5 })])).toBe(false);
  });

  it("one match with its own value of 2: no, even though the rest share 1", () => {
    // total 5 = 2 + three matches at 1: the even share is 1, the override is not.
    expect(cupCountsInHalves("match_play", [match({ pointsTotal: 5, pairedMatchValues: [2, null, null, null] })])).toBe(false);
  });

  it("overrides of 1 on every match: yes", () => {
    expect(cupCountsInHalves("match_play", [match({ pointsTotal: 4, pairedMatchValues: [1, 1, 1, 1] })])).toBe(true);
  });

  it("a legacy game with no total reads its stored per-match value", () => {
    expect(cupCountsInHalves("match_play", [match({ pointsTotal: null, legacyValue: 1 })])).toBe(true);
    expect(cupCountsInHalves("match_play", [match({ pointsTotal: null, legacyValue: 2 })])).toBe(false);
  });

  it("a non-golf game played as Matches counts like match play", () => {
    expect(cupCountsInHalves("match_play", [match(), match({ gameTypeId: "gtt_generic_card", competitionFormat: "matches" })])).toBe(true);
  });

  it("any game that does not award match by match: no (stroke, rack, pick'em, a placement game)", () => {
    for (const gameTypeId of ["gtt_stroke_play", "gtt_rack_n_stack", "gtt_pickem", "gtt_generic_yard"]) {
      expect(cupCountsInHalves("match_play", [match(), match({ gameTypeId })])).toBe(false);
    }
  });

  it("a game with no paired matches neither qualifies nor disqualifies", () => {
    expect(cupCountsInHalves("match_play", [match(), match({ pointsTotal: 8, pairedMatchValues: [] })])).toBe(true);
    expect(cupCountsInHalves("match_play", [match({ pairedMatchValues: [] })])).toBe(false);
  });

  it("a Tournament, or a cup with no games: no", () => {
    expect(cupCountsInHalves("points", [match()])).toBe(false);
    expect(cupCountsInHalves("match_play", [])).toBe(false);
  });
});
