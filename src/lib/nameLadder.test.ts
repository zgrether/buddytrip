import { describe, it, expect } from "vitest";
import {
  fitName,
  estimateEm,
  initialSurname,
  CARD_NAME_CAPACITY_EM,
  ENTRY_NAME_CAPACITY_EM,
} from "./nameLadder";

/**
 * WHAT IS AND IS NOT ASSERTABLE, stated so nobody pins the wrong thing.
 *
 * There is no layout engine here (`renderToStaticMarkup`, `environment: node`),
 * so "does this name fit in 85px" is not testable and a test claiming to check
 * it would be measuring nothing. What IS deterministic is the estimated width
 * and the rung chosen from it.
 *
 * The estimate itself was validated the only way it can be — against the
 * browser's own `measureText` in the running app. Those figures are the fixture
 * below, and they are REAL MEASUREMENTS, not expected values derived from the
 * code they check.
 *
 * They are also the reason this file no longer claims the estimate is exact: it
 * is, for strings without kerning pairs, and it is up to 3.4% high for ones
 * with them. See the bounded-error test.
 */

/** Measured in the app at 14px / weight 600, alongside what the phone showed. */
const ROSTER: Array<{ name: string; px14: number; observed: "fits" | "cut" }> = [
  { name: "JohnnyD", px14: 56, observed: "fits" },
  { name: "Bud Banks", px14: 66, observed: "fits" },
  { name: "Bill Giesler", px14: 66, observed: "fits" },
  { name: "Rob Drupp", px14: 69, observed: "fits" },
  { name: "Brad Giesler", px14: 76, observed: "cut" },
  { name: "Tyler Larson", px14: 76, observed: "cut" },
  { name: "Matt Shelley", px14: 79, observed: "cut" },
  { name: "Fake Grether", px14: 80, observed: "cut" },
  { name: "Zach Grether", px14: 82, observed: "cut" },
  { name: "JD Shumpert", px14: 82, observed: "cut" },
  { name: "Matt Facchine", px14: 89, observed: "cut" },
  { name: "Tajar Varghese", px14: 92, observed: "cut" },
  { name: "Steven Bartkus", px14: 94, observed: "cut" },
  { name: "Jeremy Merling", px14: 98, observed: "cut" },
  { name: "Julie Ann Hackett", px14: 111, observed: "cut" },
  { name: "Jason Schumacher", px14: 117, observed: "cut" },
];

describe("estimateEm — the unit that replaced character count", () => {
  /**
   * THE CLAIM THE WHOLE REDESIGN RESTS ON, and it is a BOUNDED, BIASED error
   * rather than an exact match.
   *
   * An earlier version asserted "to the pixel" on seven names that happened to
   * contain no kerning pairs. Adding the rest of the roster broke it: this
   * stack kerns "Ta" and "Va", so the estimate runs up to 3.4% HIGH there.
   *
   * The direction is what matters. Kerning only pulls glyphs closer, so a
   * missed pair can only make the estimate too BIG — which abbreviates early
   * rather than truncating. The dangerous direction is bounded at 0.5%
   * (rounding, not kerning), and that is what this pins: a future font or
   * table change that started UNDER-estimating would ship truncation, and this
   * catches it while a symmetric tolerance would not.
   */
  it("never under-estimates by more than 1%, and over-estimates by at most 4%", () => {
    for (const { name, px14 } of ROSTER) {
      const errPct = ((estimateEm(name) * 14 - px14) / px14) * 100;
      expect(
        errPct,
        `${name}: UNDER-estimated by ${(-errPct).toFixed(1)}% — this direction truncates`
      ).toBeGreaterThan(-1);
      expect(
        errPct,
        `${name}: OVER-estimated by ${errPct.toFixed(1)}% — abbreviates too eagerly`
      ).toBeLessThan(4);
    }
  });

  /**
   * THE DEMONSTRATION THAT LENGTH CANNOT WORK. Same character count, same
   * former rung, nineteen pixels apart — and an ELEVEN-character name wider
   * than a twelve. If this ever stops holding, the table is broken.
   */
  it("orders by width, not by length", () => {
    const em = (n: string) => estimateEm(n);
    expect(em("Bill Giesler")).toBeLessThan(em("Brad Giesler")); // same length
    expect(em("Brad Giesler")).toBeLessThan(em("Zach Grether")); // same length
    expect(em("Bill Giesler")).toBeLessThan(em("JD Shumpert")); // 12 chars < 11 chars
    expect(em("Julie Ann Hackett")).toBeLessThan(em("Jason Schumacher")); // 17 < 16
  });

  it("falls back for characters it has no advance for, rather than counting zero", () => {
    expect(estimateEm("Ñoño")).toBeGreaterThan(0);
    expect(estimateEm("Ñoño")).toBeCloseTo(estimateEm("nono"), 1);
  });
});

