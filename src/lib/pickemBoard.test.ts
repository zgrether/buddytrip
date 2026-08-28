import { describe, it, expect } from "vitest";
import {
  buildBoardRows,
  matchStanding,
  upsideFor,
  sideStanding,
  sideClinched,
} from "./pickemBoard";
import type { ScoredPick, ScoredSlateGame } from "./pickemScoring";

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
const rows = (
  slate: ScoredSlateGame[],
  a: ScoredPick[],
  b: ScoredPick[],
  conf = true
) => buildBoardRows(slate, a, b, conf);

/**
 * Three of these are written to fail against a plausible WRONG build, which is
 * the handoff's framing:
 *
 *   - a suite with every multiplier at 1 passes against a board that ignores
 *     multipliers
 *   - a suite that only sets winners passes against a display that cannot tell
 *     push from cancelled
 *   - (the `started` half lives in `gameStartedView.test.ts`)
 */

describe("swing — the design point of the detail view", () => {
  it("SAME pick, different confidence → the swing is the DIFFERENCE", () => {
    // Both took the winner. One at 16, one at 3, so 13 moves — not 16, and not
    // nothing. A board that only scored "who was right" would show zero here
    // and hide where the match is actually being won.
    const slate = [g("x", { result: "away" })];
    const [r] = rows(slate, [p("x", "away", 16)], [p("x", "away", 3)]);
    expect(r.aPoints).toBe(16);
    expect(r.bPoints).toBe(3);
    expect(r.swing).toBe(13);
    expect(r.zeroKind).toBeNull();
  });

  it("DIFFERENT picks → the winner's full rank swings", () => {
    const slate = [g("x", { result: "home" })];
    const [r] = rows(slate, [p("x", "away", 9)], [p("x", "home", 4)]);
    expect(r.swing).toBe(-4);
  });

  it("a 2× game DOUBLES the swing", () => {
    // The assertion that fails against a board ignoring multipliers. A suite
    // with every multiplier at 1 would never notice.
    const plain = rows([g("x", { result: "away" })], [p("x", "away", 8)], [p("x", "home", 2)]);
    const doubled = rows(
      [g("x", { result: "away", multiplier: 2 })],
      [p("x", "away", 8)],
      [p("x", "home", 2)]
    );
    expect(plain[0].swing).toBe(8);
    expect(doubled[0].swing).toBe(16);
  });

  it("a 2× game doubles the UNPLAYED upside too", () => {
    const [r] = rows([g("x", { multiplier: 2 })], [p("x", "away", 5)], [p("x", "home", 3)]);
    expect(r.upsideA).toBe(10);
    expect(r.upsideB).toBe(6);
  });
});

describe("the THREE kinds of zero — three facts, three labels", () => {
  /**
   * A dash already means "both right or both wrong". Push and cancelled also
   * produce zero and are different facts — one happened and nobody covered, the
   * other never happened. A suite that only sets winners passes against a
   * display that cannot tell them apart.
   */

  it("BOTH right and exactly level → 'both'", () => {
    const [r] = rows([g("x", { result: "away" })], [p("x", "away", 7)], [p("x", "away", 7)]);
    expect(r.swing).toBe(0);
    expect(r.zeroKind).toBe("both");
  });

  it("BOTH wrong → 'neither'", () => {
    const [r] = rows([g("x", { result: "home" })], [p("x", "away", 7)], [p("x", "away", 2)]);
    expect(r.swing).toBe(0);
    expect(r.zeroKind).toBe("neither");
  });

  it("PUSH → 'push', whatever they picked", () => {
    const same = rows([g("x", { result: "push" })], [p("x", "away", 9)], [p("x", "away", 1)]);
    const diff = rows([g("x", { result: "push" })], [p("x", "away", 9)], [p("x", "home", 1)]);
    expect(same[0].zeroKind).toBe("push");
    expect(diff[0].zeroKind).toBe("push");
    expect(diff[0].swing).toBe(0);
  });

  it("CANCELLED → 'cancelled', and never the same label as a push", () => {
    const push = rows([g("x", { result: "push" })], [p("x", "away", 9)], [p("x", "home", 1)]);
    const cancelled = rows(
      [g("x", { result: "cancelled" })],
      [p("x", "away", 9)],
      [p("x", "home", 1)]
    );
    expect(cancelled[0].zeroKind).toBe("cancelled");
    // Same arithmetic...
    expect(cancelled[0].swing).toBe(push[0].swing);
    // ...and never the same label. A single "no result" value would satisfy the
    // line above and fail the requirement.
    expect(cancelled[0].zeroKind).not.toBe(push[0].zeroKind);
  });

  it("all four are distinguishable from each other", () => {
    const kinds = [
      rows([g("x", { result: "away" })], [p("x", "away", 7)], [p("x", "away", 7)])[0].zeroKind,
      rows([g("x", { result: "home" })], [p("x", "away", 7)], [p("x", "away", 2)])[0].zeroKind,
      rows([g("x", { result: "push" })], [p("x", "away", 7)], [p("x", "home", 2)])[0].zeroKind,
      rows([g("x", { result: "cancelled" })], [p("x", "away", 7)], [p("x", "home", 2)])[0].zeroKind,
    ];
    expect(new Set(kinds).size).toBe(4);
  });

  it("an UNPLAYED row has no zeroKind — it is not a kind of zero", () => {
    // It has not produced anything yet, which is a fifth state and must not
    // borrow one of the four labels.
    const [r] = rows([g("x")], [p("x", "away", 7)], [p("x", "home", 2)]);
    expect(r.zeroKind).toBeNull();
    expect(r.swing).toBe(0);
  });
});

