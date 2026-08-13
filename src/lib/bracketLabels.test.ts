import { describe, it, expect } from "vitest";
import { buildDraw } from "./bracket";
import { resolveDraw, matchKey } from "./bracketAdvance";
import { bracketDisplay, roundName } from "./bracketLabels";

/**
 * Match numbering and the "Winner of N" labels.
 *
 * Structural derivations, not decoration: an off-by-one here produces a bracket
 * whose numbers skip, or a semi-final that says it is waiting on the wrong
 * match — both of which read as authoritative and would only be caught by
 * someone counting on a phone.
 */

const display = (entrants: number, opts?: { consolation: boolean }) =>
  bracketDisplay(resolveDraw(buildDraw(entrants, opts ?? { consolation: false })));
const key = (round: number, slot: number, bracket: "main" | "consolation" = "main") =>
  matchKey({ bracket, round, slot });

describe("numbering", () => {
  it("runs main-draw first, in round then slot order", () => {
    const d = display(8);
    expect(d.get(key(1, 1))!.number).toBe(1);
    expect(d.get(key(1, 4))!.number).toBe(4);
    expect(d.get(key(2, 1))!.number).toBe(5);
    expect(d.get(key(2, 2))!.number).toBe(6);
    expect(d.get(key(3, 1))!.number).toBe(7);
  });

  it("puts the consolation match LAST — nothing feeds from it", () => {
    // It is played alongside the final but numbered after it, which is what
    // keeps every feeder's number lower than the match it feeds.
    const d = display(4, { consolation: true });
    expect(d.get(key(2, 1))!.number).toBe(3);
    expect(d.get(key(2, 1, "consolation"))!.number).toBe(4);
  });

  it("numbers every match exactly once", () => {
    const d = display(8, { consolation: true });
    const numbers = [...d.values()].map((v) => v.number).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1));
  });
});

describe("pending labels", () => {
  it("a later round names its feeders, and the numbers are always lower", () => {
    const d = display(8);
    expect(d.get(key(2, 1))!.aPending).toBe("Winner of 1");
    expect(d.get(key(2, 1))!.bPending).toBe("Winner of 2");
    expect(d.get(key(2, 2))!.aPending).toBe("Winner of 3");
    expect(d.get(key(2, 2))!.bPending).toBe("Winner of 4");
    expect(d.get(key(3, 1))!.aPending).toBe("Winner of 5");
    expect(d.get(key(3, 1))!.bPending).toBe("Winner of 6");
  });

  it("follows the SAME wiring resolveDraw advances along", () => {
    // Seat A is fed by the odd slot below, seat B by the even one. If the label
    // and the advancement ever disagreed, the bracket would name one match and
    // fill from another — and both would look plausible.
    const d = display(4);
    expect(d.get(key(2, 1))!.aPending).toBe("Winner of 1");
    expect(d.get(key(2, 1))!.bPending).toBe("Winner of 2");
  });

  it("drops the label once a seat is filled — the occupant IS the label", () => {
    const winners = { [key(1, 1)]: 1 };
    const d = bracketDisplay(resolveDraw(buildDraw(4), winners));
    expect(d.get(key(2, 1))!.aPending).toBeNull();
    expect(d.get(key(2, 1))!.bPending).toBe("Winner of 2");
  });

  it("round 1 has no feeders to name", () => {
    const d = display(4);
    expect(d.get(key(1, 1))!.aPending).toBeNull();
    expect(d.get(key(1, 1))!.bPending).toBeNull();
  });

  it("a BYE's empty half is not 'Winner of' anything", () => {
    // Nobody plays it, so there is no feeder and no pending state — the view
    // names it "Bye" from its own flag.
    const d = display(3);
    expect(d.get(key(1, 1))!.bPending).toBeNull();
  });

  it("the consolation match names the LOSERS of the semis", () => {
    const d = display(4, { consolation: true });
    expect(d.get(key(2, 1, "consolation"))!.aPending).toBe("Loser of 1");
    expect(d.get(key(2, 1, "consolation"))!.bPending).toBe("Loser of 2");
  });

  it("an 8-draw's consolation reads the semis, not the quarters", () => {
    const d = display(8, { consolation: true });
    expect(d.get(key(3, 1, "consolation"))!.aPending).toBe("Loser of 5");
    expect(d.get(key(3, 1, "consolation"))!.bPending).toBe("Loser of 6");
  });
});

describe("roundName", () => {
  it("names the last three rounds and numbers the rest", () => {
    expect(roundName(3, 3)).toBe("Final");
    expect(roundName(2, 3)).toBe("Semi-finals");
    expect(roundName(1, 3)).toBe("Quarter-finals");
    expect(roundName(1, 5)).toBe("Round 1");
  });

  it("a two-entrant draw is just a Final", () => {
    expect(roundName(1, 1)).toBe("Final");
  });
});
