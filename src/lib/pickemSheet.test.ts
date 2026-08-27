import { describe, it, expect } from "vitest";
import {
  defaultSheet,
  reconcileSheet,
  isCompleteRanking,
  rankedOrder,
  applyOrder,
  setPick,
  sheetsEqual,
  explanationCopy,
  type SheetPick,
  type SheetSlateGame,
  type SheetSettings,
} from "./pickemSheet";

const slate = (n: number, over: Partial<SheetSlateGame>[] = []): SheetSlateGame[] =>
  Array.from({ length: n }, (_, i) => ({ id: `g${i + 1}`, multiplier: 1, ...(over[i] ?? {}) }));

const ON: SheetSettings = { useConfidence: true, rollUp: "individual_matches" };
const OFF: SheetSettings = { useConfidence: false, rollUp: "individual_matches" };
const TEAM: SheetSettings = { useConfidence: true, rollUp: "team_totals" };

describe("defaultSheet", () => {
  it("is complete and valid on arrival — home team, slate order, N..1", () => {
    // Spec §4's whole premise. If this is ever allowed to return something
    // partial, every downstream surface grows a "no picks" branch.
    const s = defaultSheet(slate(4));
    expect(s.map((p) => p.pick)).toEqual(["home", "home", "home", "home"]);
    expect(s.map((p) => p.confidence)).toEqual([4, 3, 2, 1]);
    expect(isCompleteRanking(s.map((p) => p.confidence), 4)).toBe(true);
  });

  it("stores NULL confidence when the game runs with confidence off", () => {
    // Not 1. Sixteen rows storing 1 collide under uq_pickem_picks_confidence.
    expect(defaultSheet(slate(3), false).map((p) => p.confidence)).toEqual([null, null, null]);
  });
});

describe("isCompleteRanking", () => {
  it("accepts exactly 1..N in any order", () => {
    expect(isCompleteRanking([3, 1, 2], 3)).toBe(true);
  });

  it.each([
    ["a hole", [3, 1, null]],
    ["a duplicate", [2, 2, 1]],
    ["out of range", [4, 1, 2]],
    ["a zero", [0, 1, 2]],
    ["a fraction", [1.5, 1, 2]],
    ["the wrong length", [2, 1]],
  ])("rejects %s", (_label, ranks) => {
    expect(isCompleteRanking(ranks as (number | null)[], 3)).toBe(false);
  });
});

describe("reconcileSheet", () => {
  it("a first-time picker gets defaults and is NOT told anything was reset", () => {
    const r = reconcileSheet(slate(3), [], ON);
    expect(r.picks.map((p) => p.confidence)).toEqual([3, 2, 1]);
    expect(r.submitted).toBe(false);
    // They have not had a ranking reset — they have not ranked. Raising the
    // banner here would put "your ranking was cleared" on a sheet nobody has
    // ever opened.
    expect(r.rankingReset).toBe(false);
  });

  it("an intact stored sheet comes back untouched", () => {
    const stored: SheetPick[] = [
      { slateGameId: "g1", pick: "away", confidence: 1 },
      { slateGameId: "g2", pick: "home", confidence: 3 },
      { slateGameId: "g3", pick: "away", confidence: 2 },
    ];
    const r = reconcileSheet(slate(3), stored, ON);
    expect(r.picks).toEqual(stored);
    expect(r).toMatchObject({ rankingReset: false, submitted: true });
  });

  it("REOPEN: winners survive, ranking is re-defaulted, person is told", () => {
    // Migration 150 nulls every confidence on reopen. The picks are the half
    // that must come back — losing those is what the upsert-not-clean-replace
    // decision in 148 exists to prevent, and this is the client half of it.
    const stored: SheetPick[] = [
      { slateGameId: "g1", pick: "away", confidence: null },
      { slateGameId: "g2", pick: "away", confidence: null },
      { slateGameId: "g3", pick: "home", confidence: null },
    ];
    const r = reconcileSheet(slate(3), stored, ON);
    expect(r.picks.map((p) => p.pick)).toEqual(["away", "away", "home"]);
    expect(r.picks.map((p) => p.confidence)).toEqual([3, 2, 1]);
    expect(r.rankingReset).toBe(true);
    expect(r.submitted).toBe(true);
  });

  it("a GROWN slate keeps the old picks, defaults the new game, resets the ranking", () => {
    const stored: SheetPick[] = [
      { slateGameId: "g1", pick: "away", confidence: 2 },
      { slateGameId: "g2", pick: "away", confidence: 1 },
    ];
    const r = reconcileSheet(slate(3), stored, ON);
    expect(r.picks.map((p) => [p.slateGameId, p.pick])).toEqual([
      ["g1", "away"],
      ["g2", "away"],
      ["g3", "home"],
    ]);
    expect(r.rankingReset).toBe(true);
  });

  it("does NOT compact a partial ranking into a plausible one", () => {
    // The specific thing HANDOFF §7.2 forbids. Ranks 4,3,1 over a 3-game slate
    // are salvageable-looking — compacting to 3,2,1 preserves relative order and
    // is exactly wrong: it is a ranking nobody chose, indistinguishable from one
    // they did.
    //
    // The assertion is on the ORDER, not just the values: 3,2,1 is what BOTH
    // the correct default and the forbidden compaction produce for THIS input,
    // so the input is chosen so they differ — the stored order is g3 > g2 > g1
    // reversed against the slate.
    const stored: SheetPick[] = [
      { slateGameId: "g1", pick: "home", confidence: 1 },
      { slateGameId: "g2", pick: "home", confidence: 3 },
      { slateGameId: "g3", pick: "home", confidence: 4 },
    ];
    const r = reconcileSheet(slate(3), stored, ON);
    // Compaction would have produced [1, 2, 3] here. Slate order produces [3, 2, 1].
    expect(r.picks.map((p) => p.confidence)).toEqual([3, 2, 1]);
    expect(r.rankingReset).toBe(true);
  });

  it("confidence OFF never reports a ranking reset, whatever is stored", () => {
    // A banner about a ranking on a screen with no ranking is §5's falsehood
    // rule one layer down.
    const stored: SheetPick[] = [
      { slateGameId: "g1", pick: "away", confidence: null },
      { slateGameId: "g2", pick: "home", confidence: null },
      { slateGameId: "g3", pick: "home", confidence: null },
    ];
    const r = reconcileSheet(slate(3), stored, OFF);
    expect(r.rankingReset).toBe(false);
    expect(r.picks.every((p) => p.confidence === null)).toBe(true);
    expect(r.picks.map((p) => p.pick)).toEqual(["away", "home", "home"]);
  });

  it("a shrunk slate drops the removed game entirely", () => {
    const stored: SheetPick[] = [
      { slateGameId: "g1", pick: "away", confidence: 2 },
      { slateGameId: "gone", pick: "away", confidence: 1 },
    ];
    const r = reconcileSheet(slate(1), stored, ON);
    expect(r.picks).toEqual([{ slateGameId: "g1", pick: "away", confidence: 1 }]);
  });
});

