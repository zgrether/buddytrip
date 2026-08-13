import { describe, it, expect } from "vitest";
import { teamPlaceCapacity, bracketPlaceCapacity, placeCapacityFor } from "./placeCapacity";
import { validatePlacement, placementRefusalMessage } from "./gameConfig";

/**
 * The place ceiling, and the reason it stopped being "count the teams".
 *
 * A placement split used to be validated against the number of teams, which was
 * right for every format that could carry one. A bracket's places are finishing
 * positions among ENTRANTS, and several entrants can share a team — so a two-team
 * cup can legitimately run an eight-place bracket. Counting teams there refuses a
 * legal setup.
 *
 * #915 first set the bracket ceiling from the tree's arity (2, or 4 with a
 * consolation match). That confused what a bracket can PAY with what it can TELL
 * APART; see `bracketPlaceCapacity`.
 */

describe("teamPlaceCapacity", () => {
  it("carries the count and says teams decided it", () => {
    expect(teamPlaceCapacity(4)).toEqual({ count: 4, source: "teams" });
  });

  it("an unknown count stays unknown — it must never become 0", () => {
    // 0 and null both never refuse, but they mean different things, and the
    // message reads the number. A game configured before its competition has
    // teams is incomplete, not wrong.
    expect(teamPlaceCapacity(null).count).toBeNull();
    expect(teamPlaceCapacity(undefined).count).toBeNull();
  });
});

describe("bracketPlaceCapacity — the FIELD, not the tree's arity", () => {
  it("the ceiling is the entrant count", () => {
    expect(bracketPlaceCapacity(8)).toEqual({ count: 8, source: "bracket" });
    expect(bracketPlaceCapacity(4)).toEqual({ count: 4, source: "bracket" });
  });

  it("does NOT cap at 4 — a bracket may pay further down than it separates", () => {
    // The #915 ceiling (2, or 4 with a consolation match) came from what the tree
    // DISTINGUISHES. A bracket can pay past that: elimination round is a ranking,
    // so an 8-entrant draw finishes 5th–8th as a tie group and placementPoints
    // averages the places it spans. Nothing extra is needed to award it.
    expect(bracketPlaceCapacity(16).count).toBe(16);
  });

  it("the consolation match no longer touches the ceiling", () => {
    // It decides what the bracket TELLS APART (3rd vs 4th rather than two tied
    // thirds) — a result-shape question settled at compute time. The two were
    // entangled and are now separate.
    expect(bracketPlaceCapacity(8).count).toBe(8);
  });

  it("a field too small to play is unknown, not zero", () => {
    expect(bracketPlaceCapacity(1).count).toBeNull();
    expect(bracketPlaceCapacity(0).count).toBeNull();
    expect(bracketPlaceCapacity(null).count).toBeNull();
    expect(bracketPlaceCapacity(undefined).count).toBeNull();
  });

  it("two entrants is the smallest real bracket", () => {
    expect(bracketPlaceCapacity(2).count).toBe(2);
  });
});

describe("placeCapacityFor — one entry point, so a call site needn't know what's special", () => {
  it("an entrant count wins over the team count", () => {
    // THE CASE: eight entrants drawn from two teams. Counting teams would cap a
    // field of 8 at 2 places.
    expect(placeCapacityFor({ entrantCount: 8, teamCount: 2 })).toEqual({ count: 8, source: "bracket" });
  });

  it("no entrants falls through to teams", () => {
    expect(placeCapacityFor({ teamCount: 3 })).toEqual({ count: 3, source: "teams" });
  });

  it("a bracket too small to play reports bracket-unknown, not the team count", () => {
    // The source still matters with a null count: it decides which noun the
    // message would use if one were ever produced from it.
    expect(placeCapacityFor({ entrantCount: 1, teamCount: 4 })).toEqual({ count: null, source: "bracket" });
  });
});

describe("validatePlacement against a bracket ceiling", () => {
  it("THE CASE THIS EXISTS FOR — 4 places on a 2-team cup, BBMI's shape", () => {
    // Under the team ceiling this was `too_many_places`: the places are ENTRANT
    // finishing positions and several entrants share a team.
    const v = validatePlacement(8, [4, 2.5, 1.5, 0], bracketPlaceCapacity(8));
    expect(v.state).toBe("complete");
    expect(v.saveable).toBe(true);
  });

  it("…and 8 places over 8 entrants is legal too — no cap at 4", () => {
    const v = validatePlacement(8, [3, 2, 1, 1, 0.5, 0.25, 0.25, 0], bracketPlaceCapacity(8));
    expect(v.saveable).toBe(true);
  });

  it("past the field IS still refused — a place nobody can occupy is never awarded", () => {
    expect(validatePlacement(8, [4, 2, 1, 0.5, 0.5], bracketPlaceCapacity(4)).state).toBe("too_many_places");
  });

  it("exact allocation still applies — a remainder is refused", () => {
    // Unchanged by any of this: the split must reach the total exactly. Zeros are
    // how "this place is awarded nothing" is said, and they still sum.
    expect(validatePlacement(8, [4, 2.5, 1, 0], bracketPlaceCapacity(8)).saveable).toBe(false);
    expect(validatePlacement(8, [8, 0, 0, 0], bracketPlaceCapacity(8)).saveable).toBe(true);
  });

  it("fewer places than entrants stays legal", () => {
    expect(validatePlacement(8, [8], bracketPlaceCapacity(8)).saveable).toBe(true);
  });
});

describe("placementRefusalMessage names the right lever", () => {
  it("teams: says add teams", () => {
    const msg = placementRefusalMessage(validatePlacement(15, [5, 4, 3, 2, 1], teamPlaceCapacity(2)))!;
    expect(msg).toContain("2 teams");
    expect(msg).toContain("add teams");
  });

  it("bracket: does NOT say add teams — the ceiling is the field", () => {
    // The half of the advice that would be actively wrong. Adding teams changes
    // nothing about a bracket's ceiling; adding entrants does.
    const msg = placementRefusalMessage(validatePlacement(8, [4, 2, 1, 1], bracketPlaceCapacity(3)))!;
    expect(msg).not.toContain("add teams");
    expect(msg).toContain("3 entrants");
    expect(msg).toContain("add entrants");
  });
});
