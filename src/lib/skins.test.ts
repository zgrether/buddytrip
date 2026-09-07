import { describe, it, expect } from "vitest";
import {
  tallyGrouping,
  tallySkins,
  computeSkinsStandings,
  skinsPerGrouping,
  skinsGloriousConfig,
  type SkinsOutcomeRow,
} from "./skins";
import { NO_GLORIOUS, type GloriousConfig } from "./gloriousHoles";

/**
 * The carryover fold.
 *
 * Two of the cases below are written to FAIL against a specific, plausible wrong
 * build rather than to describe the right one. That is the point of them: the
 * right answer and several wrong ones agree on almost every fixture, so a test
 * that merely passes proves very little.
 */

/** GFH = 3 → holes 16, 17 and 18 are worth 2, everything else 1. */
const GFH3: GloriousConfig = { enabled: true, n: 3 };

const P1 = "u_ann";
const P2 = "u_ben";
const P3 = "u_cal";

const won = (hole: number, winnerId: string): SkinsOutcomeRow => ({ hole, result: "won", winnerId });
const tied = (hole: number): SkinsOutcomeRow => ({ hole, result: "tied", winnerId: null });

/** Holes 1..upTo, each won by `winnerId` — a clean slate with nothing carried. */
function allWonThrough(upTo: number, winnerId: string): SkinsOutcomeRow[] {
  return Array.from({ length: upTo }, (_, i) => won(i + 1, winnerId));
}

function potOf(rows: SkinsOutcomeRow[], hole: number, cfg: GloriousConfig = GFH3): number {
  const t = tallyGrouping("g1", rows, 18, cfg);
  return t.lines[hole - 1].pot;
}

describe("the pot carries WHOLE, not one hole at a time", () => {
  it("a tie on 16 makes 17 worth 4, and a tie on 17 then makes 18 worth 6", () => {
    /**
     * THE test. Every hole 1–15 is won, so nothing is carried into the glorious
     * stretch and the arithmetic is only about 16, 17 and 18.
     *
     * What this fails against, and why the fixture crosses the GFH boundary
     * deliberately:
     *
     *   · a carry that counts TIED HOLES rather than pot VALUE — the shape
     *     `sideBets.ts` ships (`pot = amount * (1 + carried)`) — gives 17 a pot
     *     of 2 and 18 a pot of 3.
     *   · a carry that adds a flat 1 per tie on top of the hole's own value —
     *     the natural reading of "the pot carries over" — gives 3 and 4.
     *
     * Both are self-consistent, both look right, and both are refuted here. On a
     * fixture that stayed inside holes 1–15 all three builds agree exactly.
     */
    const afterSixteen = [...allWonThrough(15, P1), tied(16)];
    expect(potOf(afterSixteen, 17)).toBe(4);

    const afterSeventeen = [...afterSixteen, tied(17)];
    expect(potOf(afterSeventeen, 18)).toBe(6);
  });

  it("and the same carry over an ORDINARY hole is 1 + 2, not 2", () => {
    // The third line of the spec's table, and the one that pins that a carried
    // pot brings its own weight rather than the NEXT hole's: 15 is worth 1, so
    // 16 holds its own 2 plus that 1.
    const rows = [...allWonThrough(14, P1), tied(15)];
    expect(potOf(rows, 16)).toBe(3);
  });

  it("a won hole pays its WHOLE pot to one player", () => {
    const rows = [...allWonThrough(15, P1), tied(16), won(17, P2)];
    const t = tallyGrouping("g1", rows, 18, GFH3);
    // 15 skins from holes 1–15, and nothing from the tie.
    expect(t.skinsBy[P1]).toBe(15);
    // Hole 17: its own 2, plus 16's whole pot of 2.
    expect(t.skinsBy[P2]).toBe(4);
    // …and the pot is cleared, so 18 is worth its own value alone.
    expect(t.lines[17].pot).toBe(2);
    expect(t.carried).toBe(0);
  });
});

