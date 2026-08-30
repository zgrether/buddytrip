import { describe, it, expect } from "vitest";
import {
  emptySheet,
  fillAll,
  sheetComplete,
  submittablePicks,
  unpickedCount,
  reconcileSheet,
  isCompleteRanking,
  rankedOrder,
  applyOrder,
  setPick,
  slateSetChanged,
  sheetsEqual,
  explanationCopy,
  type SheetPick,
  type SheetSlateGame,
  type SheetSettings,
} from "./pickemSheet";

const slate = (n: number, over: Partial<SheetSlateGame>[] = []): SheetSlateGame[] =>
  Array.from({ length: n }, (_, i) => ({ id: `g${i + 1}`, multiplier: 1, ...(over[i] ?? {}) }));

/**
 * The old default sheet — all home, slate order — as a FIXTURE.
 *
 * The cases below are about ordering, equality and reconciliation, and they
 * need a complete sheet to be about anything. They used to get one from
 * `defaultSheet`, which is gone; building it from the two functions that
 * replaced it keeps them testing what they were written to test, and makes the
 * equivalence those functions promise load-bearing here as well as asserted
 * once above.
 */
const filledSheet = (games: SheetSlateGame[], useConfidence = true): SheetPick[] =>
  fillAll(emptySheet(games, useConfidence), "home");

const ON: SheetSettings = { useConfidence: true, rollUp: "individual_matches" };
const OFF: SheetSettings = { useConfidence: false, rollUp: "individual_matches" };
const TEAM: SheetSettings = { useConfidence: true, rollUp: "team_totals" };

describe("emptySheet — nobody has picks until they submit", () => {
  it("arrives with NOTHING picked, and a ranking anyway", () => {
    /**
     * The two halves are different kinds of thing, which is why one keeps a
     * default and the other loses it. A ranking is an ORDER, and every order is
     * as valid as the next, so the runner's slate order costs nobody an opinion
     * they did not hold. A pick is a CLAIM about a contest, and there is no
     * neutral one — "home" was an opinion the person had not formed, put on
     * their sheet and then scored.
     */
    const s = emptySheet(slate(4));
    expect(s.map((p) => p.pick)).toEqual([null, null, null, null]);
    expect(s.map((p) => p.confidence)).toEqual([4, 3, 2, 1]);
    expect(isCompleteRanking(s.map((p) => p.confidence), 4)).toBe(true);
  });

  it("stores NULL confidence when the game runs with confidence off", () => {
    // Not 1. Sixteen rows storing 1 collide under uq_pickem_picks_confidence.
    expect(emptySheet(slate(3), false).map((p) => p.confidence)).toEqual([null, null, null]);
  });
});

describe("the shortcuts", () => {
  it("ALL HOME reproduces the old default sheet exactly, ranking included", () => {
    /**
     * THE DECISIVE CASE for this whole change being safe. Taking the pre-fill
     * away only costs somebody sixteen taps if the position it represented —
     * a sheet of favourites — is no longer reachable in one. It is, and this
     * asserts the result is identical rather than merely similar: same picks,
     * same ranks, in the same order.
     *
     * Which makes the difference exactly the one intended: somebody chose it.
     */
    const filled = fillAll(emptySheet(slate(4)), "home");
    expect(filled).toEqual([
      { slateGameId: "g1", pick: "home", confidence: 4 },
      { slateGameId: "g2", pick: "home", confidence: 3 },
      { slateGameId: "g3", pick: "home", confidence: 2 },
      { slateGameId: "g4", pick: "home", confidence: 1 },
    ]);
  });

  it("ALL AWAY is the same function, the other way", () => {
    const filled = fillAll(emptySheet(slate(3)), "away");
    expect(filled.map((p) => p.pick)).toEqual(["away", "away", "away"]);
  });

  it("leaves the RANKING alone — including one the person has dragged", () => {
    /**
     * The shortcut is for somebody who does not want to make sixteen calls.
     * Re-ordering their list as a side effect would be a second decision they
     * did not ask for, and it would destroy a ranking they may have spent
     * longer on than the picks.
     *
     * Asserted against a REORDERED sheet, not a fresh one: on a fresh sheet the
     * ranking is already slate order, so a shortcut that reset it would pass.
     */
    const dragged = applyOrder(emptySheet(slate(3)), ["g3", "g1", "g2"]);
    expect(fillAll(dragged, "home").map((p) => p.confidence)).toEqual(
      dragged.map((p) => p.confidence)
    );
  });

  it("overwrites picks already made — it is a shortcut, not a fill-the-gaps", () => {
    // "All home" means all home. Filling only the blanks would leave a sheet
    // that is neither what they had nor what they asked for.
    const half = setPick(emptySheet(slate(3)), "g1", "away");
    expect(fillAll(half, "home").map((p) => p.pick)).toEqual(["home", "home", "home"]);
  });
});

