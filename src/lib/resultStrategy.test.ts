import { describe, it, expect } from "vitest";
import { resolveResultStrategy, isBracketGame, BRACKET_COMPETITION_FORMAT } from "./resultStrategy";
import { GAME_TYPE_LIST } from "./gameTypes";

/**
 * The resolver is the seam between "what format is this?" and "what engine
 * finalizes it?". Everything here is about precedence and about the three
 * answers being genuinely distinct — an engine, manual, and unknown.
 */

describe("resolveResultStrategy — engine formats", () => {
  it("returns the format's own strategy for every engine type", () => {
    expect(resolveResultStrategy("gtt_stroke_play", null)).toBe("stroke_total");
    expect(resolveResultStrategy("gtt_match_play", null)).toBe("match_play");
    expect(resolveResultStrategy("gtt_rack_n_stack", null)).toBe("rack_n_stack");
  });

  /**
   * The precedence test, and the one that matters most.
   *
   * `competition_format` is a per-game label that golf games carry too. If the
   * descriptor outranked the type, tagging a stroke round as a bracket would
   * route its finalize to an empty draw instead of the stroke engine — scoring a
   * real round as a game nobody played.
   */
  it("an engine type IGNORES the competition_format descriptor", () => {
    expect(resolveResultStrategy("gtt_stroke_play", "bracket")).toBe("stroke_total");
    expect(resolveResultStrategy("gtt_match_play", "bracket")).toBe("match_play");
    expect(resolveResultStrategy("gtt_rack_n_stack", "bracket")).toBe("rack_n_stack");
  });

  it("no game type in the catalog claims the bracket strategy", () => {
    // The bracket engine is resolved, never declared. A type carrying it would be
    // the per-category bracket types the spec collapsed, arriving by the back door.
    for (const d of GAME_TYPE_LIST) {
      expect(d.resultStrategy as string | null).not.toBe("bracket");
    }
  });
});

describe("resolveResultStrategy — manual formats", () => {
  it("is null with no descriptor — the entered-order arm", () => {
    expect(resolveResultStrategy("gtt_manual", null)).toBeNull();
    expect(resolveResultStrategy("gtt_generic_card", undefined)).toBeNull();
  });

  it("is null for the non-bracket descriptors", () => {
    expect(resolveResultStrategy("gtt_generic_yard", "head_to_head")).toBeNull();
    expect(resolveResultStrategy("gtt_generic_bar", "best_of_n")).toBeNull();
    // A non-bracket descriptor resolves to the manual arm whatever it is, and a
    // RETIRED value is exactly when that matters. `live_results` used to stand
    // here; migration 169 removed it from the column, so the case now uses a
    // legacy value rows genuinely still hold rather than a string nothing can be.
    expect(resolveResultStrategy("gtt_manual", "bracket_se")).toBeNull();
  });

  it("resolves to the bracket engine for competition_format 'bracket'", () => {
    expect(resolveResultStrategy("gtt_generic_yard", BRACKET_COMPETITION_FORMAT)).toBe("bracket");
    expect(resolveResultStrategy("gtt_generic_card", "bracket")).toBe("bracket");
    expect(resolveResultStrategy("gtt_manual", "bracket")).toBe("bracket");
  });

  /**
   * The legacy values are read-accepted (migration 114) but never route here.
   * They predate the bracket schema entirely, so they have no entrants and no
   * draw; sending them to the bracket engine would take a game that finalizes by
   * hand today and make it unfinishable. Migration 117's readiness gate scopes
   * itself to `'bracket'` for the same reason, and these two must agree.
   */
  it("does NOT route the legacy bracket_se / bracket_de values", () => {
    expect(resolveResultStrategy("gtt_generic_yard", "bracket_se")).toBeNull();
    expect(resolveResultStrategy("gtt_generic_yard", "bracket_de")).toBeNull();
  });
});

describe("resolveResultStrategy — unknown types", () => {
  /**
   * `undefined` and `null` are different answers and the caller acts differently
   * on each: null is manual (a served arm), undefined is "refuse to compute".
   * Collapsing them restores the silent stroke-play fallback the B2 guard exists
   * to prevent.
   */
  it("is undefined for a type absent from the code catalog", () => {
    expect(resolveResultStrategy("gtt_not_a_real_type", null)).toBeUndefined();
    expect(resolveResultStrategy(null, null)).toBeUndefined();
    expect(resolveResultStrategy(undefined, "bracket")).toBeUndefined();
  });

  it("an unknown type is not rescued by the bracket descriptor", () => {
    expect(resolveResultStrategy("gtt_not_a_real_type", "bracket")).toBeUndefined();
  });
});

describe("isBracketGame", () => {
  it("agrees with the resolver on every case it covers", () => {
    const cases: [string | null, string | null][] = [
      ["gtt_generic_yard", "bracket"],
      ["gtt_generic_yard", "head_to_head"],
      ["gtt_stroke_play", "bracket"],
      ["gtt_not_a_real_type", "bracket"],
      [null, "bracket"],
    ];
    for (const [typeId, format] of cases) {
      expect(isBracketGame(typeId, format)).toBe(resolveResultStrategy(typeId, format) === "bracket");
    }
  });

  it("is true only for a manual type flagged as a bracket", () => {
    expect(isBracketGame("gtt_generic_yard", "bracket")).toBe(true);
    expect(isBracketGame("gtt_generic_yard", "bracket_se")).toBe(false);
    expect(isBracketGame("gtt_stroke_play", "bracket")).toBe(false);
  });
});
