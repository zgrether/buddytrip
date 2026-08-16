import { describe, it, expect } from "vitest";
import { matchStakes } from "./bracketStakes";
import { buildDraw } from "./bracket";
import { resolveDraw, matchKey, type WinnerBySeed } from "./bracketAdvance";
import { bracketPlacements } from "./bracketPlacements";
import { pointsForPlacements } from "./placementGroups";

/**
 * Stakes appear ONLY where places are actually paid.
 *
 * ── This inverts the previous behaviour deliberately ───────────────────────
 * The first version quoted every match — "what the loser takes, what the winner
 * is guaranteed" — and the tests below are the inverse of the ones that pinned
 * it. The reversal came from the output, not from taste: on a 16-entrant draw
 * the eight round-one matches all read `W ≥0 · L 0`, and the quarter-finals read
 * `W ≥0.5 · L 0` where 0.5 is the tie-group average the winner had just
 * ESCAPED — a false claim in exactly the direction the formula was chosen to
 * avoid.
 */

const at = (resolved: ReturnType<typeof resolveDraw>, round: number, slot = 1) =>
  resolved.find((m) => m.bracket === "main" && m.round === round && m.slot === slot)!;

describe("only the matches that pay carry a figure", () => {
  const dist = [10, 6, 3, 1];

  it("the FINAL states both places it settles", () => {
    const r = resolveDraw(buildDraw(4));
    const s = matchStakes(at(r, 2), r, dist)!;
    expect(s.label).toBe("1st: 10 · 2nd: 6");
    expect([s.better, s.worse]).toEqual([10, 6]);
  });

  it("a SEMI carries nothing — it awards no place directly", () => {
    const r = resolveDraw(buildDraw(4));
    expect(matchStakes(at(r, 1), r, dist)).toBeNull();
  });

  it("round one and the quarters of a 16-draw carry nothing", () => {
    // The regression this whole item exists for: eight matches reading
    // "W ≥0 · L 0", and quarters claiming a figure their winner has escaped.
    const d16 = [20, 12, 8, 6, 4, 3, 2, 1];
    const r = resolveDraw(buildDraw(16));
    for (const round of [1, 2, 3]) {
      const inRound = r.filter((m) => m.bracket === "main" && m.round === round);
      expect(inRound.length).toBeGreaterThan(0);
      for (const m of inRound) expect(matchStakes(m, r, d16)).toBeNull();
    }
    // …and the final still does.
    expect(matchStakes(at(r, 4), r, d16)).not.toBeNull();
  });

  it("the CONSOLATION match states 3rd and 4th, because that is what it settles", () => {
    const r = resolveDraw(buildDraw(4, { consolation: true }));
    const c = r.find((m) => m.bracket === "consolation")!;
    const s = matchStakes(c, r, dist)!;
    expect(s.label).toBe("3rd: 3 · 4th: 1");
  });

  it("halves render as ½, the app's existing notation", () => {
    const r = resolveDraw(buildDraw(4));
    const s = matchStakes(at(r, 2), r, [3, 1.5])!;
    expect(s.label).toBe("1st: 3 · 2nd: 1½");
  });

  it("no placement split → nothing, rather than zeroes", () => {
    const r = resolveDraw(buildDraw(4));
    expect(matchStakes(at(r, 2), r, [])).toBeNull();
  });
});

describe("the figure quoted is what the bracket actually PAYS", () => {
  it("the final's two places match what the finished draw awards", () => {
    const dist = [10, 6, 3, 1];
    const draw = buildDraw(4);
    const quoted = matchStakes(at(resolveDraw(draw), 2), resolveDraw(draw), dist)!;

    const winners: WinnerBySeed = {
      [matchKey({ bracket: "main", round: 1, slot: 1 })]: 1,
      [matchKey({ bracket: "main", round: 1, slot: 2 })]: 2,
      [matchKey({ bracket: "main", round: 2, slot: 1 })]: 1,
    };
    const paid = pointsForPlacements(
      bracketPlacements(resolveDraw(draw, winners)).map((p) => ({
        entityId: String(p.seed),
        position: p.position,
      })),
      dist
    );
    expect(paid.get("1")).toBe(quoted.better); // champion
    expect(paid.get("2")).toBe(quoted.worse); // runner-up
  });
});
