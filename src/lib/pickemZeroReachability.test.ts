import { describe, it, expect } from "vitest";
import { buildBoardRows, type BoardRow } from "./pickemBoard";
import type { ScoredPick, ScoredSlateGame } from "./pickemScoring";

/**
 * r7 §15 — VERIFY: can two CORRECT picks ever render as a zero case?
 *
 * The report is that two correct picks at different confidences appeared to
 * resolve as a push, with the reporter unsure they read it right. Both-correct-
 * at-the-SAME-rank is a legitimate zero, so the two look alike in a screenshot
 * and only one of them would be a bug.
 *
 * This is a REACHABILITY question, so it is answered by enumeration rather than
 * by argument: every combination of ranks and multipliers over the outcomes that
 * pay, asserting the swing.
 *
 * ── The answer ─────────────────────────────────────────────────────────────
 *
 * Not reachable at DIFFERENT ranks: the swing is exactly the difference, so it
 * is zero only when the ranks are equal. And never a PUSH under any ranks —
 * `push` is a fact about the game, checked before anything about the sheets, and
 * it makes both picks wrong by definition.
 *
 * One zero IS reachable with both correct, and it is honest:
 *   · equal ranks → `both`, the ordinary agreed-and-right row
 *
 * A second case was reachable here once and is not any more. Both ranks NULL
 * used to score nothing (`pickPoints` read `confidence ?? 0`), so a wiped or
 * never-ranked sheet paid zero for every correct pick and read exactly like the
 * legitimate zero above — worse, the chips render as absent rather than as `0`,
 * so the row showed two team names, no ranks, and a zero, a reasonable thing to
 * misread as a push.
 *
 * A cleared rank now scores 1 (`pickConfidence`, #1216): both-null degrades to
 * the same shape as confidence OFF — `both`, 1 each, swing 0 — rather than to a
 * silent zero. Kept in this file because the state is still worth knowing about,
 * even though it no longer belongs to the zero-reachability question the file
 * was written to answer.
 */

const g = (over: Partial<ScoredSlateGame> = {}): ScoredSlateGame => ({
  id: "g1",
  result: "home",
  multiplier: 1,
  ...over,
});
const p = (confidence: number | null, pick: "away" | "home" = "home"): ScoredPick[] => [
  { slateGameId: "g1", pick, confidence },
];
const only = (slate: ScoredSlateGame[], a: ScoredPick[], b: ScoredPick[], conf = true): BoardRow =>
  buildBoardRows(slate, a, b, conf)[0];

describe("two correct picks", () => {
  it("NEVER render a zero at different ranks — the swing IS the difference", () => {
    /**
     * The enumeration. Every ordered pair of distinct ranks 1..8, at three
     * multipliers, both sides taking the winner. A single zero anywhere here is
     * the reported bug.
     */
    const seen: number[] = [];
    for (const mult of [1, 2, 3]) {
      for (let x = 1; x <= 8; x++) {
        for (let y = 1; y <= 8; y++) {
          if (x === y) continue;
          const row = only([g({ multiplier: mult })], p(x), p(y));
          expect(row.aPoints, `a at ${x}x${mult}`).toBe(x * mult);
          expect(row.bPoints, `b at ${y}x${mult}`).toBe(y * mult);
          expect(row.swing, `${x} vs ${y} at x${mult}`).toBe((x - y) * mult);
          expect(row.swing, `${x} vs ${y} at x${mult}`).not.toBe(0);
          expect(row.zeroKind).toBeNull();
          seen.push(row.swing);
        }
      }
    }
    // The scan actually ran over every pair, rather than an empty loop passing.
    expect(seen).toHaveLength(3 * 8 * 7);
  });

  it("are never a PUSH — that is a fact about the GAME, and it makes both wrong", () => {
    /**
     * The specific thing reported. A push means nobody covered, so no pick can
     * be correct on that row: the two states cannot co-occur, whatever the ranks.
     */
    for (const x of [1, 5, 16]) {
      const row = only([g({ result: "push" })], p(x), p(x + 1));
      expect(row.zeroKind).toBe("push");
      expect(row.aPoints).toBe(0);
      expect(row.bPoints).toBe(0);
    }
  });

  it("DO render a zero at EQUAL ranks, and it is honestly `both`", () => {
    // Legitimate, and the state that looks like the bug in a screenshot.
    const row = only([g()], p(5), p(5));
    expect(row.swing).toBe(0);
    expect(row.zeroKind).toBe("both");
    expect(row.aPoints).toBe(5);
  });

  it("both ranks NULL is a zero SWING, not zero POINTS (#1216)", () => {
    /**
     * A cleared rank scores 1 (`pickConfidence`), so this is no longer the
     * silent-zero case the file's header used to report — it degrades to the
     * same shape as confidence OFF: both correct, 1 point each, swing 0. The
     * chips still render as absent (`aConfidence`/`bConfidence: null`), which
     * is the one thing that has not changed — that is a fact about the RANK,
     * not the points.
     */
    const row = only([g()], p(null), p(null));
    expect(row.swing).toBe(0);
    expect(row.zeroKind).toBe("both");
    expect(row.aPoints).toBe(1);
    expect(row.bPoints).toBe(1);
    expect(row.aConfidence).toBeNull();
    expect(row.bConfidence).toBeNull();
  });

  it("score 1 each with confidence OFF, which is also a legitimate zero", () => {
    // Ranks are meaningless there, so every agreed-and-right row is a zero. Not
    // a bug, and not a push either.
    const row = only([g()], p(7), p(2), false);
    expect(row.aPoints).toBe(1);
    expect(row.bPoints).toBe(1);
    expect(row.swing).toBe(0);
    expect(row.zeroKind).toBe("both");
  });
});