describe("a tied final hole destroys the pot", () => {
  it("pays nobody, and does not split or roll", () => {
    const rows = [...allWonThrough(15, P1), tied(16), tied(17), tied(18)];
    const t = tallyGrouping("g1", rows, 18, GFH3);

    // 6 sat on 18 (its own 2 plus 4 carried) and went nowhere.
    expect(t.carried).toBe(6);
    expect(t.potIsDead).toBe(true);
    // Nobody gained anything from the last three holes.
    expect(t.skinsBy[P1]).toBe(15);
    expect(t.skinsBy[P2]).toBeUndefined();
    expect(t.awarded).toBe(15);
    // The grouping plays for 21; six of them were destroyed.
    expect(t.awarded + t.carried).toBe(skinsPerGrouping(18, GFH3));
  });

  it("`carried` alone cannot say whether a pot is live or dead", () => {
    /**
     * The two states are the same NUMBER, and a reader has to act differently on
     * them: mid-round a 6 is what the next hole is playing for, and after a tied
     * 18 it is money nobody will ever see. `potIsDead` is what separates them,
     * which is why it is a field rather than something the caller infers.
     *
     * Written as a pair because either fixture alone passes against a build that
     * hardcodes the flag.
     */
    const live = tallyGrouping("g1", [...allWonThrough(15, P1), tied(16), tied(17)], 18, GFH3);
    const dead = tallyGrouping("g1", [...allWonThrough(15, P1), tied(16), tied(17), tied(18)], 18, GFH3);
    expect(live.carried).toBe(4);
    expect(live.potIsDead).toBe(false);
    expect(dead.potIsDead).toBe(true);
  });

  it("a hole WON on 18 is paid normally", () => {
    const t = tallyGrouping("g1", [...allWonThrough(15, P1), tied(16), tied(17), won(18, P3)], 18, GFH3);
    expect(t.skinsBy[P3]).toBe(6);
    expect(t.potIsDead).toBe(false);
    expect(t.carried).toBe(0);
  });
});

describe("a tied hole and an unentered hole are different facts", () => {
  it("only a TIE carries; an unplayed hole leaves the pot where it was", () => {
    /**
     * The empty-is-not-unknown rule, at the level it actually bites. If an
     * unplayed hole carried, a group two holes behind would inflate every pot in
     * front of them — and the board would read as though ties had happened that
     * did not.
     */
    const withGap = [won(1, P1), /* 2 not entered */ won(3, P2)];
    const t = tallyGrouping("g1", withGap, 18, NO_GLORIOUS);
    expect(t.lines[1].status).toBe("unplayed");
    // Hole 3 is worth its own 1 — hole 2 has not happened, so nothing carried.
    expect(t.lines[2].pot).toBe(1);
    expect(t.skinsBy[P2]).toBe(1);

    const withTie = [won(1, P1), tied(2), won(3, P2)];
    const t2 = tallyGrouping("g1", withTie, 18, NO_GLORIOUS);
    expect(t2.lines[2].pot).toBe(2);
    expect(t2.skinsBy[P2]).toBe(2);
  });

  it("entering the missed hole later re-derives the pots in front of it", () => {
    // Nothing is snapshotted, so a late entry is just a re-fold. This is the
    // property that lets a group enter holes out of order without a migration.
    const late = [won(1, P1), tied(2), won(3, P2)];
    expect(potOf(late, 3, NO_GLORIOUS)).toBe(2);
  });

  it("an unplayed hole still reports what it is WORTH", () => {
    // The entry screen has to say "this hole is worth 4" before anybody taps,
    // which is the question carryover makes interesting. `sideBets` populates
    // `pot` on undecided holes for the same reason.
    const rows = [...allWonThrough(15, P1), tied(16)];
    const t = tallyGrouping("g1", rows, 18, GFH3);
    expect(t.lines[16].status).toBe("unplayed");
    expect(t.lines[16].pot).toBe(4);
    expect(t.lines[16].carriedIn).toBe(2);
    expect(t.lines[16].ownValue).toBe(2);
  });
});

describe("the groupings are independent contests", () => {
  it("a tie in one grouping does not change another's pot", () => {
    /**
     * The case a single-grouping fixture cannot show, and the one the format
     * exists for.
     *
     * A build with ONE shared carryover state passes every other test in this
     * file. Here it gives group B's hole 17 a pot of 4 — inheriting A's tie —
     * where it should be 2.
     */
    const rows = {
      A: [...allWonThrough(15, P1), tied(16)],
      B: [...allWonThrough(16, P2)],
    };
    const t = tallySkins(["A", "B"], rows, 18, GFH3);

    expect(t.A.lines[16].pot, "the grouping that tied should carry").toBe(4);
    expect(t.B.lines[16].pot, "the grouping that did NOT tie must not").toBe(2);
    expect(t.A.carried).toBe(2);
    expect(t.B.carried).toBe(0);
  });

  it("every grouping plays for the same total", () => {
    // 15 ordinary holes at 1 plus 3 glorious at 2 — and the identity the spec
    // states: holes + the GFH count.
    expect(skinsPerGrouping(18, GFH3)).toBe(21);
    expect(skinsPerGrouping(18, GFH3)).toBe(18 + GFH3.n);
    expect(skinsPerGrouping(18, NO_GLORIOUS)).toBe(18);

    const rows = { A: allWonThrough(18, P1), B: allWonThrough(18, P2) };
    const t = tallySkins(["A", "B"], rows, 18, GFH3);
    expect(t.A.awarded).toBe(21);
    expect(t.B.awarded).toBe(21);
  });

  it("a grouping with nothing recorded has an empty tally, not a missing one", () => {
    const t = tallySkins(["A", "B"], { A: allWonThrough(3, P1) }, 18, NO_GLORIOUS);
    expect(t.B).toBeDefined();
    expect(t.B.awarded).toBe(0);
    expect(t.B.lines.every((l) => l.status === "unplayed")).toBe(true);
  });
});

