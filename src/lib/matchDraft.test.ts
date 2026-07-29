import { describe, it, expect } from "vitest";
import { assignInDraft, isMatchFilled, filledMatches, allMatchesFilled, matchPlayReady, hasValidMatch, pointsReady, removeMatchRow, sideMemberIds, type MatchSides, type ServerSide } from "./matchDraft";

// Readiness rework P1b — the ONE match-play readiness threshold, shared by the
// setup-page Enable gate and the server `isConfigured` so they can't drift.
// Readiness rework P3 — the downstream gate (Points/Handicaps/Modifiers locked
// until a valid match exists).
describe("hasValidMatch (the downstream gate)", () => {
  const s = (a: string[], b: string[]): MatchSides => ({ playersPerSide: (Math.max(a.length, b.length) || 1) as 1 | 2, a, b });
  it("true only when ≥1 match is fully paired", () => {
    expect(hasValidMatch([s(["x"], ["y"])])).toBe(true); // 1 paired
    expect(hasValidMatch([s(["x"], ["y"]), s([], [])])).toBe(true); // ≥1 paired (the other empty)
  });
  it("false at zero paired — incl. a seeded-but-empty match", () => {
    expect(hasValidMatch([s([], [])])).toBe(false); // seeded empty only
    expect(hasValidMatch([s(["x"], [])])).toBe(false); // half-paired only
    expect(hasValidMatch([])).toBe(false);
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
  const s = (a: string[], b: string[]): MatchSides => ({ playersPerSide: (Math.max(a.length, b.length) || 1) as 1 | 2, a, b });
  const enableReady = (draft: MatchSides[], pps: number, points: number) =>
    allMatchesFilled(draft) && pointsReady(points);
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

const singles = (a: string[], b: string[]): MatchSides => ({ playersPerSide: (Math.max(a.length, b.length) || 1) as 1 | 2, a, b });

describe("isMatchFilled", () => {
  it("singles (1 per side): filled only when both sides have a player", () => {
    expect(isMatchFilled(singles(["x"], ["y"]))).toBe(true);
    expect(isMatchFilled(singles([], ["y"]))).toBe(false);
    expect(isMatchFilled(singles(["x"], []))).toBe(false);
    expect(isMatchFilled(singles([], []))).toBe(false);
  });

  it("2v2 (2 per side): a half-filled side is not full strength", () => {
    expect(isMatchFilled(singles(["a", "b"], ["c", "d"]))).toBe(true);
    expect(isMatchFilled(singles(["a"], ["c", "d"]))).toBe(false);
    expect(isMatchFilled(singles(["a", "b"], ["c"]))).toBe(false);
  });
});

describe("filledMatches", () => {
  it("returns only the fully-paired matches, preserving order", () => {
    const draft = [
      singles(["a"], ["b"]),
      singles(["c"], []),
      singles(["d"], ["e"]),
    ];
    const out = filledMatches(draft);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(draft[0]);
    expect(out[1]).toBe(draft[2]);
  });
});

describe("allMatchesFilled (the Enable-scoring gate)", () => {
  it("is FALSE for an empty draft (nothing to score)", () => {
    expect(allMatchesFilled([])).toBe(false);
  });

  it("is TRUE when every match is fully paired", () => {
    expect(allMatchesFilled([singles(["a"], ["b"]), singles(["c"], ["d"])])).toBe(true);
  });

  it("HARD-BLOCKS: a single unfilled slot anywhere disables the gate", () => {
    // The just-added empty match (build-as-you-go) keeps the gate shut...
    expect(allMatchesFilled([singles(["a"], ["b"]), singles([], [])])).toBe(false);
    // ...as does a half-filled trailing match.
    expect(allMatchesFilled([singles(["a"], ["b"]), singles(["c"], [])])).toBe(false);
    // ...and an unfilled match in the MIDDLE (not just the trailing one).
    expect(allMatchesFilled([singles(["a"], ["b"]), singles([], ["x"]), singles(["c"], ["d"])])).toBe(false);
  });

  it("2v2: every side must be at full strength", () => {
    expect(allMatchesFilled([singles(["a", "b"], ["c", "d"])])).toBe(true);
    expect(allMatchesFilled([singles(["a", "b"], ["c"])])).toBe(false);
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
    expect(isMatchFilled({ playersPerSide: 2, a, b })).toBe(true); // survives the reopen as a real match
  });
});

// The "×" action: REMOVE the match at the index. 0 matches is a valid empty state
// (the table hides; only "Add match" shows), so the last match is deletable — no
// floor-clamp.
describe("removeMatchRow (the × action)", () => {
  const m = (a: string[], b: string[], handicap = 0) => ({ playersPerSide: (Math.max(a.length, b.length) || 1) as 1 | 2, a, b, handicap, matchNumber: 0 });

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
    expect(allMatchesFilled(empty)).toBe(false); // can't enable an empty game
    expect(hasValidMatch(empty)).toBe(false); // Points/Handicaps/Modifiers stay locked
  });

  it("does not mutate the input draft", () => {
    const draft = [m(["a"], ["b"])];
    const snapshot = JSON.parse(JSON.stringify(draft));
    removeMatchRow(draft, 0);
    expect(draft).toEqual(snapshot);
  });
});

// ── assignInDraft — one player, one match (#708) ─────────────────────────────
// A player may be in exactly one match per game. It is enforced at the DB by
// `game_participants_game_id_user_id_key UNIQUE (game_id, user_id)` (migration 033),
// and `_write_game_side` plain-INSERTs each side of each match — so a draft holding
// someone twice doesn't render wrong, it fails the save with 23505.
//
// These two cases are the regression: both FAIL on main, both are deterministic
// (not races — this is a pure function applied in a single setDraft), and both are
// reachable because the picker lists already-assigned players under "Already in a
// match" and keeps them clickable on purpose — that IS the reassign affordance.
type AM = { playersPerSide: 1 | 2; a: string[]; b: string[]; handicap: number };
const m = (playersPerSide: 1 | 2, a: string[], b: string[], handicap = 0): AM => ({
  playersPerSide, a, b, handicap,
});
/** Every id appearing in more than one side across the whole draft. */
const duplicatesIn = (draft: AM[]): string[] => {
  const seen = new Map<string, number>();
  for (const match of draft) for (const u of [...match.a, ...match.b]) seen.set(u, (seen.get(u) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([u]) => u);
};

describe("assignInDraft — the one-match invariant", () => {
  /**
   * REGRESSION 1 — the same-match slot swap. The old singles branch opened its
   * removal pass with `if (i === matchIdx) return`, skipping the target match. So
   * moving a player into the OTHER SLOT of the match they were already in never
   * removed them, and the draft carried them on both sides of one match: a player
   * playing himself.
   */
  it("moving a player to the other slot of the SAME match does not duplicate them", () => {
    const before = [m(1, ["rob"], ["ann"])];
    const after = assignInDraft(before, 0, "b", 0, "rob");
    expect(duplicatesIn(after)).toEqual([]);
    expect(after[0].a).toEqual([]); // vacated
    expect(after[0].b).toEqual(["rob"]);
  });

  /**
   * REGRESSION 2 — a MIXED game (Refactor A1: 1v1 and 2v2 in one game). The old
   * singles branch only inspected `d.a[0]` / `d.b[0]`, so a player sitting at index
   * 1 of a 2v2 side was invisible to it and stayed there. This is the true
   * cross-match duplicate — one person genuinely in two matches.
   */
  it("pulling a player out of index>0 of a 2v2 side into a singles slot removes them from the 2v2", () => {
    const before = [m(1, ["ann"], ["bob"]), m(2, ["cat", "rob"], ["dan", "eve"])];
    const after = assignInDraft(before, 0, "a", 0, "rob");
    expect(duplicatesIn(after)).toEqual([]);
    expect(after[0].a).toEqual(["rob"]);
    expect(after[1].a).toEqual(["cat"]); // rob pulled out of the 2v2 side
  });

  it("removes from index>0 of a 2v2 side regardless of which slot they sat in", () => {
    const before = [m(1, ["ann"], ["bob"]), m(2, ["cat", "dan"], ["eve", "rob"])];
    const after = assignInDraft(before, 0, "b", 0, "rob");
    expect(duplicatesIn(after)).toEqual([]);
    expect(after[1].b).toEqual(["eve"]);
  });

  // ── behaviour that must NOT change ────────────────────────────────────────
  it("a normal cross-match move still moves, and clears the vacated match's handicap", () => {
    const before = [m(1, ["ann"], ["bob"]), m(1, ["rob"], ["dan"], -3)];
    const after = assignInDraft(before, 0, "a", 0, "rob");
    expect(duplicatesIn(after)).toEqual([]);
    expect(after[0].a).toEqual(["rob"]);
    expect(after[1].a).toEqual([]);
    expect(after[1].handicap).toBe(0); // the pairing it described is gone
  });

  it("the TARGET match keeps its handicap — singles now agrees with doubles", () => {
    const before = [m(1, ["ann"], ["bob"], -2), m(1, ["rob"], ["dan"])];
    const after = assignInDraft(before, 0, "a", 0, "rob");
    expect(after[0].handicap).toBe(-2);
  });

  it("singles assignment REPLACES the slot's occupant (one per slot)", () => {
    const after = assignInDraft([m(1, ["ann"], ["bob"])], 0, "a", 0, "rob");
    expect(after[0].a).toEqual(["rob"]);
    expect(after[0].b).toEqual(["bob"]);
  });

  it("2v2 fills the requested member position, appending past the end", () => {
    const after = assignInDraft([m(2, ["cat"], ["dan", "eve"])], 0, "a", 1, "rob");
    expect(after[0].a).toEqual(["cat", "rob"]);
    expect(duplicatesIn(after)).toEqual([]);
  });

  it("a 2v2 cross-match pull leaves the source side short, never duplicated", () => {
    const before = [m(2, ["cat", "dan"], ["eve", "fay"]), m(2, ["gil", "hal"], ["ivy", "jan"])];
    const after = assignInDraft(before, 1, "a", 0, "cat");
    expect(duplicatesIn(after)).toEqual([]);
    expect(after[0].a).toEqual(["dan"]);
    expect(after[1].a).toEqual(["cat", "hal"]);
  });

  it("is pure — never mutates the input draft", () => {
    const before = [m(1, ["rob"], ["ann"])];
    const snapshot = JSON.parse(JSON.stringify(before));
    assignInDraft(before, 0, "b", 0, "rob");
    expect(before).toEqual(snapshot);
  });

  /**
   * The invariant, stated as a property rather than a case list: from any starting
   * draft, ANY single assignment leaves no player in two places. This is what the
   * DB constraint enforces and what `_write_game_side` depends on.
   */
  it("PROPERTY — no assignment on any draft shape can produce a duplicate", () => {
    const drafts: AM[][] = [
      [m(1, ["rob"], ["ann"])],
      [m(2, ["rob", "cat"], ["ann", "bob"])],
      [m(1, ["ann"], ["bob"]), m(2, ["cat", "rob"], ["dan", "eve"])],
      [m(2, ["cat", "rob"], ["dan", "eve"]), m(1, ["ann"], ["bob"])],
      [m(1, ["ann"], []), m(1, [], ["rob"])],
    ];
    const users = ["rob", "ann", "bob", "cat", "dan", "eve"];
    for (const draft of drafts) {
      for (let i = 0; i < draft.length; i++) {
        for (const slot of ["a", "b"] as const) {
          for (let mi = 0; mi < 2; mi++) {
            for (const u of users) {
              const after = assignInDraft(draft, i, slot, mi, u);
              expect({ draft: i, slot, mi, u, dupes: duplicatesIn(after) }).toEqual({
                draft: i, slot, mi, u, dupes: [],
              });
            }
          }
        }
      }
    }
  });
});
