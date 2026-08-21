import { describe, it, expect } from "vitest";
import { buildDoubleDraw } from "./bracketDouble";
import { resolveDoubleDraw } from "./bracketDoubleAdvance";
import { doubleBracketDisplay, doubleRoundName } from "./bracketDoubleLabels";
import { matchKey, type ResolvedMatch, type WinnerBySeed } from "./bracketAdvance";

/**
 * Match identity and seat labels for a double-elim board.
 *
 * The vacant cases are the reason this file exists. At 8 entrants there are no byes, so
 * every seat is either filled or waiting and the third state never renders — which is
 * exactly the condition under which "waiting" and "permanently empty" got conflated in
 * the first place. These pin the odd counts, where they diverge.
 */

const at = (n: number, winners: WinnerBySeed = {}) => {
  const draw = buildDoubleDraw(n);
  const resolved = resolveDoubleDraw(draw, winners);
  return { resolved, display: doubleBracketDisplay(resolved) };
};
const of = (d: Map<string, ReturnType<typeof doubleBracketDisplay> extends Map<string, infer V> ? V : never>, m: ResolvedMatch) =>
  d.get(matchKey(m))!;

describe("match identity (T1)", () => {
  it.each([3, 4, 5, 6, 7, 8, 9, 16])("numbers EVERY match exactly once at %i entrants", (n) => {
    const { resolved, display } = at(n);
    const numbers = resolved.map((m) => of(display, m).number);
    // Every match has an identity, and no two share one — the property a placeholder
    // needs to name another match unambiguously.
    expect(numbers).toHaveLength(resolved.length);
    expect(new Set(numbers).size).toBe(resolved.length);
    expect([...numbers].sort((a, b) => a - b)).toEqual(resolved.map((_, i) => i + 1));
  });

  it("numbers continuously across all three brackets", () => {
    const { resolved, display } = at(8);
    const num = (b: string, r: number, s: number) =>
      of(display, resolved.find((m) => m.bracket === b && m.round === r && m.slot === s)!).number;
    expect(num("main", 1, 1)).toBe(1);
    expect(num("main", 3, 1)).toBe(7);   // upper final
    expect(num("lower", 1, 1)).toBe(8);
    expect(num("lower", 4, 1)).toBe(13); // lower final
    expect(num("final", 1, 1)).toBe(14);
    expect(num("final", 2, 1)).toBe(15); // if necessary
  });
});

describe("placeholders (T2)", () => {
  it("names the SOURCE of every waiting seat, never a bare dash", () => {
    const { resolved, display } = at(8);
    const find = (b: string, r: number, s: number) => resolved.find((m) => m.bracket === b && m.round === r && m.slot === s)!;

    // The lower bracket starts with upper round 1's losers.
    const l1 = of(display, find("lower", 1, 1));
    expect(l1.aPending).toBe("Loser of 1");
    expect(l1.bPending).toBe("Loser of 2");

    // A MAJOR round: a survivor meets the batch dropping from `main`, REVERSED — so
    // match 8's winner meets the loser of 6, not of 5. Pairing it with 5 would replay
    // the match its occupants just lost, which is the whole reason for the reversal.
    const l2 = of(display, find("lower", 2, 1));
    expect(l2.aPending).toBe("Winner of 8");
    expect(l2.bPending).toBe("Loser of 6");

    // The convergence, stated in the labels.
    const gf = of(display, find("final", 1, 1));
    expect(gf.aPending).toBe("Winner of 7");  // upper final
    expect(gf.bPending).toBe("Winner of 13"); // lower final
  });

  it("names the reset's seats as the winner and loser of the first final", () => {
    // Round 2 is contested by the SAME two entrants, so it can say so honestly rather
    // than sitting blank — which is what made it read as a bug when it appeared.
    const { resolved, display } = at(8);
    const gf2 = of(display, resolved.find((m) => m.bracket === "final" && m.round === 2)!);
    expect([gf2.aPending, gf2.bPending]).toEqual(["Winner of 14", "Loser of 14"]);
    expect(gf2.aVacant).toBe(false); // still possible — must read as a possibility
  });

  it("marks a seat PERMANENTLY EMPTY when a bye upstream means nobody is coming", () => {
    // 5 of an 8-draw: three byes in upper round 1, which produces exactly ONE loser.
    // The lower seats fed by those byes are not waiting — nobody will ever sit there.
    const { resolved, display } = at(5);
    const lowerR1 = resolved.filter((m) => m.bracket === "lower" && m.round === 1);
    const vacantSeats = lowerR1.flatMap((m) => {
      const d = of(display, m);
      return [d.aVacant, d.bVacant];
    }).filter(Boolean);
    expect(vacantSeats.length, "5 entrants must leave empty lower seats").toBeGreaterThan(0);
  });

  it.each([3, 5, 6, 7, 9])("never gives a vacant seat a placeholder (%i)", (n) => {
    // The DO NOT, asserted directly: a placeholder naming a match that can never feed
    // the seat is the waiting/empty conflation reappearing with better typography.
    const { resolved, display } = at(n);
    for (const m of resolved) {
      const d = of(display, m);
      if (d.aVacant) expect(d.aPending, `${matchKey(m)} seat A`).toBeNull();
      if (d.bVacant) expect(d.bPending, `${matchKey(m)} seat B`).toBeNull();
    }
  });

  it("makes the reset vacant once the upper entrant has won the first final", () => {
    const draw = buildDoubleDraw(4);
    // Play it out with the favourite winning everywhere: seed 1 comes through `main`
    // undefeated and takes the first grand final, so no reset is needed.
    const winners: WinnerBySeed = {};
    for (let i = 0; i < 20; i++) {
      const r = resolveDoubleDraw(draw, winners);
      const next = r.find((m) => m.playable);
      if (!next) break;
      winners[matchKey(next)] = Math.min(next.aSeed!, next.bSeed!);
    }
    const resolved = resolveDoubleDraw(draw, winners);
    const d = doubleBracketDisplay(resolved);
    const gf2 = of(d, resolved.find((m) => m.bracket === "final" && m.round === 2)!);
    expect(gf2.aVacant).toBe(true);
    expect(gf2.bVacant).toBe(true);
    expect([gf2.aPending, gf2.bPending]).toEqual([null, null]);
  });
});

describe("round naming (T3)", () => {
  it("numbers rounds and names only the finals — no elimination-distance names", () => {
    // Quarter/semi-final encode how far you are from being OUT, which is a single-elim
    // property: these rounds eliminate nobody, their losers drop.
    expect(doubleRoundName("main", 1, 3)).toBe("Upper 1");
    expect(doubleRoundName("main", 2, 3)).toBe("Upper 2");
    expect(doubleRoundName("main", 3, 3)).toBe("Upper Final");
    expect(doubleRoundName("lower", 1, 4)).toBe("Lower 1");
    expect(doubleRoundName("lower", 4, 4)).toBe("Lower Final");
    expect(doubleRoundName("final", 1, 1)).toBe("Grand Final");
    expect(doubleRoundName("final", 2, 1)).toBe("If Necessary");
  });

  it("never calls the upper bracket's last round the Final", () => {
    // Match 7 is not the final; the grand final is. Naming it "Final" asserts an end
    // the tournament has not reached.
    for (const last of [2, 3, 4]) {
      expect(doubleRoundName("main", last, last)).toBe("Upper Final");
    }
  });
});
