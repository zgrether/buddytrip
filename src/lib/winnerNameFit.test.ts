import { describe, it, expect } from "vitest";
import { FIT_SLACK_PX, nameWords, winnerNameFit, winnerNameStyle } from "./winnerNameFit";
import { WINNER_NAME_FLOOR_PX, WINNER_NAME_PX } from "./teamTextColor";

/**
 * A winning name at a Final: 20px bold, lowered just enough for its longest word to
 * fit the column, never below 14pt bold, and past that it breaks (#1703).
 *
 * The node suite has no layout engine, so the MEASURING half (`useWinnerNameFit`)
 * is not covered here: jsdom-free, every width would read 0 and everything would
 * "fit". It was checked in a browser at 390px in #1704: "Hammer Schlägerknockers"
 * lands on 18.82px in two lines, "Hammer Schlägerknockerhausen" on 18.67px with the
 * break, and "Centurions" stays at 20px. This pins the rule those numbers came from.
 */

/** A column whose room (column less the slack) is exactly `room`. */
const col = (room: number) => room + FIT_SLACK_PX;

describe("winnerNameFit", () => {
  it("a word that fits keeps the full 20px and wraps normally", () => {
    expect(winnerNameFit(120, col(155))).toEqual({ size: WINNER_NAME_PX, breakAnywhere: false });
    expect(winnerNameFit(155, col(155))).toEqual({ size: WINNER_NAME_PX, breakAnywhere: false });
  });

  it("a word a little too wide lowers the size just enough to fit, not further", () => {
    // 164px at 20px into 155px: 20 x 155 / 164 = 18.902..., floored to the hundredth.
    const fit = winnerNameFit(164, col(155));
    expect(fit).toEqual({ size: 18.9, breakAnywhere: false });
    // And the word does fit at that size, since width scales with size.
    expect((164 * fit.size) / WINNER_NAME_PX).toBeLessThanOrEqual(155);
  });

  it("the floor holds: a word that fits exactly at 18.67px lands there, with no break", () => {
    // 20 x 186.7 / 200 = 18.67
    expect(winnerNameFit(200, col(186.7))).toEqual({ size: WINNER_NAME_FLOOR_PX, breakAnywhere: false });
  });

  it("FALLBACK: a word too wide even at the floor stays at the floor and breaks anywhere", () => {
    // 20 x 186.7 / 201 = 18.577..., under the floor.
    expect(winnerNameFit(201, col(186.7))).toEqual({ size: WINNER_NAME_FLOOR_PX, breakAnywhere: true });
    // However much too wide, never below the floor.
    expect(winnerNameFit(1000, col(100))).toEqual({ size: WINNER_NAME_FLOOR_PX, breakAnywhere: true });
  });

  it("the floor is 14pt bold, the WCAG large-text line, so a winner's bar is always 3 : 1", () => {
    expect(WINNER_NAME_FLOOR_PX).toBeGreaterThanOrEqual((14 * 4) / 3);
    expect(WINNER_NAME_FLOOR_PX).toBeLessThan(19);
  });
});

describe("winnerNameStyle", () => {
  it("the size goes to the name; only the fallback sets overflow-wrap", () => {
    expect(winnerNameStyle({ size: 18.9, breakAnywhere: false })).toEqual({ fontSize: 18.9 });
    expect(winnerNameStyle({ size: WINNER_NAME_FLOOR_PX, breakAnywhere: true })).toEqual({ fontSize: WINNER_NAME_FLOOR_PX, overflowWrap: "anywhere" });
  });
});

describe("nameWords", () => {
  it("splits where the browser may wrap, so the longest WORD is measured, not the name", () => {
    expect(nameWords("  Hammer   Schlägerknockers ")).toEqual(["Hammer", "Schlägerknockers"]);
    expect(nameWords("Ham, Egg, & Cheese")).toEqual(["Ham,", "Egg,", "&", "Cheese"]);
    expect(nameWords("")).toEqual([]);
  });
});