describe("unplayed upside — agreement collapses the stake", () => {
  it("SAME pick → only the DIFFERENCE is in play, not the max", () => {
    // The handoff's explicit case. They both bank or both miss, so the only
    // thing that can move is the gap between their ranks. Reporting 12 / 5
    // would overstate what is on the table — the number a reader uses to judge
    // whether a match is still live.
    expect(upsideFor("away", "away", 12, 5, 1)).toEqual({ upsideA: 7, upsideB: 0 });
    expect(upsideFor("home", "home", 4, 11, 1)).toEqual({ upsideA: 0, upsideB: 7 });
  });

  it("DIFFERENT picks → each stands to gain their full rank", () => {
    expect(upsideFor("away", "home", 12, 5, 1)).toEqual({ upsideA: 12, upsideB: 5 });
  });

  it("agreeing at the SAME rank puts nothing in play", () => {
    expect(upsideFor("away", "away", 8, 8, 1)).toEqual({ upsideA: 0, upsideB: 0 });
  });
});

describe("margin, remaining and the clinch", () => {
  const slate = [g("a"), g("b"), g("c"), g("d")];
  const A = [p("a", "away", 4), p("b", "away", 3), p("c", "away", 2), p("d", "away", 1)];
  const B = [p("a", "home", 4), p("b", "home", 3), p("c", "home", 2), p("d", "home", 1)];

  const withResults = (r: Partial<Record<string, "away" | "home" | "push" | "cancelled">>) =>
    slate.map((x) => (r[x.id] ? { ...x, result: r[x.id]! } : x));

  it("reports the margin and what is left", () => {
    const s = matchStanding(rows(withResults({ a: "away", b: "away" }), A, B));
    expect(s.aTotal).toBe(7);
    expect(s.bTotal).toBe(0);
    expect(s.margin).toBe(7);
    expect(s.remaining).toBe(2);
  });

  it("does NOT clinch while the trailing side can still catch up", () => {
    // A leads 7–0 with c(2) and d(1) left: B can still make 3, which is less
    // than 7 — so this one IS clinched. Use a tighter case for the negative.
    const s = matchStanding(rows(withResults({ a: "away" }), A, B));
    // A up 4, B can still make 3+2+1 = 6. Not settled.
    expect(s.margin).toBe(4);
    expect(s.trailingUpside).toBe(6);
    expect(s.clinched).toBe(false);
  });

  it("clinches when the lead exceeds what the trailing side can still score", () => {
    const s = matchStanding(rows(withResults({ a: "away", b: "away" }), A, B));
    expect(s.margin).toBe(7);
    expect(s.trailingUpside).toBe(3);
    expect(s.clinched).toBe(true);
  });

  it("A CANCELLED GAME BRINGS THE CLINCH FORWARD", () => {
    // The handoff's named case, and the reason push/cancelled must stop
    // counting as remaining. A leads 4 with 6 still available to B — alive.
    const alive = matchStanding(rows(withResults({ a: "away" }), A, B));
    expect(alive.clinched).toBe(false);

    // Cancel the biggest thing B had left. Nobody scores it, and B's ceiling
    // drops from 6 to 3 — now less than the 4-point lead.
    const settled = matchStanding(rows(withResults({ a: "away", b: "cancelled" }), A, B));
    expect(settled.margin).toBe(4);
    expect(settled.trailingUpside).toBe(3);
    expect(settled.clinched).toBe(true);
    // ...and it was a ZERO-scoring outcome that did it.
    expect(settled.aTotal).toBe(alive.aTotal);
  });

  it("a PUSH does the same", () => {
    const s = matchStanding(rows(withResults({ a: "away", b: "push" }), A, B));
    expect(s.clinched).toBe(true);
  });

  it("a FINISHED match is decided, not clinched", () => {
    // Calling a settled result "clinched" puts a live-sounding word on a game
    // that is over.
    const s = matchStanding(
      rows(withResults({ a: "away", b: "away", c: "away", d: "away" }), A, B)
    );
    expect(s.remaining).toBe(0);
    expect(s.clinched).toBe(false);
    expect(s.margin).toBe(10);
  });

  it("level with games left is neither clinched nor decided", () => {
    const s = matchStanding(rows(withResults({ a: "push" }), A, B));
    expect(s.margin).toBe(0);
    expect(s.clinched).toBe(false);
  });

  it("results in NON-SLATE order give the same standing", () => {
    // Order is a property of the display, never of the arithmetic.
    const forwards = matchStanding(rows(withResults({ a: "away", b: "home", c: "away" }), A, B));
    const backwards = matchStanding(rows(withResults({ c: "away", b: "home", a: "away" }), A, B));
    expect(backwards).toEqual(forwards);
    expect(forwards.margin).toBe(4 + -3 + 2);
  });
});