describe("submittablePicks — what there is to send", () => {
  it("DROPS the unpicked games rather than sending them as nulls", () => {
    /**
     * The server cannot store them: `pickem_picks.pick` is NOT NULL, so a row
     * exists only for a game with a pick.
     *
     * Dropping them is also what makes the write a REPLACE — the RPC deletes
     * rows the sheet holds that the payload does not name, so a game left out
     * here is a game whose pick is cleared. Sending nulls would have needed a
     * second convention for the same fact.
     */
    const partial = setPick(setPick(emptySheet(slate(4)), "g1", "away"), "g3", "home");
    expect(submittablePicks(partial)).toEqual([
      { slateGameId: "g1", pick: "away", confidence: 4 },
      { slateGameId: "g3", pick: "home", confidence: 2 },
    ]);
  });

  it("sends nothing at all for a sheet with nothing on it", () => {
    // A legitimate payload: clearing every pick and saving leaves "nothing
    // submitted", which is what the RPC's empty-payload path produces.
    expect(submittablePicks(emptySheet(slate(3)))).toEqual([]);
  });

  it("carries the ranking through untouched", () => {
    const done = fillAll(emptySheet(slate(3)), "away");
    expect(submittablePicks(done)).toEqual([
      { slateGameId: "g1", pick: "away", confidence: 3 },
      { slateGameId: "g2", pick: "away", confidence: 2 },
      { slateGameId: "g3", pick: "away", confidence: 1 },
    ]);
  });

  it("keeps GAPS in the ranks, which is what a partial sheet looks like", () => {
    // The ranking is an order over the SLATE, so a partial sheet's ranks are a
    // subset of 1..N. Migration 166's rank rule is written to admit exactly
    // this, and compacting them here would send something it would refuse.
    const partial = setPick(emptySheet(slate(4)), "g2", "home");
    expect(submittablePicks(partial).map((p) => p.confidence)).toEqual([3]);
  });
});

describe("sheetComplete", () => {
  it("is true only when every game is called", () => {
    expect(sheetComplete(emptySheet(slate(3)))).toBe(false);
    expect(sheetComplete(setPick(emptySheet(slate(3)), "g1", "home"))).toBe(false);
    expect(sheetComplete(fillAll(emptySheet(slate(3)), "home"))).toBe(true);
  });

  it("is false for an empty slate — there is nothing to have completed", () => {
    expect(sheetComplete([])).toBe(false);
  });
});

