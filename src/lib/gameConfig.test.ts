import { describe, it, expect } from "vitest";
import {
  deriveMatchCount,
  validatePlacement,
  placementRefusalMessage,
  matchReadout,
  placementFit,
  matchFit,
} from "./gameConfig";

/**
 * Slice D add-game flow — pure validation/derivation (Stage 2). Each spec rule
 * gets a case: untouched-saveable, partial-blocked, complete-valid, 0-lower-OK,
 * match-count ready/not-set, fit warn-only-when-defined-incompatible +
 * calm-pending + self-clear.
 */

describe("deriveMatchCount — the shared match-count primitive", () => {
  it("singles = min(team sizes)", () => {
    expect(deriveMatchCount([8, 8], "singles")).toBe(8);
    expect(deriveMatchCount([8, 6], "singles")).toBe(6); // bounded by smaller
    expect(deriveMatchCount([5, 7, 6], "singles")).toBe(5);
  });

  it("doubles = floor(min ÷ 2)", () => {
    expect(deriveMatchCount([8, 8], "doubles")).toBe(4);
    expect(deriveMatchCount([6, 8], "doubles")).toBe(3);
    expect(deriveMatchCount([5, 8], "doubles")).toBe(2); // floor(5/2)
  });

  it("returns null (pending) when fewer than 2 teams are sized", () => {
    expect(deriveMatchCount([], "singles")).toBeNull();
    expect(deriveMatchCount([8], "singles")).toBeNull();
    expect(deriveMatchCount([8, 0], "singles")).toBeNull(); // 0 = not sized
  });
});

describe("validatePlacement — sum-to-total, nil-vs-entered", () => {
  it("untouched (1st place nil / empty values) is SAVEABLE — the shell state", () => {
    const v = validatePlacement(8, []);
    expect(v.state).toBe("undistributed");
    expect(v.saveable).toBe(true);
    expect(v.remaining).toBe(8);
  });

  it("entered but sum < total is PARTIAL and blocked", () => {
    const v = validatePlacement(8, [5]);
    expect(v.state).toBe("partial");
    expect(v.saveable).toBe(false);
    expect(v.allocated).toBe(5);
    expect(v.remaining).toBe(3);
  });

  it("entered but sum > total is PARTIAL and blocked", () => {
    const v = validatePlacement(8, [5, 5]);
    expect(v.state).toBe("partial");
    expect(v.saveable).toBe(false);
    expect(v.remaining).toBe(-2);
  });

  it("entered and summing to total is COMPLETE and saveable", () => {
    const v = validatePlacement(8, [5, 3]);
    expect(v.state).toBe("complete");
    expect(v.saveable).toBe(true);
    expect(v.remaining).toBe(0);
  });

  it("0-value LOWER place is valid when the sum still matches the total", () => {
    const v = validatePlacement(8, [5, 3, 0]);
    expect(v.state).toBe("complete");
    expect(v.saveable).toBe(true);
  });

  it("a typed 0 in 1st place counts as STARTED (non-nil) — blocked unless sum matches", () => {
    // total 8, 1st place typed as 0 → started, sum 0 ≠ 8 → partial.
    const started0 = validatePlacement(8, [0]);
    expect(started0.state).toBe("partial");
    expect(started0.saveable).toBe(false);
    // distinct from untouched (empty array), which is saveable.
    expect(validatePlacement(8, []).saveable).toBe(true);
  });
});

describe("matchReadout — concrete count, no 'projected'", () => {
  it("teams sized → 'N matches ready' with available = value × count", () => {
    const r = matchReadout(1, [8, 8], "singles");
    expect(r.matchCount).toBe(8);
    expect(r.available).toBe(8);
    expect(r.label).toBe("8 matches ready");
  });

  it("doubles total uses floor(min/2)", () => {
    const r = matchReadout(2, [8, 8], "doubles");
    expect(r.matchCount).toBe(4);
    expect(r.available).toBe(8); // 2 × 4
  });

  it("singular label for one match", () => {
    expect(matchReadout(8, [1, 2], "singles").label).toBe("1 match ready");
  });

  it("teams not sized → 'matches not set', available null", () => {
    const r = matchReadout(1, [8], "singles");
    expect(r.matchCount).toBeNull();
    expect(r.available).toBeNull();
    expect(r.label).toBe("matches not set");
  });
});

describe("placementFit — soft, defined-incompatible only", () => {
  it("calm-PENDING when no teams defined (not a warning)", () => {
    expect(placementFit([5, 3, 1], 0).state).toBe("pending");
  });

  it("WARNS when more places than teams (extra places unawardable)", () => {
    const f = placementFit([5, 3, 1], 2);
    expect(f.state).toBe("warn");
    expect(f.message).toContain("3 places");
  });

  it("OK when places fit the teams", () => {
    expect(placementFit([5, 3], 2).state).toBe("ok");
    expect(placementFit([5, 3], 3).state).toBe("ok"); // fewer places than teams is fine
  });

  it("self-clears when the roster grows to fit (recompute)", () => {
    expect(placementFit([5, 3, 1], 2).state).toBe("warn");
    expect(placementFit([5, 3, 1], 3).state).toBe("ok"); // a team was added
  });
});

