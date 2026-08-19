import { describe, it, expect } from "vitest";
import {
  buildDoubleDraw, lowerRoundCount, lowerRoundSize, feederMainRound, dropSlot,
} from "./bracketDouble";
import { bracketSize, buildDraw, roundCount } from "./bracket";

/**
 * The double-elimination TREE — shape only, at every entrant count that can break it.
 *
 * The odd counts are the point. 3, 5, 7 and 9 are where byes in `main` round 1 leave
 * the lower bracket with fewer real occupants than seats, and where a structure that
 * looks right at 8 and 16 quietly stops being right.
 *
 * The assertions are mostly INVARIANTS rather than expected literals — every entrant
 * has somewhere to take a second loss, counts halve where they should, the drop map is
 * a bijection. A test listing the 30 matches of a 16-draw would pass on a structure
 * that was wrong in a way I hadn't thought of; an invariant fails on any structure that
 * cannot host a real tournament.
 */

const COUNTS = [3, 4, 5, 6, 7, 8, 9, 16];

const only = (draw: ReturnType<typeof buildDoubleDraw>, side: string) =>
  draw.filter((m) => m.bracket === side);

describe("buildDoubleDraw — shape", () => {
  it("returns nothing below two entrants, like the single-elim draw", () => {
    expect(buildDoubleDraw(0)).toEqual([]);
    expect(buildDoubleDraw(1)).toEqual([]);
  });

  it.each(COUNTS)("the winners' bracket at %i is the single-elim draw, unchanged", (n) => {
    // Composition, not reimplementation: if these ever differ, double elim has grown a
    // private copy of the winners' bracket and the two will drift.
    expect(only(buildDoubleDraw(n), "main")).toEqual(buildDraw(n, { consolation: false }));
  });

  it.each(COUNTS)("emits no consolation match at %i — 3rd is structural", (n) => {
    expect(only(buildDoubleDraw(n), "consolation")).toHaveLength(0);
  });

  it.each(COUNTS)("every lower and final seat is null at %i — shape, not occupants", (n) => {
    for (const m of buildDoubleDraw(n).filter((x) => x.bracket !== "main")) {
      expect([m.aSeed, m.bSeed]).toEqual([null, null]);
    }
  });

  it.each(COUNTS)("the grand final is one match plus an if-necessary rematch at %i", (n) => {
    const fin = only(buildDoubleDraw(n), "final");
    expect(fin.map((m) => [m.round, m.slot])).toEqual([[1, 1], [2, 1]]);
  });
});

describe("the lower bracket's geometry", () => {
  it.each(COUNTS)("has 2*(W-1) rounds at %i entrants", (n) => {
    expect(lowerRoundCount(n)).toBe(2 * (roundCount(n) - 1));
  });

  it.each(COUNTS)("pairs its rounds — minor and the major after it are the same size (%i)", (n) => {
    for (let k = 1; k < lowerRoundCount(n); k += 2) {
      expect(lowerRoundSize(n, k), `rounds ${k}/${k + 1} at ${n}`).toBe(lowerRoundSize(n, k + 1));
    }
  });

  it.each(COUNTS)("halves between major and the next minor at %i", (n) => {
    for (let k = 2; k < lowerRoundCount(n); k += 2) {
      expect(lowerRoundSize(n, k + 1)).toBe(lowerRoundSize(n, k) / 2);
    }
  });

  it.each(COUNTS)("narrows to a single match at %i — one survivor reaches the final", (n) => {
    const last = lowerRoundCount(n);
    if (last === 0) return; // a one-round winners' bracket has no lower bracket
    expect(lowerRoundSize(n, last)).toBe(1);
  });

  it.each(COUNTS)("gives every main round after the first exactly one landing round (%i)", (n) => {
    const w = roundCount(n);
    const majors = Array.from({ length: lowerRoundCount(n) }, (_, i) => i + 1)
      .filter((k) => k % 2 === 0)
      .map(feederMainRound);
    // main rounds 2..W each drop once, in order. Round 1's losers START the lower
    // bracket rather than dropping into it, so they are absent by design.
    expect(majors).toEqual(Array.from({ length: Math.max(0, w - 1) }, (_, i) => i + 2));
  });

  it.each(COUNTS)("sizes each major round to the batch dropping into it (%i)", (n) => {
    const size = bracketSize(n);
    for (let k = 2; k <= lowerRoundCount(n); k += 2) {
      const mainRound = feederMainRound(k)!;
      const droppers = size / 2 ** mainRound;   // matches in that main round = losers it sends
      expect(lowerRoundSize(n, k), `lower ${k} vs main ${mainRound} at ${n}`).toBe(droppers);
    }
  });
});