describe("the ladder", () => {
  it("leaves a name that fits completely alone", () => {
    for (const n of ["JohnnyD", "Bud Banks", "Bill Giesler", "Rob Drupp"]) {
      expect(fitName(n, CARD_NAME_CAPACITY_EM)).toEqual({ text: n, step: 1 });
    }
  });

  it("abbreviates a name that does not", () => {
    expect(fitName("Julie Ann Hackett", CARD_NAME_CAPACITY_EM)).toEqual({
      text: "J. Hackett",
      step: 2,
    });
    expect(fitName("Matt Facchine", CARD_NAME_CAPACITY_EM)).toEqual({
      text: "M. Facchine",
      step: 2,
    });
  });

  /**
   * PER NAME, not per card — a long partner must not shrink a short one. This
   * is the rule the spec named explicitly and the one a "make it all smaller"
   * build would violate while passing everything else.
   */
  it("is per name: a long name beside a short one leaves the short one at step 1", () => {
    const pair = ["Bud Banks", "Jason Schumacher"].map((n) =>
      fitName(n, CARD_NAME_CAPACITY_EM)
    );
    expect(pair[0]).toEqual({ text: "Bud Banks", step: 1 });
    expect(pair[1].step).toBe(2);
  });

  /**
   * The capacity is per SURFACE. Score entry gives the name most of a row, so
   * abbreviating there would lose information for no gain — the same name must
   * come out differently on the two surfaces.
   */
  it("respects the surface's own capacity", () => {
    expect(fitName("Jeremy Merling", CARD_NAME_CAPACITY_EM).step).toBe(2);
    expect(fitName("Jeremy Merling", ENTRY_NAME_CAPACITY_EM).step).toBe(1);
  });

  /**
   * THE ACCEPTED LIMIT, pinned so it is a decision rather than a surprise.
   * `J. Schumacher` is 6.43em against the card's 6.0 and will meet the ellipsis
   * backstop. A smaller rung was deliberately NOT added for one name in
   * sixteen — see the module header.
   */
  it("has no rung below initial+surname, so one long surname still overflows", () => {
    const fit = fitName("Jason Schumacher", CARD_NAME_CAPACITY_EM);
    expect(fit).toEqual({ text: "J. Schumacher", step: 2 });
    expect(estimateEm(fit.text)).toBeGreaterThan(CARD_NAME_CAPACITY_EM);
  });

  /**
   * THE REGRESSION THIS RELEASE EXISTS TO FIX. Every one of these was cut on
   * the phone while the old length ladder left it at full size; each must now
   * either fit or be abbreviated to something that does.
   */
  it("resolves every name the phone truncated", () => {
    const stillTooWide = ROSTER.filter((r) => r.observed === "cut")
      .map((r) => fitName(r.name, CARD_NAME_CAPACITY_EM))
      .filter((f) => estimateEm(f.text) > CARD_NAME_CAPACITY_EM)
      .map((f) => f.text);
    expect(stillTooWide).toEqual(["J. Schumacher"]);
  });
});

describe("initialSurname", () => {
  it("drops the middle name, keeps the surname", () => {
    expect(initialSurname("Julie Ann Hackett")).toBe("J. Hackett");
    expect(initialSurname("Matt Facchine")).toBe("M. Facchine");
  });

  it("leaves a single-token name alone", () => {
    expect(initialSurname("JohnnyD")).toBe("JohnnyD");
  });

  it("does not double the period when the first name is already an initial", () => {
    expect(initialSurname("J. Hackett")).toBe("J. Hackett");
    expect(initialSurname("J Hackett")).toBe("J. Hackett");
  });
});