describe("matchFit — doubles parity", () => {
  it("calm-PENDING when fewer than 2 teams sized", () => {
    expect(matchFit([8], "doubles").state).toBe("pending");
    expect(matchFit([], "singles").state).toBe("pending");
  });

  it("doubles WARNS on an odd team", () => {
    const f = matchFit([8, 7], "doubles");
    expect(f.state).toBe("warn");
    expect(f.message).toContain("odd");
  });

  it("doubles OK when both teams even", () => {
    expect(matchFit([8, 6], "doubles").state).toBe("ok");
  });

  it("singles never warns on parity", () => {
    expect(matchFit([8, 7], "singles").state).toBe("ok");
  });

  it("self-clears when the odd team becomes even (recompute)", () => {
    expect(matchFit([8, 7], "doubles").state).toBe("warn");
    expect(matchFit([8, 8], "doubles").state).toBe("ok");
  });
});

describe("validatePlacement — more places than scoring entities", () => {
  // The reported setup: 2 teams, total 15, split 5/4/3/2/1 (one place per
  // PLAYER). placementPoints walks the standings, not the distribution, so the
  // trailing 3/2/1 are never read — the winner takes 5, the loser 4, and 6
  // points quietly go nowhere while points-AVAILABLE still counts all 15.
  it("refuses 5 places against 2 teams", () => {
    const v = validatePlacement(15, [5, 4, 3, 2, 1], 2);
    expect(v.state).toBe("too_many_places");
    expect(v.saveable).toBe(false);
    expect(v.places).toBe(5);
    expect(v.entities).toBe(2);
  });

  it("names BOTH numbers, and what to change", () => {
    const msg = placementRefusalMessage(validatePlacement(15, [5, 4, 3, 2, 1], 2))!;
    expect(msg).toContain("5 places");
    expect(msg).toContain("2 teams");
    // #809 — name the control, not just the state.
    expect(msg).toMatch(/remove places/i);
  });

  it("refuses even when the split adds up exactly", () => {
    // Sum is correct (15) — the split is still unsatisfiable, and saying
    // "3 left to place" here would send the reader the wrong way.
    const v = validatePlacement(15, [5, 4, 3, 2, 1], 2);
    expect(v.allocated).toBe(15);
    expect(v.state).toBe("too_many_places");
  });

  it("places EQUAL to entities is fine", () => {
    expect(validatePlacement(9, [5, 4], 2).saveable).toBe(true);
  });

  it("FEWER places than entities stays saveable (#807 — unpaid places show nothing)", () => {
    // 4 teams, 2 paid places: 3rd and 4th earn 0. dist() returns 0 out of range,
    // so this is legitimate and must never be refused.
    const v = validatePlacement(9, [5, 4], 4);
    expect(v.state).toBe("complete");
    expect(v.saveable).toBe(true);
  });

  it("winner-take-all against 2 teams saves", () => {
    expect(validatePlacement(15, [15], 2).saveable).toBe(true);
  });

  it("an UNKNOWN entity count never refuses", () => {
    // A game configured before its competition has teams, a standalone game, or
    // a query still in flight. Refusing there would block a setup that is merely
    // incomplete rather than wrong.
    expect(validatePlacement(15, [5, 4, 3, 2, 1]).saveable).toBe(true);
    expect(validatePlacement(15, [5, 4, 3, 2, 1], null).saveable).toBe(true);
    expect(validatePlacement(15, [5, 4, 3, 2, 1], 0).saveable).toBe(true);
  });

  it("still refuses a split that does not sum to the total", () => {
    // The pre-existing check survives the extension, with and without a count.
    expect(validatePlacement(8, [5, 4], 2).saveable).toBe(false);
    expect(validatePlacement(8, [5, 4]).saveable).toBe(false);
    expect(placementRefusalMessage(validatePlacement(8, [5, 4], 2))).toContain("total 8 exactly");
  });

  it("returns no message when the split is saveable", () => {
    expect(placementRefusalMessage(validatePlacement(9, [5, 4], 2))).toBeNull();
  });
});

describe("validatePlacement — places check is independent of the total", () => {
  // #819 nested the places-vs-entities check under `total != null` at every
  // gate, so a game with no owner-set total could persist a split that can't be
  // applied — the exact shape of the two affected games found in production.
  // The validator itself was always independent; only the callers weren't.
  it("flags too many places even with a 0 / unset total", () => {
    const v = validatePlacement(0, [9, 6, 4, 2], 2);
    expect(v.state).toBe("too_many_places");
    expect(v.places).toBe(4);
    expect(v.entities).toBe(2);
  });

  it("a 0 total with a FITTING split is not flagged as too many places", () => {
    // It's `partial` (0 ≠ 15) — which the callers only enforce once a total
    // exists — but it must never be reported as an entity-count problem.
    expect(validatePlacement(0, [9, 6], 2).state).toBe("partial");
  });
});