describe("non-submitters score from defaults and appear normally", () => {
  it("an absent sheet reads as home picks worth nothing, not as a crash", () => {
    // §6 — they appear normally. A missing pick must not throw, and must not
    // silently drop the row from the board either.
    const slate = [g("x", { result: "home" }), g("y", { result: "away" })];
    const built = rows(slate, [p("x", "home", 5), p("y", "away", 3)], []);
    expect(built).toHaveLength(2);
    expect(built[0].bPick).toBe("home");
    // Defaulted to home and home won — but with no stored confidence the rank
    // is 0, so they bank nothing. That is the honest reading of "never picked".
    expect(built[0].bPoints).toBe(0);
    expect(built[0].swing).toBe(5);
  });
});

describe("team totals", () => {
  const slate = [g("a", { result: "away" }), g("b"), g("c", { result: "push" })];
  const sheetOne = [p("a", "away", 3), p("b", "away", 2), p("c", "away", 1)];
  const sheetTwo = [p("a", "home", 3), p("b", "away", 1), p("c", "home", 2)];

  it("sums every sheet on the side, and counts only unplayed toward upside", () => {
    const s = sideStanding(slate, [sheetOne, sheetTwo], true);
    // Banked: sheetOne's a(3). sheetTwo missed a; c was a push so nobody banks.
    expect(s.total).toBe(3);
    // Still available: b only — 2 + 1.
    expect(s.upside).toBe(3);
  });

  it("clinches on the same rule as a match", () => {
    const lead = { total: 10, upside: 2 };
    const chase = { total: 4, upside: 5 };
    expect(sideClinched(lead, chase, 3)).toBe(true);
    expect(sideClinched(lead, { total: 4, upside: 7 }, 3)).toBe(false);
  });

  it("never clinches with nothing left", () => {
    expect(sideClinched({ total: 10, upside: 0 }, { total: 4, upside: 0 }, 0)).toBe(false);
  });

  it("a push removes its own upside from the ceiling", () => {
    // Which is what lets a zero-scoring outcome settle a side match too.
    const unplayed = sideStanding([g("a"), g("b")], [[p("a", "away", 5), p("b", "away", 4)]], true);
    expect(unplayed.upside).toBe(9);
    const pushed = sideStanding(
      [g("a", { result: "push" }), g("b")],
      [[p("a", "away", 5), p("b", "away", 4)]],
      true
    );
    expect(pushed.upside).toBe(4);
    expect(pushed.total).toBe(0);
  });
});

describe("confidence off", () => {
  it("every correct pick is worth one, and the swing follows", () => {
    const [r] = rows([g("x", { result: "away" })], [p("x", "away", null)], [p("x", "home", null)], false);
    expect(r.swing).toBe(1);
  });

  it("upside is one per game, not zero", () => {
    // Reading the null confidence would put every unplayed game at 0 upside and
    // clinch every match immediately.
    const [r] = rows([g("x")], [p("x", "away", null)], [p("x", "home", null)], false);
    expect(r.upsideA).toBe(1);
    expect(r.upsideB).toBe(1);
  });
});
