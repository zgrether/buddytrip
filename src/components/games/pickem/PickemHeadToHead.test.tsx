import { describe, it, expect } from "vitest";
import { swingCell, h2hPill } from "./PickemHeadToHead";
import { h2hNote } from "./PickemMatchCard";
import type { BoardRow, MatchStanding } from "@/lib/pickemBoard";

/**
 * Screen D's decision table.
 *
 * The swing cell is the reason the screen exists, and it has nine states that
 * mostly render two or three characters — which is exactly the shape where a
 * wrong one goes unnoticed.
 */

const row = (over: Partial<BoardRow> = {}): BoardRow => ({
  slateGameId: "g1",
  result: null,
  multiplier: 1,
  aPick: "home",
  bPick: "home",
  aConfidence: null,
  bConfidence: null,
  aPoints: 0,
  bPoints: 0,
  swing: 0,
  zeroKind: null,
  upsideA: 0,
  upsideB: 0,
  ...over,
});

describe("swingCell — played", () => {
  it("points the arrow at whoever gained", () => {
    // A is the left column, so A gaining points left.
    expect(swingCell(row({ result: "home", swing: 13 }))).toEqual({ dir: "a", text: "◀ 13" });
    expect(swingCell(row({ result: "home", swing: -6 }))).toEqual({ dir: "b", text: "6 ▶" });
  });

  it("gives each of the four zeros its own word, never a dash", () => {
    /**
     * Four different FACTS that all produce nothing, and only one of them is
     * anybody's fault. A dash for all four would tell the reader a cancelled
     * game was played.
     */
    const cases: [BoardRow["zeroKind"], string][] = [
      ["push", "Push"],
      ["cancelled", "Void"],
      ["both", "Both"],
      ["neither", "Neither"],
    ];
    const seen = new Set<string>();
    for (const [zeroKind, text] of cases) {
      const cell = swingCell(row({ result: "home", swing: 0, zeroKind }));
      expect(cell, String(zeroKind)).toEqual({ dir: "zero", text });
      seen.add(cell.text);
    }
    // Four distinct strings — a map that collapsed two of them would satisfy
    // every assertion above if they happened to share a value.
    expect(seen.size).toBe(4);
  });
});

describe("swingCell — unplayed", () => {
  it("shows both stakes when the two disagree", () => {
    expect(swingCell(row({ upsideA: 16, upsideB: 9 }))).toEqual({
      dir: "both",
      text: "16↔9",
    });
  });

  it("never renders a symmetric ± on an agreement row", () => {
    /**
     * Both took the same team, one at 16 and one at 3. They both bank or both
     * miss, so only the DIFFERENCE can move the match — `upsideFor` already
     * collapses it to one side, and this must read that rather than restating
     * both ranks.
     *
     * The failing build renders "16↔3", which claims sixteen points are on a
     * game that can move the match by thirteen.
     */
    const cell = swingCell(row({ upsideA: 13, upsideB: 0 }));
    expect(cell).toEqual({ dir: "a", text: "◀ 13" });
    expect(cell.text).not.toContain("↔");

    expect(swingCell(row({ upsideA: 0, upsideB: 4 }))).toEqual({ dir: "b", text: "4 ▶" });
  });

  it("dashes ONLY when nobody can gain — an absence of stake, not a zero", () => {
    /**
     * The one legitimate dash on this screen. Both agreed at the same rank, so
     * the game cannot move the match at all — there is no fact to report and
     * nothing happened to report it about.
     *
     * Distinct from the played zeros above, which are outcomes with reasons.
     */
    expect(swingCell(row({ upsideA: 0, upsideB: 0 }))).toEqual({ dir: "none", text: "—" });
  });

  it("does not confuse a zero-swing PLAYED row with an unplayed one", () => {
    // Same numbers, opposite facts — the empty-versus-unknown split, in a cell
    // three characters wide.
    const played = swingCell(row({ result: "push", swing: 0, zeroKind: "push" }));
    const unplayed = swingCell(row({ upsideA: 0, upsideB: 0 }));
    expect(played.text).toBe("Push");
    expect(unplayed.text).toBe("—");
  });
});

const st = (over: Partial<MatchStanding> = {}): MatchStanding => ({
  aTotal: 0,
  bTotal: 0,
  margin: 0,
  remaining: 0,
  trailingUpside: 0,
  clinched: false,
  ...over,
});

const BOTH = { a: true, b: true } as const;
const NAMES = { a: "Zach", b: "Ty" } as const;

describe("h2hNote — the trailer's question, not the leader's", () => {
  it("says what the TRAILER needs, and from how many", () => {
    /**
     * The card names the leader because it is scanned in a list of eight. This
     * screen is opened by somebody who already knows the score and is asking
     * what it would take, so the subject changes with the reader.
     */
    const note = h2hNote(
      st({ margin: 7, remaining: 6, trailingUpside: 21 }),
      2,
      "Zach",
      BOTH,
      NAMES
    );
    expect(note).toBe("Ty needs 8 from 6 games · 21 in play");
  });

  it("counts one game as a game", () => {
    const note = h2hNote(st({ margin: -3, remaining: 1, trailingUpside: 5 }), 7, "Ty", BOTH, NAMES);
    expect(note).toBe("Zach needs 4 from 1 game · 5 in play");
  });

  it("defers to the card's sentence everywhere else", () => {
    /**
     * A clinch is a clinch and a final is a final; two sentences that must
     * always agree are two that eventually will not. The delegation is the
     * assertion — these strings are the CARD's, verbatim.
     */
    expect(h2hNote(st({ remaining: 0, margin: -12 }), 8, "Ty", BOTH, NAMES)).toBe(
      "Ty takes it by 12"
    );
    expect(
      h2hNote(st({ remaining: 4, margin: 30, clinched: true, trailingUpside: 9 }), 4, "Zach", BOTH, NAMES)
    ).toBe("Zach is safe — only 9 in play against a 30 lead");
    expect(h2hNote(st({ remaining: 8 }), 0, "Zach", BOTH, NAMES)).toBe("No games in yet");
    expect(h2hNote(st({ remaining: 3 }), 5, "Zach", BOTH, NAMES)).toBe("Level with 3 to play");
    expect(
      h2hNote(st({ remaining: 9, margin: -17 }), 7, "Ty", { a: false, b: true }, NAMES)
    ).toBe("Zach didn't submit a sheet — it scores nothing, so Ty takes the match");
  });
});

describe("h2hPill", () => {
  it("spends the live pill on the number a reader wants there", () => {
    expect(h2hPill([row({ result: "home", swing: 3 }), row()], 1, BOTH)).toBe("1 left");
  });

  it("reuses the shared verdict for the states that are shared", () => {
    // Derived from `matchPill`, so a clinch cannot be a clinch on one screen
    // and something else on the other.
    const decided = [row({ result: "home", swing: 40 })];
    expect(h2hPill(decided, 1, BOTH)).toBe("Final");
    expect(h2hPill(decided, 1, { a: true, b: false })).toBe("Final");
    const live = [row({ result: "home", swing: 40 }), row({ upsideA: 0, upsideB: 1 })];
    expect(h2hPill(live, 1, { a: true, b: false })).toBe("Didn’t pick");
  });
});