describe("standings", () => {
  it("rank the whole field by skins, best first, ties sharing a position", () => {
    const tallies = tallySkins(
      ["A", "B"],
      {
        A: [won(1, P1), won(2, P1), won(3, P2)],
        B: [won(1, P3), won(2, P3), won(3, P3)],
      },
      18,
      NO_GLORIOUS
    );
    const rows = computeSkinsStandings(
      [
        { userId: P1, groupingId: "A" },
        { userId: P2, groupingId: "A" },
        { userId: P3, groupingId: "B" },
      ],
      tallies
    );
    expect(rows.map((r) => [r.entityId, r.skins, r.position])).toEqual([
      [P3, 3, 1],
      [P1, 2, 2],
      [P2, 1, 3],
    ]);
  });

  it("MORE IS BETTER — the field is not ranked upside down", () => {
    // A skins board sorted low-first is the single most likely way this format
    // ships broken, because every other assertion in this file is about the
    // POT and would pass either way.
    const tallies = tallySkins(["A"], { A: [won(1, P1), won(2, P1), won(3, P2)] }, 18, NO_GLORIOUS);
    const rows = computeSkinsStandings(
      [{ userId: P1, groupingId: "A" }, { userId: P2, groupingId: "A" }],
      tallies
    );
    expect(rows[0].entityId).toBe(P1);
    expect(rows[0].skins).toBeGreaterThan(rows[1].skins);
  });

  it("a player who has won nothing still has a row, and carries their grouping", () => {
    // Deriving the field from the winners would drop everybody having a bad day,
    // which on a skins card is most of them.
    const tallies = tallySkins(["A"], { A: [won(1, P1)] }, 18, NO_GLORIOUS);
    const rows = computeSkinsStandings(
      [{ userId: P1, groupingId: "A" }, { userId: P2, groupingId: "A" }],
      tallies
    );
    expect(rows).toHaveLength(2);
    const ben = rows.find((r) => r.entityId === P2)!;
    expect(ben.skins).toBe(0);
    expect(ben.groupingId).toBe("A");
  });

  it("0 in a started grouping and 0 in one that has not teed off are different", () => {
    /**
     * Same number, two facts, and a reader acts differently on them: one player
     * has won nothing over nine holes, the other has not begun. `started` is
     * per-GROUPING because that is where play happens — a player on 0 in a
     * grouping four holes in has genuinely been beaten four times.
     */
    const tallies = tallySkins(["A", "B"], { A: [won(1, P1)] }, 18, NO_GLORIOUS);
    const rows = computeSkinsStandings(
      [
        { userId: P2, groupingId: "A" },
        { userId: P3, groupingId: "B" },
      ],
      tallies
    );
    const inPlay = rows.find((r) => r.entityId === P2)!;
    const notStarted = rows.find((r) => r.entityId === P3)!;
    expect(inPlay.skins).toBe(notStarted.skins);
    expect(inPlay.started).toBe(true);
    expect(notStarted.started).toBe(false);
  });
});

describe("the glorious reader", () => {
  it("is on for a skins game with the modifier, and inert without it", () => {
    expect(skinsGloriousConfig("gtt_skins", { glorious_holes: { holes: 3 } })).toEqual({
      enabled: true,
      n: 3,
    });
    expect(skinsGloriousConfig("gtt_skins", {})).toEqual(NO_GLORIOUS);
    expect(skinsGloriousConfig("gtt_skins", null)).toEqual(NO_GLORIOUS);
  });

  it("refuses to weight a NON-skins game, whatever its modifiers say", () => {
    // The format guard, in the same shape `gloriousConfig` uses. Without it a
    // stroke game carrying a stray `glorious_holes` key would be weighted by a
    // reader that has no business looking at it.
    expect(skinsGloriousConfig("gtt_stroke_play", { glorious_holes: { holes: 3 } })).toEqual(NO_GLORIOUS);
    expect(skinsGloriousConfig("gtt_match_play", { glorious_holes: { holes: 3 } })).toEqual(NO_GLORIOUS);
    expect(skinsGloriousConfig(null, { glorious_holes: { holes: 3 } })).toEqual(NO_GLORIOUS);
  });

  it("weights exactly the last N holes", () => {
    const t = tallyGrouping("g1", [], 18, { enabled: true, n: 3 });
    expect(t.lines.map((l) => l.ownValue)).toEqual([
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2,
    ]);
  });
});