describe("unpickedCount", () => {
  it("counts what is left, and can go DOWN as well as up", () => {
    // Down matters: a pick can be cleared by tapping it again, so a count that
    // only ever fell would go stale the first time somebody changed their mind.
    const s = emptySheet(slate(4));
    expect(unpickedCount(s)).toBe(4);
    const one = setPick(s, "g1", "home");
    expect(unpickedCount(one)).toBe(3);
    expect(unpickedCount(setPick(one, "g1", null))).toBe(4);
    expect(unpickedCount(fillAll(s, "home"))).toBe(0);
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

  it("a GROWN slate keeps the old picks, leaves the NEW game uncalled, resets the ranking", () => {
    /**
     * This is where the removed default did real harm rather than merely
     * misleading. A runner adding a seventeenth game silently answered it for
     * everybody — the sheet came back reading "home" on a contest nobody had
     * been shown — and the next Save submitted that opinion as theirs.
     *
     * Null now, so the sheet is incomplete, Save is refused, and the person is
     * told how many are left. Which is the honest description of what happened
     * to them: the slate changed and they have one more call to make.
     */
    const stored: SheetPick[] = [
      { slateGameId: "g1", pick: "away", confidence: 2 },
      { slateGameId: "g2", pick: "away", confidence: 1 },
    ];
    const r = reconcileSheet(slate(3), stored, ON);
    expect(r.picks.map((p) => [p.slateGameId, p.pick])).toEqual([
      ["g1", "away"],
      ["g2", "away"],
      ["g3", null],
    ]);
    /**
     * NOT a reset, and this changed with partial sheets.
     *
     * The stored ranks (2 and 1 over a three-game slate) are in range and
     * distinct — a sparse ranking of THIS slate, which is what a partial sheet
     * has. Nothing of the person's ordering was lost: g1 and g2 keep their
     * relative places and the new game slots in where its slate position says.
     * Announcing a reset here would report a loss that did not happen.
     */
    expect(r.rankingReset).toBe(false);
    expect(r.picks.map((p) => p.confidence)).toEqual([3, 2, 1]);
    // ...and it is still incomplete, which is what the count says.
    expect(unpickedCount(r.picks)).toBe(1);
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

  it("tells a rank OUT OF RANGE apart from a sparse one, which is the same trap", () => {
    /**
     * The case above is why the partial rebuild had to be GATED, and this is
     * the pair that pins the distinction.
     *
     * A rank outside 1..N is not a sparse ranking of this slate — it is a
     * ranking of a bigger slate, left behind when games were removed. Sorting
     * by it yields a complete, plausible order nobody chose, which is exactly
     * the compaction this rule has always forbidden.
     *
     * A rank INSIDE 1..N with gaps is a partial sheet and must be kept. The
     * first build of the rebuild re-sorted by any stored rank at all and lost
     * that distinction; the case above caught it.
     */
    const outOfRange = reconcileSheet(
      slate(3),
      [{ slateGameId: "g2", pick: "home", confidence: 9 }],
      ON
    );
    expect(outOfRange.rankingReset).toBe(true);
    expect(outOfRange.picks.map((p) => p.confidence)).toEqual([3, 2, 1]);

    const sparse = reconcileSheet(
      slate(3),
      [{ slateGameId: "g2", pick: "home", confidence: 1 }],
      ON
    );
    expect(sparse.rankingReset).toBe(false);
    /**
     * g2 was ranked 1 — last — and lands at 2 rather than at 1, which is worth
     * pinning because it is the tie-break doing its job rather than the rule
     * failing.
     *
     * Each game sorts by the rank it HAS: g2 by its stored 1, g1 and g3 by
     * their slate-order defaults of 3 and 1. g2 and g3 tie on 1, and slate
     * position breaks it, so the game the person never touched ends up below
     * the one they did. Both statements survive: g2 is below g1, where they put
     * it, and g3 is last, where the slate puts it.
     */
    expect(sparse.picks.map((p) => [p.slateGameId, p.confidence])).toEqual([
      ["g1", 3],
      ["g2", 2],
      ["g3", 1],
    ]);
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
    const s = filledSheet(slate(4));
    expect(rankedOrder(s)).toEqual(["g1", "g2", "g3", "g4"]);
    expect(applyOrder(s, rankedOrder(s))).toEqual(s);
  });

  it("a reorder rewrites the ranks by POSITION", () => {
    const s = filledSheet(slate(3));
    const moved = applyOrder(s, ["g3", "g1", "g2"]);
    const byId = new Map(moved.map((p) => [p.slateGameId, p.confidence]));
    expect(byId.get("g3")).toBe(3);
    expect(byId.get("g1")).toBe(2);
    expect(byId.get("g2")).toBe(1);
    // ...and it is still a legal sheet, which is the property the server checks.
    expect(isCompleteRanking(moved.map((p) => p.confidence), 3)).toBe(true);
  });

  it("setPick changes the winner and NOTHING about the ranking", () => {
    const s = filledSheet(slate(3));
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
    const a = filledSheet(slate(3));
    expect(sheetsEqual(a, [...a].reverse())).toBe(true);
  });

  it("sees a changed winner and a changed rank", () => {
    const a = filledSheet(slate(3));
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

describe("the derived explanation PROSE, not just its ids", () => {
  /**
   * Moved here from `PickemSheet.test.tsx` when the explainer left the sheet
   * for the shared rules surface.
   *
   * Stronger here. Through the sheet they were read off a SLICE of rendered
   * markup, and the first version of one of them sliced the wrong region and
   * passed against an empty string — which is why it carried a positive
   * control. Against the function there is no markup to mis-slice.
   */
  const text = (st: SheetSettings) =>
    explanationCopy(st, slate(3)).map((x) => x.text).join(" ");

  it("drops every ranking sentence with confidence OFF", () => {
    const out = text(OFF);
    expect(out).not.toMatch(/rank/i);
    expect(out).not.toMatch(/coin flip/i);
    expect(out).not.toMatch(/surest/i);
    // The premise: it produced an explanation at all.
    expect(out).toContain("Pick a winner in all 3 games");
  });

  it("drops head-to-head under TEAM TOTALS, and says what replaces it", () => {
    const out = text({ useConfidence: true, rollUp: "team_totals" });
    expect(out).not.toMatch(/head to head/i);
    expect(out).not.toMatch(/one person on the other team/i);
    expect(out).toContain("adds into one team total");
  });

  it("...and carries the load-bearing line under INDIVIDUAL MATCHES", () => {
    // The premise check for the case above — without it, a build producing no
    // head-to-head copy anywhere passes.
    const out = text(ON);
    expect(out).toContain("head to head");
    expect(out).toContain("more certain than they are");
  });
});

describe("slateSetChanged — what invalidates a ranking (migration 156)", () => {
  /**
   * The client half of the test `save_pickem_config` runs as
   * `v_prior IS DISTINCT FROM v_keep`. That one decides whether rankings are
   * DELETED; this one decides whether the runner is warned first. They have to
   * answer the same, which is why the cases below are the same cases the
   * server-side test drives.
   */
  const g = (id: string) => ({ id });
  const SLATE = [g("a"), g("b"), g("c")];

  it("an identical slate has not changed", () => {
    expect(slateSetChanged(SLATE, [g("a"), g("b"), g("c")])).toBe(false);
  });

  it("REORDERING is not a change — a ranking survives it intact", () => {
    // The distinction that keeps this from over-destroying: 1..N is still a
    // permutation of the same N games however they are displayed.
    expect(slateSetChanged(SLATE, [g("c"), g("a"), g("b")])).toBe(false);
  });

  it("editing a game's CONTENT is not a change either", () => {
    // Same ids, different teams/spread/multiplier. Fixing a typo must not cost
    // sixteen people their ranking.
    const edited = [
      { id: "a", awayTeam: "Alabama", multiplier: 3 },
      { id: "b", spread: "-7.5" },
      { id: "c" },
    ];
    expect(slateSetChanged(SLATE, edited)).toBe(false);
  });

  it("REMOVING a game is a change", () => {
    expect(slateSetChanged(SLATE, [g("a"), g("b")])).toBe(true);
  });

  it("ADDING a game is a change", () => {
    expect(slateSetChanged(SLATE, [...SLATE, g("d")])).toBe(true);
  });

  it("SWAPPING one for another is a change, though the count is identical", () => {
    // The case a count-based test would miss, and the reason this compares sets
    // rather than lengths.
    expect(slateSetChanged(SLATE, [g("a"), g("b"), g("d")])).toBe(true);
  });

  it("emptying the slate is a change", () => {
    expect(slateSetChanged(SLATE, [])).toBe(true);
  });

  it("a first slate, from nothing, is a change", () => {
    expect(slateSetChanged([], SLATE)).toBe(true);
  });

  it("two empties have not changed", () => {
    expect(slateSetChanged([], [])).toBe(false);
  });
});
