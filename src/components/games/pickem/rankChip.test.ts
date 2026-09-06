import { describe, it, expect } from "vitest";
import { chipValue } from "./PickemSheetRow";

/**
 * THE RANK CHIP SHOWS A DIFFERENT NUMBER WHEN RANKS DO NOT VARY.
 *
 * ── The reported oddity ──────────────────────────────────────────────────
 *
 * With confidence OFF every stake is 1 (times the multiplier), so a settled
 * sheet showed a column of 1s with the wrong ones crossed out. A crossed-out 1
 * is a laborious way to write 0, and the number was doing no work at all — the
 * strike was carrying the whole fact.
 *
 * With confidence ON the stake is exactly what you want: a 16 struck through
 * says you spent your best rank and got nothing, which a 0 cannot say. So the
 * chip's own doc argues at length for showing the stake, and that argument is
 * about CONFIDENCE and only confidence.
 *
 * ── What makes dropping the strike safe NOW and not before ───────────────
 *
 * The objection to showing earned is that 0 appears for both a miss and a
 * push — one number for opposite facts, which is this feature's recurring
 * mistake. It is answered elsewhere on the row rather than here, and only as
 * of this round: a miss has the cover box on the OTHER side and a struck team
 * name; a push has no box on either side and an unstruck one. Both marks are
 * new. Before them, this change would have merged two states.
 */

describe("confidence ON — the stake, and a line through a miss", () => {
  it("shows what was staked whatever became of it", () => {
    // Earned would print 0 on a miss and a push alike, and would make the wrong
    // picks vanish into a column of zeroes — the thing a finished sheet is
    // scanned for.
    expect(chipValue({ stake: 16, outcome: "won", ranksMatter: true }).value).toBe(16);
    expect(chipValue({ stake: 16, outcome: "lost", ranksMatter: true }).value).toBe(16);
    expect(chipValue({ stake: 16, outcome: "void", ranksMatter: true }).value).toBe(16);
  });

  it("strikes a miss, and only a miss", () => {
    expect(chipValue({ stake: 16, outcome: "lost", ranksMatter: true }).struck).toBe(true);
    expect(chipValue({ stake: 16, outcome: "won", ranksMatter: true }).struck).toBe(false);
    // A push paid nobody and was not WRONG — the same distinction the team
    // names make one line up.
    expect(chipValue({ stake: 16, outcome: "void", ranksMatter: true }).struck).toBe(false);
  });
});

describe("confidence OFF — what was earned, and no line", () => {
  it("shows 0 for a miss instead of a crossed-out 1", () => {
    /**
     * THE MUTATION: leave `ranksMatter` unread. That build still renders a
     * chip, still renders the right colour, and still passes every assertion in
     * the block above — it just keeps printing the stake with a line through
     * it, which is the thing that was reported.
     */
    expect(chipValue({ stake: 1, outcome: "lost", ranksMatter: false })).toEqual({
      value: 0,
      struck: false,
    });
  });

  it("shows what a correct pick earned, multiplier included", () => {
    // The one case where the number is worth reading with confidence off: a 2x
    // game pays 2, and the chip is where that shows.
    expect(chipValue({ stake: 2, outcome: "won", ranksMatter: false })).toEqual({
      value: 2,
      struck: false,
    });
  });

  it("shows 0 for a push, which earned nothing either", () => {
    expect(chipValue({ stake: 1, outcome: "void", ranksMatter: false }).value).toBe(0);
  });

  it("never strikes anything at all", () => {
    // The other half: a build that showed earned AND kept the strike would put
    // a line through a 0, which says nothing twice.
    for (const outcome of ["won", "lost", "void"] as const) {
      expect(chipValue({ stake: 1, outcome, ranksMatter: false }).struck, outcome).toBe(false);
    }
  });
});

describe("an undecided row is not a zero", () => {
  it("shows the stake, unstruck, whichever mode is running", () => {
    /**
     * Empty is not unknown, at the one place the two are a single result away.
     * A 0 here would report a loss on a game nobody has played.
     *
     * Unreachable through the sheet with confidence off — an unplayed row has
     * no chip at all there — which is exactly why it is asserted rather than
     * left to the caller to keep true.
     */
    for (const ranksMatter of [true, false]) {
      expect(chipValue({ stake: 7, outcome: null, ranksMatter })).toEqual({
        value: 7,
        struck: false,
      });
    }
  });
});
