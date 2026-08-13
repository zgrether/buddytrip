import { describe, it, expect } from "vitest";
import { teamPlaceCapacity, bracketPlaceCapacity, placeCapacityFor } from "./placeCapacity";
import { validatePlacement, placementRefusalMessage } from "./gameConfig";
import { buildDraw } from "./bracket";

/**
 * The place ceiling, and the reason it stopped being "count the teams".
 *
 * A placement split used to be validated against the number of teams, which was
 * right for every format that could carry one. A bracket's places come from its
 * TREE instead — 2 finishers, or 4 with a consolation match — and that number is
 * independent of the roster, so a two-team cup can legitimately run a four-place
 * bracket. Counting teams there refuses a legal setup.
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

describe("bracketPlaceCapacity", () => {
  it("a single-elimination draw finishes 2", () => {
    // Only the finalists are distinguished — everyone else lost to someone who
    // also lost, and the tree never separates them.
    expect(bracketPlaceCapacity(buildDraw(8))).toEqual({ count: 2, source: "bracket" });
  });

  it("a consolation match adds exactly 3rd and 4th", () => {
    expect(bracketPlaceCapacity(buildDraw(8, { consolation: true })).count).toBe(4);
  });

  it("does NOT scale with the field — 4 entrants and 32 finish the same", () => {
    expect(bracketPlaceCapacity(buildDraw(4)).count).toBe(2);
    expect(bracketPlaceCapacity(buildDraw(32)).count).toBe(2);
    expect(bracketPlaceCapacity(buildDraw(4, { consolation: true })).count).toBe(4);
    expect(bracketPlaceCapacity(buildDraw(32, { consolation: true })).count).toBe(4);
  });

  it("reads the DRAW, not the request — a 2-entrant bracket finishes 2 with consolation ON", () => {
    // The whole reason this takes a draw rather than the config flag. `buildDraw`
    // refuses a consolation match below three entrants (one match means the
    // "losing semi-finalists" are a single person), so trusting the flag would
    // promise 4 places to a bracket that can only ever finish 2.
    expect(bracketPlaceCapacity(buildDraw(2, { consolation: true })).count).toBe(2);
  });

  it("an empty draw is unknown, not zero — the pool is still being built", () => {
    expect(bracketPlaceCapacity([])).toEqual({ count: null, source: "bracket" });
    expect(bracketPlaceCapacity(buildDraw(1)).count).toBeNull();
  });
});

describe("placeCapacityFor — one entry point, so a call site needn't know what's special", () => {
  it("a draw wins over the team count", () => {
    expect(placeCapacityFor({ draw: buildDraw(8, { consolation: true }), teamCount: 2 })).toEqual({
      count: 4,
      source: "bracket",
    });
  });

  it("no draw falls through to teams", () => {
    expect(placeCapacityFor({ teamCount: 3 })).toEqual({ count: 3, source: "teams" });
    expect(placeCapacityFor({ draw: [], teamCount: 3 })).toEqual({ count: 3, source: "teams" });
  });
});

describe("validatePlacement against a bracket ceiling", () => {
  it("THE CASE THIS EXISTS FOR — 4 places on a 2-team cup is legal for a consolation bracket", () => {
    // Under the old team-count ceiling this was `too_many_places`, because the
    // places are ENTRANT finishing positions and several entrants share a team.
    const v = validatePlacement(8, [4, 2.5, 1.5, 0], bracketPlaceCapacity(buildDraw(8, { consolation: true })));
    expect(v.state).toBe("complete");
    expect(v.saveable).toBe(true);
  });

  it("…and the same split IS refused when the bracket has no consolation match", () => {
    const v = validatePlacement(8, [4, 2.5, 1.5, 0], bracketPlaceCapacity(buildDraw(8)));
    expect(v.state).toBe("too_many_places");
  });

  it("exact allocation still applies — a remainder is refused either way", () => {
    // Unchanged by any of this: the split must reach the total exactly. Zeros are
    // how "these places are awarded nothing" is said, and they still sum.
    const cap = bracketPlaceCapacity(buildDraw(8, { consolation: true }));
    expect(validatePlacement(8, [4, 2.5, 1, 0], cap).saveable).toBe(false);
    expect(validatePlacement(8, [8, 0, 0, 0], cap).saveable).toBe(true);
  });

  it("fewer places than the bracket finishes stays legal", () => {
    expect(validatePlacement(8, [8], bracketPlaceCapacity(buildDraw(8, { consolation: true }))).saveable).toBe(true);
  });
});

describe("placementRefusalMessage names the right lever", () => {
  it("teams: says add teams", () => {
    const msg = placementRefusalMessage(validatePlacement(15, [5, 4, 3, 2, 1], teamPlaceCapacity(2)))!;
    expect(msg).toContain("2 teams");
    expect(msg).toContain("add teams");
  });

  it("bracket: does NOT say add teams — it says turn on the 3rd-place match", () => {
    // The half of the advice that would be actively wrong. A bracket's ceiling is
    // the shape of its draw; adding teams changes nothing about it.
    const msg = placementRefusalMessage(validatePlacement(8, [4, 2, 1, 1], bracketPlaceCapacity(buildDraw(8))))!;
    expect(msg).not.toContain("add teams");
    expect(msg).toContain("3rd-place match");
    expect(msg).toContain("finishes 2");
  });
});