describe("rankedOrder / applyOrder", () => {
  it("round-trips: order out, order back in, same ranks", () => {
    const s = defaultSheet(slate(4));
    expect(rankedOrder(s)).toEqual(["g1", "g2", "g3", "g4"]);
    expect(applyOrder(s, rankedOrder(s))).toEqual(s);
  });

  it("a reorder rewrites the ranks by POSITION", () => {
    const s = defaultSheet(slate(3));
    const moved = applyOrder(s, ["g3", "g1", "g2"]);
    const byId = new Map(moved.map((p) => [p.slateGameId, p.confidence]));
    expect(byId.get("g3")).toBe(3);
    expect(byId.get("g1")).toBe(2);
    expect(byId.get("g2")).toBe(1);
    // ...and it is still a legal sheet, which is the property the server checks.
    expect(isCompleteRanking(moved.map((p) => p.confidence), 3)).toBe(true);
  });

  it("setPick changes the winner and NOTHING about the ranking", () => {
    const s = defaultSheet(slate(3));
    const after = setPick(s, "g2", "away");
    expect(after.find((p) => p.slateGameId === "g2")).toEqual({
      slateGameId: "g2",
      pick: "away",
      confidence: 2,
    });
    expect(after.map((p) => p.confidence)).toEqual(s.map((p) => p.confidence));
  });
});

describe("sheetsEqual", () => {
  it("is insensitive to array order — the drag list reorders without editing", () => {
    const a = defaultSheet(slate(3));
    expect(sheetsEqual(a, [...a].reverse())).toBe(true);
  });

  it("sees a changed winner and a changed rank", () => {
    const a = defaultSheet(slate(3));
    expect(sheetsEqual(a, setPick(a, "g1", "away"))).toBe(false);
    expect(sheetsEqual(a, applyOrder(a, ["g2", "g1", "g3"]))).toBe(false);
  });
});

describe("explanationCopy", () => {
  const ids = (s: SheetSettings, sl = slate(3)) => explanationCopy(s, sl).map((p) => p.id);

  it("confidence ON + individual matches is the full version", () => {
    expect(ids(ON)).toEqual(["how-to-pick", "scoring", "head-to-head", "edge"]);
    const edge = explanationCopy(ON, slate(3)).find((p) => p.id === "edge")!;
    // The load-bearing sentence (HANDOFF §5). Asserted as text because it is the
    // one line that explains why the game is interesting, and losing it to a
    // reword would not fail anything else here.
    expect(edge.text).toContain("more certain than they are");
  });

  it("confidence OFF drops every ranking sentence", () => {
    const paras = explanationCopy(OFF, slate(3));
    const all = paras.map((p) => p.text).join(" ");
    // Asserted on the WORDS, not on which paragraph ids survive: the off variant
    // keeps `how-to-pick` and `edge`, so an id-only check would pass against a
    // build that kept the on-variant prose inside them.
    expect(all).not.toMatch(/rank/i);
    expect(all).not.toMatch(/confiden/i);
    expect(all).not.toMatch(/coin flip/i);
    expect(all).toContain("right where they're wrong");
  });

  it("team totals drops every head-to-head sentence", () => {
    const paras = explanationCopy(TEAM, slate(3));
    expect(paras.map((p) => p.id)).not.toContain("head-to-head");
    expect(paras.map((p) => p.id)).not.toContain("edge");
    expect(paras.map((p) => p.id)).toContain("team-totals");
    const all = paras.map((p) => p.text).join(" ");
    expect(all).not.toMatch(/head to head/i);
    expect(all).not.toMatch(/one person/i);
  });

  it("says nothing about multipliers or spreads when the slate has none", () => {
    // Same rule as the two above, applied to the SLATE rather than the settings:
    // a paragraph explaining 2× on a slate with no 2× game is a rule about
    // nothing, and this is the common case.
    expect(ids(ON)).not.toContain("multipliers");
    expect(ids(ON)).not.toContain("spreads");
  });

  it("...and explains them the moment one game has one", () => {
    // The premise check for the test above: prove the paragraphs CAN appear, or
    // "not present" is satisfied by a function that never emits them at all.
    const withBoth = slate(3, [{ multiplier: 2 }, { spread: "-3.5" }]);
    expect(ids(ON, withBoth)).toContain("multipliers");
    expect(ids(ON, withBoth)).toContain("spreads");
  });
});
