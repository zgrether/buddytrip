import { describe, it, expect } from "vitest";
import {
  isResolved,
  paysOut,
  pickPoints,
  sheetPoints,
  resolvedCount,
  remainingUpside,
  type ScoredSlateGame,
  type ScoredPick,
} from "./pickemScoring";

const g = (id: string, over: Partial<ScoredSlateGame> = {}): ScoredSlateGame => ({
  id,
  result: null,
  multiplier: 1,
  ...over,
});
const p = (id: string, pick: "away" | "home", confidence: number | null): ScoredPick => ({
  slateGameId: id,
  pick,
  confidence,
});

describe("results are FOUR-valued, not two", () => {
  /**
   * The handoff flags the mockup's gap: it models a result as "who won". A
   * suite that only ever sets winners passes against a model that cannot
   * express a push at all — so push and cancelled are exercised as first-class
   * outcomes here, not as an afterthought.
   */

  it("a correct pick scores confidence × multiplier", () => {
    expect(pickPoints(g("a", { result: "away", multiplier: 2 }), p("a", "away", 5), true)).toBe(10);
  });

  it("a wrong pick scores nothing", () => {
    expect(pickPoints(g("a", { result: "home" }), p("a", "away", 5), true)).toBe(0);
  });

  it("PUSH scores zero for everyone — both sides", () => {
    // It happened and nobody won: Alabama −3 covering exactly 3.
    const game = g("a", { result: "push", multiplier: 2 });
    expect(pickPoints(game, p("a", "away", 9), true)).toBe(0);
    expect(pickPoints(game, p("a", "home", 9), true)).toBe(0);
  });

  it("CANCELLED scores zero for everyone — the same arithmetic", () => {
    const game = g("a", { result: "cancelled", multiplier: 2 });
    expect(pickPoints(game, p("a", "away", 9), true)).toBe(0);
    expect(pickPoints(game, p("a", "home", 9), true)).toBe(0);
  });

  it("push and cancelled are the same NUMBER and different FACTS", () => {
    // The arithmetic must not distinguish them...
    const push = g("a", { result: "push" });
    const cancelled = g("a", { result: "cancelled" });
    expect(pickPoints(push, p("a", "away", 7), true)).toBe(
      pickPoints(cancelled, p("a", "away", 7), true)
    );
    // ...and the model must still be able to tell them apart, or the screen
    // could not say which. A single "no winner" value would pass every
    // assertion above and fail the requirement.
    expect(push.result).not.toBe(cancelled.result);
  });

  it("both count as RESOLVED, and neither pays out", () => {
    expect(isResolved(g("a", { result: "push" }))).toBe(true);
    expect(isResolved(g("a", { result: "cancelled" }))).toBe(true);
    expect(paysOut("push")).toBe(false);
    expect(paysOut("cancelled")).toBe(false);
    expect(paysOut("away")).toBe(true);
  });

  it("an unplayed game is not resolved and scores nothing", () => {
    expect(isResolved(g("a"))).toBe(false);
    expect(pickPoints(g("a"), p("a", "away", 9), true)).toBe(0);
  });
});

describe("confidence off — every correct pick is worth one, before weighting", () => {
  it("scores 1, not the stored confidence", () => {
    // `confidence` is null on a confidence-off game (migration 146 forbids a
    // stored 1), so reading it would score zero for everyone.
    expect(pickPoints(g("a", { result: "away" }), p("a", "away", null), false)).toBe(1);
  });

  it("still respects the multiplier", () => {
    expect(pickPoints(g("a", { result: "away", multiplier: 2 }), p("a", "away", null), false)).toBe(2);
  });
});

describe("a missing multiplier reads as 1, never 0", () => {
  it("absent and null both produce a normal game", () => {
    // Spec §2.3 — setting nothing must produce a normal game, and scoring must
    // never branch on whether a multiplier was supplied. Reading `?? 0` here
    // would make every unweighted game worthless and look like a scoring bug.
    expect(pickPoints({ id: "a", result: "away" }, p("a", "away", 4), true)).toBe(4);
    expect(pickPoints(g("a", { result: "away", multiplier: null }), p("a", "away", 4), true)).toBe(4);
  });
});

