import { describe, it, expect } from "vitest";
import { isConfigured } from "./gameReadiness";

/**
 * `isConfigured`'s Matches branch — Phase 0 §2, made structural rather than
 * merely documented: a Matches game gates readiness on `matchPlayReady`
 * (paired === total, ≥1), the SAME threshold golf match play already uses.
 *
 * Every case here is chosen to fail against the plausible wrong build the spec
 * names explicitly: a readiness check that falls through to the LAST arm
 * (`hasPoints`) because it never learned to recognise Matches. That build
 * passes every test that only checks "Matches eventually reads Ready" — the
 * zero-paired case is the one that catches it, because `hasPoints` is true for
 * every non-golf game from the moment it's created (the add-game modal's
 * points sentinel), so a wrong build would report Ready with NOTHING paired.
 */
describe("isConfigured — non-golf Matches (Phase 0 §2)", () => {
  const MATCHES = "matches";

  it("zero paired matches is NOT Ready, even with points fully configured", () => {
    // The adversarial case. hasPoints=true is what a build that fell through to
    // the last arm would key on — this must still read false.
    expect(isConfigured("gtt_generic_yard", 0, 4, 0, true, MATCHES)).toBe(false);
  });

  it("some but not all matches paired is NOT Ready", () => {
    expect(isConfigured("gtt_generic_yard", 3, 4, 0, true, MATCHES)).toBe(false);
  });

  it("every match paired IS Ready", () => {
    expect(isConfigured("gtt_generic_yard", 4, 4, 0, true, MATCHES)).toBe(true);
  });

  it("zero matches total is NOT Ready, however many points are set", () => {
    // matchPlayReady requires totalCount > 0 — an empty pairing grid is not a
    // configured game, mirroring golf's "an empty draft is NOT ready".
    expect(isConfigured("gtt_generic_yard", 0, 0, 0, true, MATCHES)).toBe(false);
  });

  it("hasPoints=false with matches fully paired is STILL Ready — points don't gate this branch", () => {
    // Matches' readiness question is entirely about pairing, same as golf match
    // play; points readiness is a separate axis this predicate doesn't answer.
    expect(isConfigured("gtt_generic_yard", 2, 2, 0, false, MATCHES)).toBe(true);
  });

  it("a Matches-descriptor game type that isn't manual-engine does NOT take this branch", () => {
    // resultStrategy only consults the descriptor for a manual-engine type;
    // stroke play's engine is fixed by the format regardless of what
    // competition_format claims. Confirms the branch is gated on the RESOLVED
    // engine, not merely on the string "matches" appearing anywhere.
    expect(isConfigured("gtt_stroke_play", 0, 0, 3, true, MATCHES)).toBe(true); // ROSTER_TYPES arm: participantCount > 0
  });

  it("the SAME game type with NO competitionFormat is an ordinary manual game — hasPoints decides", () => {
    // Same typeId as the passing cases above, no descriptor: must NOT silently
    // take the Matches branch just because it COULD.
    expect(isConfigured("gtt_generic_yard", 0, 0, 0, true)).toBe(true); // hasPoints arm
    expect(isConfigured("gtt_generic_yard", 0, 0, 0, false)).toBe(false);
  });

  it("golf match play is unaffected — same threshold, reached via the type check, not the descriptor", () => {
    expect(isConfigured("gtt_match_play", 2, 3, 0, true)).toBe(false);
    expect(isConfigured("gtt_match_play", 3, 3, 0, true)).toBe(true);
  });
});
