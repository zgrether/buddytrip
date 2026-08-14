import { describe, it, expect } from "vitest";
import { matchStakes, formatStake } from "./bracketStakes";
import { buildDraw } from "./bracket";
import { resolveDraw, matchKey, type WinnerBySeed } from "./bracketAdvance";
import { bracketPlacements } from "./bracketPlacements";
import { pointsForPlacements } from "./placementGroups";

/**
 * The header's numbers have to be the game's actual numbers.
 *
 * The load-bearing test is the last one: the figure a match promises its loser
 * must equal what that entrant is actually PAID when the bracket finishes that
 * way. Everything above it is the shape of the formula; that one is whether the
 * board is telling the truth.
 */

const at = (resolved: ReturnType<typeof resolveDraw>, round: number, slot = 1) =>
  resolved.find((m) => m.bracket === "main" && m.round === round && m.slot === slot)!;

describe("one formula, every round", () => {
  // 4 entrants, a clean pool: 1st 10, 2nd 6, 3rd 3, 4th 1.
  const dist = [10, 6, 3, 1];
  const resolved = resolveDraw(buildDraw(4));

  it("the FINAL collapses to the literal 1st/2nd, with no special case", () => {
    const s = matchStakes(at(resolved, 2), resolved, dist)!;
    expect(s).toEqual({ loser: 6, winner: 10, winnerIsExact: true });
  });

  it("a SEMI pays its loser the averaged 3rd/4th, and guarantees the winner 2nd", () => {
    // The two semi losers tie across places 3-4 → (3 + 1) / 2 = 2.
    const s = matchStakes(at(resolved, 1), resolved, dist)!;
    expect(s.loser).toBe(2);
    expect(s.winner).toBe(6); // at worst they lose the final
    expect(s.winnerIsExact).toBe(false);
  });

  it("an 8-draw quarter-final: loser averages 5th-8th, winner is guaranteed 3rd-4th", () => {
    const d8 = [20, 12, 8, 6, 4, 3, 2, 1];
    const r8 = resolveDraw(buildDraw(8));
    const s = matchStakes(at(r8, 1), r8, d8)!;
    expect(s.loser).toBe((4 + 3 + 2 + 1) / 4); // 2.5
    expect(s.winner).toBe((8 + 6) / 2); // 7 — worst case is losing the semi
  });
});

describe("byes and the consolation match change the groups", () => {
  it("a bye contributes no loser, so the round-1 group is smaller", () => {
    // 5 entrants in an 8-seat draw: three byes, so only one round-1 match has a
    // real loser and that entrant does NOT share 5th-8th with three others.
    const d = [20, 12, 8, 6, 4, 3, 2, 1];
    const r = resolveDraw(buildDraw(5));
    const played = r.filter((m) => m.bracket === "main" && m.round === 1 && !m.bye);
    expect(played).toHaveLength(1);
    const s = matchStakes(played[0], r, d)!;
    // One loser at position 5 → takes the 5th value alone, not an average.
    expect(s.loser).toBe(4);
  });

  it("the consolation match is exact on both sides — that is what it is for", () => {
    const dist = [10, 6, 3, 1];
    const r = resolveDraw(buildDraw(4, { consolation: true }));
    const c = r.find((m) => m.bracket === "consolation")!;
    const s = matchStakes(c, r, dist)!;
    expect(s).toEqual({ loser: 1, winner: 3, winnerIsExact: true });
  });

  it("with a consolation match, the SEMI no longer promises an average", () => {
    const dist = [10, 6, 3, 1];
    const r = resolveDraw(buildDraw(4, { consolation: true }));
    // The semi loser now goes to a real 3rd-or-4th play-off rather than tying,
    // so the figure quoted is the 3rd value — the best they can still reach.
    const s = matchStakes(at(r, 1), r, dist)!;
    expect(s.loser).toBe(3);
  });
});

describe("no placement split → no numbers", () => {
  it("returns null rather than quoting zeroes", () => {
    const r = resolveDraw(buildDraw(4));
    expect(matchStakes(at(r, 2), r, [])).toBeNull();
  });
});

describe("the header's promise matches what the bracket actually PAYS", () => {
  it("a semi-final loser is paid exactly what their match said they would be", () => {
    const dist = [10, 6, 3, 1];
    const draw = buildDraw(4);
    const resolved = resolveDraw(draw);
    const promised = matchStakes(at(resolved, 1), resolved, dist)!.loser;

    // Play it out: seed 1 beats 4, seed 2 beats 3, seed 1 beats 2.
    const winners: WinnerBySeed = {
      [matchKey({ bracket: "main", round: 1, slot: 1 })]: 1,
      [matchKey({ bracket: "main", round: 1, slot: 2 })]: 2,
      [matchKey({ bracket: "main", round: 2, slot: 1 })]: 1,
    };
    const finished = resolveDraw(draw, winners);
    const placements = bracketPlacements(finished);
    const paid = pointsForPlacements(
      placements.map((p) => ({ entityId: String(p.seed), position: p.position })),
      dist
    );

    // Seed 4 lost a semi-final. What they were promised is what they got.
    expect(paid.get("4")).toBe(promised);
    expect(paid.get("3")).toBe(promised); // the other semi loser, same tie group
  });

  it("the final's winner is paid the 1st-place value it promised", () => {
    const dist = [10, 6, 3, 1];
    const draw = buildDraw(4);
    const resolved = resolveDraw(draw);
    const promised = matchStakes(at(resolved, 2), resolved, dist)!.winner;
    const winners: WinnerBySeed = {
      [matchKey({ bracket: "main", round: 1, slot: 1 })]: 1,
      [matchKey({ bracket: "main", round: 1, slot: 2 })]: 2,
      [matchKey({ bracket: "main", round: 2, slot: 1 })]: 1,
    };
    const placements = bracketPlacements(resolveDraw(draw, winners));
    const paid = pointsForPlacements(
      placements.map((p) => ({ entityId: String(p.seed), position: p.position })),
      dist
    );
    expect(paid.get("1")).toBe(promised);
  });
});

describe("formatStake", () => {
  it("drops a trailing .0 but keeps a real half", () => {
    expect(formatStake(7)).toBe("7");
    expect(formatStake(4.5)).toBe("4.5");
    expect(formatStake(2.25)).toBe("2.3");
  });
});