describe("order does not matter — results land as games finish", () => {
  const slate = [g("t"), g("f1"), g("f2"), g("s")];
  const picks = [p("t", "away", 4), p("f1", "away", 3), p("f2", "home", 2), p("s", "away", 1)];

  it("the total is the same whichever order the results arrive in", () => {
    // The assertion that fails against an implementation assuming slate order.
    // A suite that only enters results in order passes against one that does.
    const outcomes: Record<string, "away" | "home"> = { t: "away", f1: "home", f2: "home", s: "away" };
    const apply = (ids: string[]) =>
      sheetPoints(
        slate.map((x) => (ids.includes(x.id) ? { ...x, result: outcomes[x.id] } : x)),
        picks,
        true
      );

    // Thursday, then two Friday, then Saturday — and the reverse, and a jumble.
    const inOrder = apply(["t", "f1", "f2", "s"]);
    const reversed = apply(["s", "f2", "f1", "t"]);
    const jumbled = apply(["f2", "s", "t", "f1"]);
    expect(reversed).toBe(inOrder);
    expect(jumbled).toBe(inOrder);
    // ...and it is a real number, not zero-equals-zero.
    expect(inOrder).toBe(4 + 0 + 2 + 1);
  });

  it("totals are correct at EVERY intermediate step, not just at the end", () => {
    // The handoff's first test. A partial slate must already be right — the
    // runner reads this after each entry, not once at the end.
    const steps = ["f2", "t", "s"];
    const outcomes: Record<string, "away" | "home"> = { t: "away", f2: "home", s: "away" };
    const running: number[] = [];
    let cur = slate;
    for (const id of steps) {
      cur = cur.map((x) => (x.id === id ? { ...x, result: outcomes[id] } : x));
      running.push(sheetPoints(cur, picks, true));
    }
    expect(running).toEqual([2, 6, 7]);
  });
});

describe("the count is a COUNT — '11 of 16 in', never 'thru 11'", () => {
  it("counts resolved games wherever they sit on the slate", () => {
    // Resolving the LAST game must read 1 of 4, not 4 of 4. An implementation
    // that reported a position would pass a test whose results all landed at
    // the top of the slate.
    const slate = [g("a"), g("b"), g("c"), g("d", { result: "home" })];
    expect(resolvedCount(slate)).toEqual({ resolved: 1, total: 4 });
  });

  it("push and cancelled count as in", () => {
    const slate = [g("a", { result: "push" }), g("b", { result: "cancelled" }), g("c")];
    expect(resolvedCount(slate)).toEqual({ resolved: 2, total: 3 });
  });
});

describe("remainingUpside — why a zero-scoring outcome brings a clinch forward", () => {
  const slate = [g("a"), g("b"), g("c")];
  const picks = [p("a", "away", 3), p("b", "away", 2), p("c", "away", 1)];

  it("counts only what is still unplayed", () => {
    expect(remainingUpside(slate, picks, true)).toBe(6);
  });

  it("a PUSH removes its own upside, exactly as a win would", () => {
    // This is the mechanism behind "a zero-scoring outcome brings a clinch
    // forward": the game stops being something anyone can still gain from.
    const after = slate.map((x) => (x.id === "a" ? { ...x, result: "push" as const } : x));
    expect(remainingUpside(after, picks, true)).toBe(3);
    // ...and nobody scored for it.
    expect(sheetPoints(after, picks, true)).toBe(0);
  });

  it("cancelled does the same", () => {
    const after = slate.map((x) => (x.id === "b" ? { ...x, result: "cancelled" as const } : x));
    expect(remainingUpside(after, picks, true)).toBe(4);
  });

  it("a chaser's ceiling falls below a leader's total — the clinch itself", () => {
    // The two disagree on every game, so one of them banking a game is the
    // other one losing it.
    const leaderPicks = [p("a", "away", 3), p("b", "home", 2), p("c", "home", 1)];
    const chaserPicks = [p("a", "home", 3), p("b", "away", 2), p("c", "away", 1)];

    // Game a goes AWAY: leader banks 3, chaser banks nothing.
    const s0 = slate.map((x) => (x.id === "a" ? { ...x, result: "away" as const } : x));
    expect(sheetPoints(s0, leaderPicks, true)).toBe(3);
    expect(sheetPoints(s0, chaserPicks, true)).toBe(0);
    // Chaser still has b(2) + c(1) = 3 available, so 0 + 3 ties 3 — ALIVE.
    expect(remainingUpside(s0, chaserPicks, true)).toBe(3);
    expect(sheetPoints(s0, chaserPicks, true) + remainingUpside(s0, chaserPicks, true)).toBe(
      sheetPoints(s0, leaderPicks, true)
    );

    // Now PUSH game b. Nobody scores it — and the chaser's ceiling drops to 1.
    const s1 = s0.map((x) => (x.id === "b" ? { ...x, result: "push" as const } : x));
    expect(sheetPoints(s1, chaserPicks, true)).toBe(0);
    expect(sheetPoints(s1, leaderPicks, true)).toBe(3);
    expect(remainingUpside(s1, chaserPicks, true)).toBe(1);
    // 0 + 1 < 3 — settled, with a game still unplayed, and it was a ZERO-SCORING
    // outcome that settled it. That is the whole reason push and cancelled have
    // to stop counting as remaining.
    expect(sheetPoints(s1, chaserPicks, true) + remainingUpside(s1, chaserPicks, true)).toBeLessThan(
      sheetPoints(s1, leaderPicks, true)
    );
  });
});

describe("sheetPoints ignores a pick whose game is not on the slate", () => {
  it("a removed game's orphan pick contributes nothing", () => {
    // The slate can lose a game while picks survive (migration 156 keeps the
    // sheet). Summing a pick with no game would read a `multiplier` off
    // `undefined`.
    expect(sheetPoints([g("a", { result: "away" })], [p("a", "away", 2), p("gone", "away", 9)], true)).toBe(2);
  });
});
