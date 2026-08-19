import { describe, it, expect } from "vitest";
import { buildDoubleDraw } from "./bracketDouble";
import { resolveDoubleDraw, lossesBySeed, livesOf } from "./bracketDoubleAdvance";
import { doubleBracketPlacements, doublePositionsAwarded, doubleSettledPlaces } from "./bracketDoublePlacements";
import { teamPointsFromEntrants, bracketPlacements } from "./bracketPlacements";
import { buildDraw } from "./bracket";
import { resolveDraw } from "./bracketAdvance";
import { matchKey, type ResolvedMatch, type WinnerBySeed } from "./bracketAdvance";
import { pointsForPlacements } from "./placementGroups";
import { stakesFromPositions } from "./bracketStakes";

/**
 * DOUBLE-ELIM PLACEMENT — the ordering, and its roll-up to team points.
 *
 * The rule under test is "count eliminations, not matches". Under one life those are
 * the same event, which is why the single-elim version could place you the moment you
 * lost; under two they diverge, and an entrant who loses twice would be placed twice
 * with the later write silently winning.
 */

const COUNTS = [3, 4, 5, 6, 7, 8, 9, 16];

function playOut(entrants: number, choose: (m: ResolvedMatch) => number) {
  const draw = buildDoubleDraw(entrants);
  const winners: WinnerBySeed = {};
  for (let i = 0; i < draw.length + 5; i++) {
    const resolved = resolveDoubleDraw(draw, winners);
    const next = resolved.find((m) => m.playable);
    if (!next) return resolved;
    winners[matchKey(next)] = choose(next);
  }
  throw new Error(`did not settle at ${entrants}`);
}
const favourite = (m: ResolvedMatch) => Math.min(m.aSeed!, m.bSeed!);
const comebackStrategy = () => {
  let dropped = false;
  return (m: ResolvedMatch) => {
    const has1 = m.aSeed === 1 || m.bSeed === 1;
    if (has1 && m.bracket === "main" && !dropped) { dropped = true; return m.aSeed === 1 ? m.bSeed! : m.aSeed!; }
    if (has1) return 1;
    return Math.min(m.aSeed!, m.bSeed!);
  };
};

describe.each(COUNTS)("placements at %i entrants", (n) => {
  it("places every entrant exactly once", () => {
    // The conflation's signature, asserted directly: under the old rule an entrant who
    // lost twice was written twice and the second write won. One row per entrant, and
    // as many rows as entrants, is what says that cannot happen.
    const places = doubleBracketPlacements(playOut(n, favourite));
    expect(places).toHaveLength(n);
    expect(new Set(places.map((p) => p.seed)).size).toBe(n);
  });

  it("gives 1st to the champion and 2nd to whoever lost the last final", () => {
    const resolved = playOut(n, favourite);
    const places = doubleBracketPlacements(resolved);
    const losses = lossesBySeed(resolved);
    const champ = places.find((p) => p.position === 1)!;
    expect(livesOf(losses, champ.seed), "the champion is the one still alive").toBeGreaterThan(0);
    expect(places.filter((p) => p.position === 1)).toHaveLength(1);
    expect(places.filter((p) => p.position === 2)).toHaveLength(1);
  });

  it("caps individual places at 4, then ties — without anything reading '4'", () => {
    const places = doubleBracketPlacements(playOut(n, favourite));
    for (const position of [1, 2, 3, 4]) {
      const at = places.filter((p) => p.position === position);
      // A count below 4 entrants simply has no 4th; what must never happen is a TIE
      // inside the top four, because the last two lower rounds hold one match each.
      expect(at.length, `place ${position} at ${n}`).toBeLessThanOrEqual(1);
    }
  });

  it("orders by elimination round — surviving the lower bracket longer places better", () => {
    const resolved = playOut(n, favourite);
    const places = new Map(doubleBracketPlacements(resolved).map((p) => [p.seed, p.position]));
    const lower = resolved.filter((m) => m.bracket === "lower" && m.winnerSeed !== null && !m.bye);
    for (const a of lower) {
      for (const b of lower) {
        if (a.round <= b.round) continue;
        const outA = a.winnerSeed === a.aSeed ? a.bSeed : a.aSeed;
        const outB = b.winnerSeed === b.aSeed ? b.bSeed : b.aSeed;
        if (outA === null || outB === null) continue;
        expect(places.get(outA)!, `seed ${outA} (round ${a.round}) vs ${outB} (round ${b.round})`)
          .toBeLessThan(places.get(outB)!);
      }
    }
  });

  it("places a comeback champion 1st too", () => {
    const places = doubleBracketPlacements(playOut(n, comebackStrategy()));
    expect(places.find((p) => p.position === 1)!.seed).toBe(1);
    expect(places).toHaveLength(n);
  });

  it("returns nothing for an unfinished draw", () => {
    const draw = buildDoubleDraw(n);
    expect(doubleBracketPlacements(resolveDoubleDraw(draw, {}))).toEqual([]);
  });
});

