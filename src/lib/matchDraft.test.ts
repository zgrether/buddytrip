import { describe, it, expect } from "vitest";
import { isMatchFilled, filledMatches, allMatchesFilled, matchPlayReady, hasValidMatch, pointsReady, removeMatchRow, flushOnOverlayClose, sideMemberIds, type MatchSides, type ServerSide } from "./matchDraft";

// Readiness rework P1b — the ONE match-play readiness threshold, shared by the
// setup-page Enable gate and the server `isConfigured` so they can't drift.
// Readiness rework P3 — the downstream gate (Points/Handicaps/Modifiers locked
// until a valid match exists).
describe("hasValidMatch (the downstream gate)", () => {
  const s = (a: string[], b: string[]): MatchSides => ({ a, b });
  it("true only when ≥1 match is fully paired", () => {
    expect(hasValidMatch([s(["x"], ["y"])], 1)).toBe(true); // 1 paired
    expect(hasValidMatch([s(["x"], ["y"]), s([], [])], 1)).toBe(true); // ≥1 paired (the other empty)
  });
  it("false at zero paired — incl. a seeded-but-empty match", () => {
    expect(hasValidMatch([s([], [])], 1)).toBe(false); // seeded empty only
    expect(hasValidMatch([s(["x"], [])], 1)).toBe(false); // half-paired only
    expect(hasValidMatch([], 1)).toBe(false);
  });
});

// W-GAMEPAGE Phase C / P-C — points > 0 joins the Enable gate, and it's the SAME
// truth the inline Points row reads for resolved/empty, so they can't disagree.
describe("pointsReady (the points term of the Enable gate)", () => {
  it("true only at points > 0", () => {
    expect(pointsReady(1)).toBe(true);
    expect(pointsReady(3)).toBe(true);
    expect(pointsReady(0)).toBe(false); // the C1 default for a new match game
    expect(pointsReady(-1)).toBe(false);
  });
});

describe("the Enable gate = all matches paired AND points > 0 (C3)", () => {
  const s = (a: string[], b: string[]): MatchSides => ({ a, b });
  const enableReady = (draft: MatchSides[], pps: number, points: number) =>
    allMatchesFilled(draft, pps) && pointsReady(points);
  it("true only when every match is paired AND points > 0", () => {
    expect(enableReady([s(["x"], ["y"])], 1, 3)).toBe(true); // paired + points
  });
  it("false at points 0 even with every match paired", () => {
    expect(enableReady([s(["x"], ["y"])], 1, 0)).toBe(false);
  });
  it("false when a match is unpaired even with points > 0", () => {
    expect(enableReady([s(["x"], ["y"]), s([], [])], 1, 3)).toBe(false);
  });
});

describe("matchPlayReady (the shared threshold)", () => {
  it("ready only when there is ≥1 match AND every match is paired (paired === total)", () => {
    expect(matchPlayReady(5, 5)).toBe(true); // all paired
    expect(matchPlayReady(3, 5)).toBe(false); // partial — was wrongly "ready" on the list before
    expect(matchPlayReady(0, 1)).toBe(false); // a seeded-but-empty match is not ready
    expect(matchPlayReady(0, 0)).toBe(false); // nothing to score
    expect(matchPlayReady(1, 1)).toBe(true);
  });
});

// W-GAMEPAGE-01 §6.1/§7 — the hard-block readiness gate. An empty or half-filled
// match must keep "Enable scoring" disabled (no silent collapse to the filled
// count). These guard the pure rule the setup face derives the gate from.

const singles = (a: string[], b: string[]): MatchSides => ({ a, b });

describe("isMatchFilled", () => {
  it("singles (1 per side): filled only when both sides have a player", () => {
    expect(isMatchFilled(singles(["x"], ["y"]), 1)).toBe(true);
    expect(isMatchFilled(singles([], ["y"]), 1)).toBe(false);
    expect(isMatchFilled(singles(["x"], []), 1)).toBe(false);
    expect(isMatchFilled(singles([], []), 1)).toBe(false);
  });

  it("2v2 (2 per side): a half-filled side is not full strength", () => {
    expect(isMatchFilled(singles(["a", "b"], ["c", "d"]), 2)).toBe(true);
    expect(isMatchFilled(singles(["a"], ["c", "d"]), 2)).toBe(false);
    expect(isMatchFilled(singles(["a", "b"], ["c"]), 2)).toBe(false);
  });
});

describe("filledMatches", () => {
  it("returns only the fully-paired matches, preserving order", () => {
    const draft = [
      singles(["a"], ["b"]),
      singles(["c"], []),
      singles(["d"], ["e"]),
    ];
    const out = filledMatches(draft, 1);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(draft[0]);
    expect(out[1]).toBe(draft[2]);
  });
});

describe("allMatchesFilled (the Enable-scoring gate)", () => {
  it("is FALSE for an empty draft (nothing to score)", () => {
    expect(allMatchesFilled([], 1)).toBe(false);
  });

  it("is TRUE when every match is fully paired", () => {
    expect(allMatchesFilled([singles(["a"], ["b"]), singles(["c"], ["d"])], 1)).toBe(true);
  });

  it("HARD-BLOCKS: a single unfilled slot anywhere disables the gate", () => {
    // The just-added empty match (build-as-you-go) keeps the gate shut...
    expect(allMatchesFilled([singles(["a"], ["b"]), singles([], [])], 1)).toBe(false);
    // ...as does a half-filled trailing match.
    expect(allMatchesFilled([singles(["a"], ["b"]), singles(["c"], [])], 1)).toBe(false);
    // ...and an unfilled match in the MIDDLE (not just the trailing one).
    expect(allMatchesFilled([singles(["a"], ["b"]), singles([], ["x"]), singles(["c"], ["d"])], 1)).toBe(false);
  });

  it("2v2: every side must be at full strength", () => {
    expect(allMatchesFilled([singles(["a", "b"], ["c", "d"])], 2)).toBe(true);
    expect(allMatchesFilled([singles(["a", "b"], ["c"])], 2)).toBe(false);
  });
});

