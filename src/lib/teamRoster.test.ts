import { describe, it, expect } from "vitest";
import { teamedUserIdSet, sideHasTeam, matchRosterValid } from "./teamRoster";

// Team-identity PR 1 — the keystone roster-integrity predicate. Distinct from the
// slot-filled readiness predicates (matchDraft): "are the filled slots' players
// still on teams?", NOT "are the slots filled?".
describe("teamedUserIdSet", () => {
  it("collects the assigned user ids", () => {
    const set = teamedUserIdSet([{ user_id: "a" }, { user_id: "b" }]);
    expect(set.has("a")).toBe(true);
    expect(set.has("b")).toBe(true);
    expect(set.has("c")).toBe(false);
  });
});

describe("sideHasTeam", () => {
  const teamed = new Set(["a", "b", "c"]);
  it("true only when every player on the side is teamed", () => {
    expect(sideHasTeam(["a"], teamed)).toBe(true); // singles, teamed
    expect(sideHasTeam(["a", "b"], teamed)).toBe(true); // 2v2, both teamed
    expect(sideHasTeam(["a", "x"], teamed)).toBe(false); // one teamless
    expect(sideHasTeam(["x"], teamed)).toBe(false); // teamless
  });
});

describe("matchRosterValid", () => {
  const teamed = new Set(["a", "b", "c", "d"]);
  it("filled + both sides teamed → valid", () => {
    expect(matchRosterValid(["a"], ["b"], 1, teamed)).toBe(true);
    expect(matchRosterValid(["a", "b"], ["c", "d"], 2, teamed)).toBe(true);
  });
  it("filled but a side has a teamless player → INVALID (dropped-after-paired)", () => {
    expect(matchRosterValid(["a"], ["x"], 1, teamed)).toBe(false); // side b teamless
    expect(matchRosterValid(["x"], ["b"], 1, teamed)).toBe(false); // side a teamless
    expect(matchRosterValid(["a", "x"], ["c", "d"], 2, teamed)).toBe(false); // one 2v2 member teamless
  });
  it("UNFILLED match → not applicable (true) — never conflate unfilled with teamless", () => {
    expect(matchRosterValid([], [], 1, teamed)).toBe(true);
    expect(matchRosterValid(["a"], [], 1, teamed)).toBe(true); // half-paired
    expect(matchRosterValid(["a"], ["b"], 2, teamed)).toBe(true); // 2v2 but only 1 each
  });
});
