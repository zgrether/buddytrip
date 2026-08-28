import { describe, it, expect } from "vitest";
import { resetScoresBlurb } from "./gameResetCopy";
import { FORMAT_SURFACE, registeredGameTypes, surfaceForGameType } from "./formatSurface";

/**
 * The class-level guard: no format's danger-zone copy may name a thing that
 * format does not have.
 *
 * One hardcoded sentence used to serve all five — "Clears every score, result,
 * and bracket pick. Pairings, course, handicaps, and points stay." — which on a
 * pick'em game named four things it has none of. That was the FOURTH instance
 * in this feature of copy naming something the format lacks, so the fix is a
 * derivation plus this test, rather than a fifth edit to a string.
 */
describe("resetScoresBlurb — the copy cannot name what the format lacks", () => {
  /**
   * The four explicitly-registered types PLUS one manual id.
   *
   * `registeredGameTypes()` omits non-golf on purpose — that surface is the
   * catch-all (`gameTypes: "manual"`), so it has no enumerable list. Without
   * the extra id the whole sweep below would never touch the one surface whose
   * copy legitimately mentions a bracket, and the bracket assertion would pass
   * by never meeting it.
   */
  const TYPES = [...registeredGameTypes(), "gtt_generic_card"];

  it("covers every registered game type", () => {
    // Guards the sweep below: a table that silently covered nothing would pass
    // every assertion in this file.
    expect(TYPES.length).toBeGreaterThanOrEqual(5);
    // ...and every surface is actually reached, which the count alone does not
    // prove: four ids could all map to one surface.
    expect(new Set(TYPES.map((t) => surfaceForGameType(t))).size).toBe(5);
    for (const t of TYPES) expect(resetScoresBlurb(t), t).toBeTruthy();
  });

  it("never mentions a COURSE for a format that has none", () => {
    // The one fact already in the registry, so the copy and the surface flag
    // cannot disagree.
    for (const t of TYPES) {
      const surface = surfaceForGameType(t)!;
      if (!FORMAT_SURFACE[surface].course) {
        expect(resetScoresBlurb(t).toLowerCase(), t).not.toContain("course");
      }
    }
  });

  it("never mentions a BRACKET PICK outside the surface that can have one", () => {
    for (const t of TYPES) {
      if (surfaceForGameType(t) !== "nongolf") {
        expect(resetScoresBlurb(t).toLowerCase(), t).not.toContain("bracket");
      }
    }
  });

  it("never mentions HANDICAPS on pick'em, which has none", () => {
    // Named explicitly because it is the instance that was reported, and a
    // generic "no format names anything it lacks" assertion is not expressible
    // without a second registry of what each format has.
    expect(resetScoresBlurb("gtt_pickem").toLowerCase()).not.toContain("handicap");
  });

  it("says something specific and true for pick'em", () => {
    // The positive half: it is easy to satisfy every `not.toContain` above by
    // returning an empty string, so one format's real sentence is pinned.
    const blurb = resetScoresBlurb("gtt_pickem");
    expect(blurb).toBe("Clears every recorded result. The slate, pairings, and points stay.");
  });

  it("does not claim a reset clears people's PICKS", () => {
    // Picks are not scores — they are what gets scored. "Clears every pick"
    // would read as sixteen people losing the sheets they filled in, which is
    // not what the reset does.
    expect(resetScoresBlurb("gtt_pickem").toLowerCase()).not.toContain("clears every pick");
  });

  it("an unregistered id falls back rather than returning nothing", () => {
    const blurb = resetScoresBlurb("gtt_not_a_real_format");
    expect(blurb).toBeTruthy();
    expect(blurb).toContain("Clears");
  });

  it("reads as one sentence pair, whatever the list length", () => {
    // The joiner is the part most likely to produce "A, and B stay." or
    // "A B stay." on a future format with a different-sized list.
    for (const t of TYPES) {
      const blurb = resetScoresBlurb(t);
      expect(blurb, t).toMatch(/^Clears [^.]+\. .+ stay\.$/);
      expect(blurb, t).not.toContain(" ,");
      expect(blurb, t).not.toMatch(/,\s+and\s+\w+,/);
    }
  });
});