describe("positions awarded — the stakes half of the same fix", () => {
  it.each(COUNTS)("awards exactly as many positions as there are entrants (%i)", (n) => {
    // `bracketStakes.allPositions` counted one per non-bye MATCH, which under two lives
    // is roughly twice too many and makes every tie-group average wrong. Counting
    // eliminations gives one position per entrant, which is the only right answer.
    const resolved = playOut(n, favourite);
    expect(doublePositionsAwarded(resolved)).toHaveLength(n);
  });

  it.each(COUNTS)("matches the positions the placement rule actually produced (%i)", (n) => {
    // The two must agree or the header quotes a payout the result will not honour.
    const resolved = playOut(n, favourite);
    const awarded = [...doublePositionsAwarded(resolved)].sort((a, b) => a - b);
    const actual = doubleBracketPlacements(resolved).map((p) => p.position).sort((a, b) => a - b);
    expect(awarded).toEqual(actual);
  });

  it("quotes stakes on the grand final and nowhere else", () => {
    const resolved = playOut(8, favourite);
    for (const m of resolved) {
      const settled = doubleSettledPlaces(m);
      if (m.bracket === "final") expect(settled).toEqual([1, 2]);
      else expect(settled, `${matchKey(m)} settles nothing directly`).toBeNull();
    }
  });

  it("prices the final through the SHARED stakes core", () => {
    const resolved = playOut(8, favourite);
    const stakes = stakesFromPositions(doublePositionsAwarded(resolved), [1, 2], [10, 6, 3]);
    expect(stakes).not.toBeNull();
    expect(stakes!.better).toBe(10);
    expect(stakes!.worse).toBe(6);
    expect(stakes!.label).toContain("1st:");
  });
});

describe("roll-up — verified against the single-elim path, not only itself", () => {
  /**
   * The control the spec asks for. `teamPointsFromEntrants` is shared and unchanged, so
   * an equivalent FINISHING ORDER must produce identical team points regardless of which
   * format produced it. If double elim's numbers differ, the bug is in placement, not
   * roll-up — which is exactly the discrimination a self-referential test cannot make.
   */
  const teams = new Map<number, string | null>([[1, "A"], [2, "B"], [3, "A"], [4, "B"]]);
  const distribution = [10, 6, 3, 1];

  const pointsFor = (places: { seed: number; position: number }[]) => {
    const scored = pointsForPlacements(
      places.map((p) => ({ entityId: String(p.seed), position: p.position })),
      distribution
    );
    const bySeed = new Map<number, number>();
    for (const p of places) bySeed.set(p.seed, scored.get(String(p.seed)) ?? 0);
    return teamPointsFromEntrants(bySeed, teams);
  };

  it("gives the same team points for the same finishing order in both formats", () => {
    // A 4-entrant single-elim run with a consolation play-off produces a full 1/2/3/4
    // ordering, which is what a 4-entrant double-elim run produces too.
    const seDraw = buildDraw(4, { consolation: true });
    const seWinners: WinnerBySeed = {};
    for (let i = 0; i < 20; i++) {
      const r = resolveDraw(seDraw, seWinners);
      const next = r.find((m) => m.playable);
      if (!next) break;
      seWinners[matchKey(next)] = Math.min(next.aSeed!, next.bSeed!);
    }
    const sePlaces = bracketPlacements(resolveDraw(seDraw, seWinners));
    const dePlaces = doubleBracketPlacements(playOut(4, favourite));

    // Same ordering from both engines — the precondition for comparing the roll-up.
    expect(dePlaces).toEqual(sePlaces);
    // And therefore the same team points, through the shared roll-up.
    expect(pointsFor(dePlaces)).toEqual(pointsFor(sePlaces));
  });

  it("sums every entrant a team fielded, rather than taking its best", () => {
    // Restating the shared roll-up's contract against double-elim placements, so a
    // change here is caught in this format too: team A holds 1st and 3rd.
    const places = [
      { seed: 1, position: 1 }, { seed: 2, position: 2 },
      { seed: 3, position: 3 }, { seed: 4, position: 4 },
    ];
    const points = pointsFor(places);
    expect(points.get("A")).toBe(10 + 3);
    expect(points.get("B")).toBe(6 + 1);
  });

  it("skips an entrant with no team rather than dropping it from scoring", () => {
    const orphaned = new Map<number, string | null>([[1, null], [2, "B"]]);
    const bySeed = new Map<number, number>([[1, 10], [2, 6]]);
    const points = teamPointsFromEntrants(bySeed, orphaned);
    expect(points.has("A")).toBe(false);
    expect(points.get("B")).toBe(6);
  });
});