describe("the drop pattern", () => {
  it("reverses, so a dropping loser does not immediately replay who beat them", () => {
    // The identity map would send main slot 1's loser onto the survivor of lower slot 1
    // — one of the two people they just knocked down. Reversal is what breaks that.
    expect(dropSlot(1, 4)).toBe(4);
    expect(dropSlot(4, 4)).toBe(1);
    expect(dropSlot(1, 1)).toBe(1); // a single-match round has nowhere else to go
  });

  it.each(COUNTS)("is a bijection over each major round's slots at %i", (n) => {
    for (let k = 2; k <= lowerRoundCount(n); k += 2) {
      const count = lowerRoundSize(n, k);
      const mapped = Array.from({ length: count }, (_, i) => dropSlot(i + 1, count));
      // Every landing slot used exactly once: nobody dropped into a taken seat, and no
      // seat left empty while an entrant had nowhere to go.
      expect([...mapped].sort((a, b) => a - b)).toEqual(Array.from({ length: count }, (_, i) => i + 1));
    }
  });
});

describe("the structure can host a real tournament", () => {
  it.each(COUNTS)("has room for every entrant to lose twice at %i", (n) => {
    const draw = buildDoubleDraw(n);
    const size = bracketSize(n);

    // Byes are seats nobody played, so they neither host nor produce a loss.
    const byes = size - n;
    const mainMatches = only(draw, "main").length - byes;
    const lowerMatches = only(draw, "lower").length;

    // Each played match produces exactly one loss. To eliminate n-1 entrants at two
    // losses each — the champion possibly never losing — a full run needs 2n-2 losses,
    // and the reset final can add one more.
    const capacity = mainMatches + lowerMatches + 2; // +2 = grand final, incl. reset
    expect(capacity, `capacity at ${n}`).toBeGreaterThanOrEqual(2 * n - 2);
  });

  it.each(COUNTS)("sends every main loser somewhere, at %i", (n) => {
    const size = bracketSize(n);
    const draw = buildDoubleDraw(n);

    // Losers produced by main, ignoring byes (round 1 produces size/2 - byes).
    const byes = size - n;
    const mainLosers = only(draw, "main").length - byes;

    // Seats the lower bracket + final offer to people arriving from main: lower round 1
    // takes two per match, every major round takes one per match, and the final takes
    // the main survivor.
    const lowerR1Seats = lowerRoundSize(n, 1) * 2;
    let majorSeats = 0;
    for (let k = 2; k <= lowerRoundCount(n); k += 2) majorSeats += lowerRoundSize(n, k);

    expect(lowerR1Seats + majorSeats, `landing seats at ${n}`).toBeGreaterThanOrEqual(mainLosers);
  });

  it.each(COUNTS)("keys every match uniquely by (bracket, round, slot) at %i", (n) => {
    // The schema's UNIQUE constraint, asserted on the emitted draw — a duplicate here
    // would be refused at write time, which is a worse place to find it.
    const keys = buildDoubleDraw(n).map((m) => `${m.bracket}:${m.round}:${m.slot}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  /**
   * CONCRETE ANCHORS — one hand-computed shape per entrant count.
   *
   * The invariants above check internal consistency, and they cannot catch a model
   * that is coherently WRONG, because a wrong model is internally consistent. That is
   * not hypothetical here: every invariant was green against an 8-entrant count I had
   * asserted as 14, by conflating matches PLAYED in a no-reset run (2n-2) with matches
   * EMITTED (which always include the if-necessary final). Only a hand-computed number
   * caught it.
   *
   * So these are derived on paper from the geometry, NOT generated from the module —
   * a table produced by the code under test restates the implementation and can only
   * agree with it.
   *
   *   size 4  (n=3,4)   main 2+1        lower 1+1              + 2 finals =  7
   *   size 8  (n=5..8)  main 4+2+1      lower 2+2+1+1          + 2 finals = 15
   *   size 16 (n=9,16)  main 8+4+2+1    lower 4+4+2+2+1+1      + 2 finals = 31
   *
   * Note the shape depends on SIZE, not on n — 5 and 8 entrants play the same tree,
   * differing only in how many round-1 seats are byes. That is the bye design stated
   * as an assertion rather than as a comment.
   */
  const ANCHORS: Record<number, { main: number[]; lower: number[]; total: number }> = {
    3:  { main: [2, 1],       lower: [1, 1],             total: 7 },
    4:  { main: [2, 1],       lower: [1, 1],             total: 7 },
    5:  { main: [4, 2, 1],    lower: [2, 2, 1, 1],       total: 15 },
    6:  { main: [4, 2, 1],    lower: [2, 2, 1, 1],       total: 15 },
    7:  { main: [4, 2, 1],    lower: [2, 2, 1, 1],       total: 15 },
    8:  { main: [4, 2, 1],    lower: [2, 2, 1, 1],       total: 15 },
    9:  { main: [8, 4, 2, 1], lower: [4, 4, 2, 2, 1, 1], total: 31 },
    16: { main: [8, 4, 2, 1], lower: [4, 4, 2, 2, 1, 1], total: 31 },
  };

  it.each(COUNTS)("has the hand-computed shape at %i entrants", (n) => {
    const draw = buildDoubleDraw(n);
    const perRound = (side: string) => {
      const rounds = only(draw, side).map((m) => m.round);
      const max = rounds.length === 0 ? 0 : Math.max(...rounds);
      return Array.from({ length: max }, (_, i) => rounds.filter((r) => r === i + 1).length);
    };
    const want = ANCHORS[n];
    expect(perRound("main"), `main at ${n}`).toEqual(want.main);
    expect(perRound("lower"), `lower at ${n}`).toEqual(want.lower);
    expect(draw, `total at ${n}`).toHaveLength(want.total);
  });

  it("matches the standard printed shape at 8 entrants", () => {
    // One concrete anchor against the invariants above, at the size most people can
    // check by eye: 4+2+1 winners, 2+2+1+1 lower, 2 finals.
    const draw = buildDoubleDraw(8);
    const shape = (side: string) =>
      only(draw, side).reduce<Record<number, number>>((acc, m) => {
        acc[m.round] = (acc[m.round] ?? 0) + 1;
        return acc;
      }, {});
    expect(shape("main")).toEqual({ 1: 4, 2: 2, 3: 1 });
    expect(shape("lower")).toEqual({ 1: 2, 2: 2, 3: 1, 4: 1 });
    expect(shape("final")).toEqual({ 1: 1, 2: 1 });
    // 7 + 6 + 2. `2n-2 = 14` counts matches PLAYED in a no-reset run; the draw also
    // carries the if-necessary final, which is emitted always and played sometimes.
    expect(draw).toHaveLength(15);
  });

  it("thins the lower bracket's real occupants, not its shape, at 5 entrants", () => {
    // The case the spec singles out. An 8-draw with 5 entrants has 3 byes, so main
    // round 1 produces exactly ONE loser — lower round 1 has 2 seats and one occupant.
    // The SHAPE stays full-size on purpose; resolution (Phase 2) leaves the unfillable
    // seats empty, the same answer main round 1 already gives a bye.
    const draw = buildDoubleDraw(5);
    expect(bracketSize(5)).toBe(8);
    expect(only(draw, "lower").filter((m) => m.round === 1)).toHaveLength(2);
    const realR1Losers = only(draw, "main").filter((m) => m.round === 1 && m.aSeed !== null && m.bSeed !== null).length;
    expect(realR1Losers).toBe(1);
  });
});
