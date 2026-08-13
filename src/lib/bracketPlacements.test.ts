import { describe, it, expect } from "vitest";
import { buildDraw } from "./bracket";
import { resolveDraw, matchKey, type WinnerBySeed } from "./bracketAdvance";
import { bracketPlacements, teamPointsFromEntrants } from "./bracketPlacements";
import { pointsForPlacements } from "./placementGroups";

/**
 * Placements — where a finished bracket says everyone came.
 *
 * The load-bearing claim is #916's: elimination round IS the ranking, so the
 * four quarter-final losers of an 8-draw are 5th–8th as a tie group and
 * `placementPoints` averages the places they span. These tests check the
 * placements AND that they pay what #916 said they would, because a placement
 * array that looks right and pays wrong is the failure that matters.
 */

const win = (w: WinnerBySeed, round: number, slot: number, seed: number, bracket: "main" | "consolation" = "main"): WinnerBySeed =>
  ({ ...w, [matchKey({ bracket, round, slot })]: seed });

/** Play an 8-draw so the better seed always wins. */
function chalk8(): WinnerBySeed {
  let w: WinnerBySeed = {};
  for (const [slot, seed] of [[1, 1], [2, 4], [3, 2], [4, 3]] as const) w = win(w, 1, slot, seed);
  w = win(w, 2, 1, 1);
  w = win(w, 2, 2, 2);
  w = win(w, 3, 1, 1);
  return w;
}
const placementsOf = (entrants: number, winners: WinnerBySeed, opts?: { consolation: boolean }) =>
  bracketPlacements(resolveDraw(buildDraw(entrants, opts ?? { consolation: false }), winners));

describe("elimination round is the ranking", () => {
  it("an 8-draw places 1, 2, two tied 3rds, four tied 5ths", () => {
    const p = placementsOf(8, chalk8());
    expect(p.find((x) => x.seed === 1)!.position).toBe(1);
    expect(p.find((x) => x.seed === 2)!.position).toBe(2);
    // Semi-final losers, tied — nothing separated them.
    expect([p.find((x) => x.seed === 4)!.position, p.find((x) => x.seed === 3)!.position]).toEqual([3, 3]);
    // Quarter-final losers, tied across 5th–8th.
    expect(p.filter((x) => x.position === 5).map((x) => x.seed).sort()).toEqual([5, 6, 7, 8]);
    expect(p).toHaveLength(8);
  });

  it("a 4-draw places 1, 2 and two tied 3rds", () => {
    let w: WinnerBySeed = {};
    w = win(w, 1, 1, 1);
    w = win(w, 1, 2, 2);
    w = win(w, 2, 1, 1);
    const p = placementsOf(4, w);
    expect(p.map((x) => [x.seed, x.position])).toEqual([[1, 1], [2, 2], [3, 3], [4, 3]]);
  });

  it("a 2-draw is just a winner and a runner-up", () => {
    expect(placementsOf(2, win({}, 1, 1, 2)).map((x) => [x.seed, x.position])).toEqual([[2, 1], [1, 2]]);
  });

  it("an UPSET is placed by round, not by seed", () => {
    // The tree sorted them; seeding has no say once the games are played.
    let w: WinnerBySeed = {};
    w = win(w, 1, 1, 4);
    w = win(w, 1, 2, 3);
    w = win(w, 2, 1, 3);
    const p = placementsOf(4, w);
    expect(p.find((x) => x.seed === 3)!.position).toBe(1);
    expect(p.find((x) => x.seed === 4)!.position).toBe(2);
    expect(p.filter((x) => x.position === 3).map((x) => x.seed).sort()).toEqual([1, 2]);
  });
});

describe("byes", () => {
  it("place nobody — nobody played them", () => {
    // 3 entrants: seed 1 has the round-1 bye. Places must be 1, 2, 3 with no
    // phantom fourth and no one placed by a match that never happened.
    let w: WinnerBySeed = {};
    w = win(w, 1, 2, 2);
    w = win(w, 2, 1, 1);
    const p = placementsOf(3, w);
    expect(p.map((x) => [x.seed, x.position])).toEqual([[1, 1], [2, 2], [3, 3]]);
  });

  it("the entrant WITH the bye is placed by the round they actually lose", () => {
    let w: WinnerBySeed = {};
    w = win(w, 1, 2, 2);
    w = win(w, 2, 1, 2); // the bye receiver loses the final
    const p = placementsOf(3, w);
    expect(p.find((x) => x.seed === 1)!.position).toBe(2);
    expect(p.find((x) => x.seed === 2)!.position).toBe(1);
  });
});