// Setup re-seed: a server side resolves to its member ids by the side's OWN type,
// NOT an ambient sided flag. This is what keeps a 2v2 match from vanishing on
// reopen when matches.listByGame lands before games.getById (so the page's `sided`
// is still its pre-load fallback) — the play_group side must still expand to its
// pair, and a user side must still be itself.
describe("sideMemberIds (type-driven side → member ids)", () => {
  const members = new Map<string, string[]>([
    ["pgA", ["alice", "bob"]],
    ["pgB", ["carol", "dave"]],
  ]);

  it("a user side (1v1) resolves to that single user, regardless of the map", () => {
    const side: ServerSide = { type: "user", id: "alice" };
    expect(sideMemberIds(side, members)).toEqual(["alice"]);
    expect(sideMemberIds(side, new Map())).toEqual(["alice"]); // no play_group lookup needed
  });

  it("a play_group side (2v2) expands to its two members via the map", () => {
    expect(sideMemberIds({ type: "play_group", id: "pgA" }, members)).toEqual(["alice", "bob"]);
    expect(sideMemberIds({ type: "play_group", id: "pgB" }, members)).toEqual(["carol", "dave"]);
  });

  it("an empty slot (null) or unknown play_group resolves to []", () => {
    expect(sideMemberIds(null, members)).toEqual([]);
    // A play_group whose participants haven't loaded yet → empty, never the id itself
    // (the bug: a doubles side was rebuilt as [play_group_id] and read as a user).
    expect(sideMemberIds({ type: "play_group", id: "pgMissing" }, members)).toEqual([]);
  });

  it("a filled 2v2 match reconstructs as two 2-member sides (both fully paired)", () => {
    const a = sideMemberIds({ type: "play_group", id: "pgA" }, members);
    const b = sideMemberIds({ type: "play_group", id: "pgB" }, members);
    expect(isMatchFilled({ a, b }, 2)).toBe(true); // survives the reopen as a real match
  });
});

// Persist-on-CLOSE: closing the settings overlay with a draft editor still open
// (the "assign matches → tap Back" path) must flush the same write a row-collapse
// would — otherwise the pairings are dropped and reopening the game shows no
// matches. flushOnOverlayClose is the pure decision the close effect fires on.
describe("flushOnOverlayClose (persist-on-overlay-close decision)", () => {
  it("flushes the draft when the Matches row is open AND was edited", () => {
    // The exact bug: matches entered, row left open, overlay closed.
    expect(flushOnOverlayClose("matches", true)).toBe("draft");
    expect(flushOnOverlayClose("handicaps", true)).toBe("draft");
  });

  it("does NOT flush the draft for an opened-but-untouched row (no needless churn)", () => {
    // setPairings clean-replaces (new match ids), so skip it when nothing changed.
    expect(flushOnOverlayClose("matches", false)).toBeNull();
    expect(flushOnOverlayClose("handicaps", false)).toBeNull();
  });

  it("flushes modifiers whenever the Modifiers row is open (idempotent games.update)", () => {
    expect(flushOnOverlayClose("modifiers", false)).toBe("modifiers");
    expect(flushOnOverlayClose("modifiers", true)).toBe("modifiers");
  });

  it("no flush for rows that persist elsewhere or need none, or when nothing is open", () => {
    expect(flushOnOverlayClose("course", true)).toBeNull(); // persists via its own editor
    expect(flushOnOverlayClose("config", true)).toBeNull(); // Format·Points saves inline
    expect(flushOnOverlayClose("players", true)).toBeNull(); // read-only echo
    expect(flushOnOverlayClose(null, true)).toBeNull(); // overlay closed with no row open
  });
});

// The "×" action: REMOVE the match at the index. 0 matches is a valid empty state
// (the table hides; only "Add match" shows), so the last match is deletable — no
// floor-clamp.
describe("removeMatchRow (the × action)", () => {
  const m = (a: string[], b: string[], handicap = 0) => ({ a, b, handicap, matchNumber: 0 });

  it("with >1 match, REMOVES the match at the index", () => {
    const draft = [m(["a"], ["b"]), m(["c"], ["d"]), m(["e"], ["f"])];
    const out = removeMatchRow(draft, 1);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(draft[0]); // untouched rows are the same refs
    expect(out[1]).toBe(draft[2]);
  });

  it("with exactly 1 match, DELETES it → an empty draft (0 matches is valid)", () => {
    const draft = [m(["a", "b"], ["c", "d"], 3)];
    const out = removeMatchRow(draft, 0);
    expect(out).toHaveLength(0);
  });

  it("an empty draft reads as NOT ready (Enable still blocked on 0 matches)", () => {
    const empty = removeMatchRow([m(["a"], ["b"])], 0);
    expect(empty).toHaveLength(0);
    expect(allMatchesFilled(empty, 1)).toBe(false); // can't enable an empty game
    expect(hasValidMatch(empty, 1)).toBe(false); // Points/Handicaps/Modifiers stay locked
  });

  it("does not mutate the input draft", () => {
    const draft = [m(["a"], ["b"])];
    const snapshot = JSON.parse(JSON.stringify(draft));
    removeMatchRow(draft, 0);
    expect(draft).toEqual(snapshot);
  });
});
