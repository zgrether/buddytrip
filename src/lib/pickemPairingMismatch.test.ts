import { describe, it, expect } from "vitest";
import { pairingMismatch, type PickemPair } from "./pickemPairing";

/**
 * `pairingMismatch` — where the saved pairing and the current rosters disagree.
 *
 * The state these describe is reachable in one tap and is completely silent:
 * change a roster after pairing, and the grid keeps rendering the people it was
 * saved with while the picker offers the people who are on a side now. Zach met
 * all three at once — a paired player on no team, a rostered player in no
 * match, and 8-v-7 sides — and read it as "the builder has a different set of
 * players than the matches", which is precisely true.
 */

const pair = (a: string | null, b: string | null): PickemPair => ({ a, b });

describe("pairingMismatch", () => {
  it("is silent when the pairing and the rosters agree", () => {
    const m = pairingMismatch([pair("a1", "b1"), pair("a2", "b2")], ["a1", "a2"], ["b1", "b2"]);
    expect(m).toEqual({ offRoster: [], unpaired: [], unevenBy: 0, largerSide: null });
  });

  it("names someone PAIRED who is no longer on either team", () => {
    // The exact live case: a pairing holds a player a roster change dropped.
    const m = pairingMismatch([pair("ghost", "b1")], ["a1"], ["b1"]);
    expect(m.offRoster).toEqual(["ghost"]);
    // ...and the person who replaced them, who is now in no match.
    expect(m.unpaired).toEqual(["a1"]);
  });

  it("names someone ROSTERED who is in no match", () => {
    const m = pairingMismatch([pair("a1", "b1")], ["a1", "a2"], ["b1"]);
    expect(m.unpaired).toEqual(["a2"]);
    expect(m.offRoster).toEqual([]);
  });

  it("counts how many CANNOT be given an opponent, and says which side", () => {
    // 8 v 7 — the shape that made `open` refuse by naming one person, with
    // nothing on the pairing screen explaining why they could not be paired.
    const a = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"];
    const b = ["b1", "b2", "b3", "b4", "b5", "b6", "b7"];
    const m = pairingMismatch([], a, b);
    expect(m.unevenBy).toBe(1);
    expect(m.largerSide).toBe(0);
  });

  it("reports the OTHER side when it is the larger one", () => {
    // Asserts the direction rather than just the magnitude: `Math.abs` alone
    // would pass a version that always blamed side A.
    const m = pairingMismatch([], ["a1"], ["b1", "b2", "b3"]);
    expect(m.unevenBy).toBe(2);
    expect(m.largerSide).toBe(1);
  });

  it("does not count an EMPTY SLOT as a person", () => {
    // A half-filled row is the normal mid-edit state. Reading `null` as a
    // participant would report a phantom off-roster player on every open slot.
    const m = pairingMismatch([pair("a1", null), pair(null, null)], ["a1"], []);
    expect(m.offRoster).toEqual([]);
    expect(m.unpaired).toEqual([]);
  });

  it("is unaffected by which SLOT a person sits in", () => {
    // Someone placed on the wrong side is still paired and still rostered. This
    // helper answers "who is missing / who is a stranger", not "is the pairing
    // sensible" — a stricter check here would fire on a legal mid-edit swap.
    const m = pairingMismatch([pair("b1", "a1")], ["a1"], ["b1"]);
    expect(m.offRoster).toEqual([]);
    expect(m.unpaired).toEqual([]);
  });
});