describe("the consolation match separates 3rd from 4th", () => {
  it("splits the tie when decided", () => {
    let w: WinnerBySeed = {};
    w = win(w, 1, 1, 1);
    w = win(w, 1, 2, 2);
    w = win(w, 2, 1, 1);
    w = win(w, 2, 1, 3, "consolation"); // seed 3 wins the play-off
    const p = placementsOf(4, w, { consolation: true });
    expect(p.find((x) => x.seed === 3)!.position).toBe(3);
    expect(p.find((x) => x.seed === 4)!.position).toBe(4);
  });

  it("leaves the tie standing while UNDECIDED — an unplayed play-off separates nobody", () => {
    let w: WinnerBySeed = {};
    w = win(w, 1, 1, 1);
    w = win(w, 1, 2, 2);
    w = win(w, 2, 1, 1);
    const p = placementsOf(4, w, { consolation: true });
    expect(p.filter((x) => x.position === 3).map((x) => x.seed).sort()).toEqual([3, 4]);
  });
});

describe("an unfinished draw places nobody", () => {
  it("returns [] when the final is undecided", () => {
    let w: WinnerBySeed = {};
    w = win(w, 1, 1, 1);
    w = win(w, 1, 2, 2);
    expect(placementsOf(4, w)).toEqual([]);
  });

  it("returns [] for an empty draw", () => {
    expect(bracketPlacements([])).toEqual([]);
  });
});

describe("what the placements actually PAY — #916's claim, cashed", () => {
  it("an 8-place split over 8 entrants pays every place, with tie groups averaged", () => {
    // The exact example bracketPlaceCapacity's docblock gives. If this is wrong,
    // #916 removed a ceiling for a payout that does not happen.
    const p = placementsOf(8, chalk8());
    const dist = [3, 2, 1, 1, 0.5, 0.25, 0.25, 0];
    const pts = pointsForPlacements(p.map((x) => ({ entityId: String(x.seed), position: x.position })), dist);
    expect(pts.get("1")).toBeCloseTo(3);
    expect(pts.get("2")).toBeCloseTo(2);
    // 3rd and 4th averaged across the two tied semi-final losers.
    expect(pts.get("3")).toBeCloseTo(1);
    expect(pts.get("4")).toBeCloseTo(1);
    // 5th–8th averaged across the four tied quarter-final losers.
    const quarter = (0.5 + 0.25 + 0.25 + 0) / 4;
    for (const seed of [5, 6, 7, 8]) expect(pts.get(String(seed))).toBeCloseTo(quarter);
  });

  it("WINNER TAKES ALL is the same path, not a special case", () => {
    // The storage-not-a-mandate rule: every entrant is still placed, and a
    // one-element distribution simply pays place 1. No branch anywhere.
    const p = placementsOf(8, chalk8());
    expect(p).toHaveLength(8);
    const pts = pointsForPlacements(p.map((x) => ({ entityId: String(x.seed), position: x.position })), [8]);
    expect(pts.get("1")).toBeCloseTo(8);
    for (const seed of [2, 3, 4, 5, 6, 7, 8]) expect(pts.get(String(seed)) ?? 0).toBeCloseTo(0);
  });
});

describe("teamPointsFromEntrants", () => {
  it("SUMS a team's entrants — fielding two good ones beats fielding one", () => {
    const points = new Map([[1, 4], [2, 2], [3, 1], [4, 1]]);
    const teams = new Map([[1, "A"], [2, "B"], [3, "A"], [4, "B"]]);
    expect(teamPointsFromEntrants(points, teams)).toEqual(new Map([["A", 5], ["B", 3]]));
  });

  it("skips an entrant with no team rather than inventing one", () => {
    const points = new Map([[1, 4], [2, 2]]);
    const teams = new Map<number, string | null>([[1, "A"], [2, null]]);
    expect(teamPointsFromEntrants(points, teams)).toEqual(new Map([["A", 4]]));
  });

  it("is empty when nobody has a team — a standalone bracket scores no cup", () => {
    expect(teamPointsFromEntrants(new Map([[1, 4]]), new Map([[1, null]]))).toEqual(new Map());
  });
});
