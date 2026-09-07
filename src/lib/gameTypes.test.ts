import { describe, it, expect } from "vitest";
import {
  GAME_TYPES,
  isGameTypeForScoringModel,
  gameTypesForScoringModel,
} from "./gameTypes";

/**
 * W-TYPE-01 — the add-game compatibility filter. The competition's scoring-model
 * (`match_play | points`) decides which formats the create picker offers. Pure
 * data + a pure helper (the mechanism the modal calls); covered here so a re-tag
 * regression is caught without driving the UI.
 */

const id = (t: { id: string }) => t.id;

describe("isGameTypeForScoringModel", () => {
  const stroke = GAME_TYPES.find((t) => t.id === "gtt_stroke_play")!;
  const matchPlay = GAME_TYPES.find((t) => t.id === "gtt_match_play")!;
  const rack = GAME_TYPES.find((t) => t.id === "gtt_rack_n_stack")!;
  const manual = GAME_TYPES.find((t) => t.id === "gtt_manual")!;

  it("stroke is points-only", () => {
    expect(isGameTypeForScoringModel(stroke, "points")).toBe(true);
    expect(isGameTypeForScoringModel(stroke, "match_play")).toBe(false);
  });

  it("match play is match_play-only", () => {
    expect(isGameTypeForScoringModel(matchPlay, "match_play")).toBe(true);
    expect(isGameTypeForScoringModel(matchPlay, "points")).toBe(false);
  });

  it("rack-n-stack is match_play (net-stroke ENTRY is not the points scoring-model)", () => {
    expect(isGameTypeForScoringModel(rack, "match_play")).toBe(true);
    expect(isGameTypeForScoringModel(rack, "points")).toBe(false);
  });

  it("manual (null) fits any scoring-model", () => {
    expect(isGameTypeForScoringModel(manual, "match_play")).toBe(true);
    expect(isGameTypeForScoringModel(manual, "points")).toBe(true);
  });

  it("a null/absent scoring-model is permissive (never an empty menu)", () => {
    expect(isGameTypeForScoringModel(stroke, null)).toBe(true);
    expect(isGameTypeForScoringModel(matchPlay, undefined)).toBe(true);
  });
});

describe("gameTypesForScoringModel — the offered menu", () => {
  it("a match_play comp offers match play + rack + manual, NOT stroke", () => {
    const offered = gameTypesForScoringModel("match_play").map(id);
    expect(offered).toContain("gtt_match_play"); // one unified type (was singles + doubles)
    expect(offered).toContain("gtt_rack_n_stack");
    expect(offered).toContain("gtt_manual"); // manual types fit any comp
    expect(offered).not.toContain("gtt_stroke_play");
  });

  it("a points comp offers Stroke + manual, NOT the match-play golf formats", () => {
    const offered = gameTypesForScoringModel("points").map(id);
    expect(offered).toContain("gtt_stroke_play");
    expect(offered).toContain("gtt_manual");
    expect(offered).not.toContain("gtt_match_play");
    expect(offered).not.toContain("gtt_rack_n_stack");
  });

  it("points golf is Stroke + Scramble + Skins today (sabotage unbuilt)", () => {
    // Was "Stroke-only", then "Stroke + Scramble". Skins is the third, and
    // Stableford is STILL not on the list: it is a `games.config.scoringType` on
    // a stroke game, not a format — which is the distinction this list keeps
    // making visible, and the reason it is worth re-reading each time it grows.
    //
    // Skins belongs here for the same reason stroke and scramble do: it produces
    // a per-player COUNT ranked into a finishing order, which is what a points
    // cup scores. It is NOT in a match-play cup — that arm is asserted below,
    // beside scramble's.
    const golfOffered = gameTypesForScoringModel("points").filter((t) => t.isGolf).map(id);
    expect(golfOffered).toEqual(["gtt_stroke_play", "gtt_scramble", "gtt_skins"]);
  });

  it("SKINS IS NOT OFFERED IN A TEAM-BASED CUP", () => {
    // The same distinction scramble's case below draws, and it needs its own
    // case rather than riding that one: a match-play cup scores per-slot
    // win/halve, and skins has neither slots nor halves. `compatibleScoringModels`
    // is what keeps it out, and a format added without that field set is exactly
    // the omission this pair of tests exists to catch.
    const offered = gameTypesForScoringModel("match_play").map(id);
    expect(offered).not.toContain("gtt_skins");
  });

  it("SCRAMBLE IS NOT OFFERED IN A TEAM-BASED CUP", () => {
    /**
     * The distinction that matters most about this type, asserted rather than
     * assumed. BBMI already has a game called "Day 1 Scramble" and it is a
     * MATCH-PLAY game whose sides are play_groups — a different thing entirely.
     * A points-model Scramble appearing in a match-play cup would put two
     * unrelated formats behind one word in the same menu.
     *
     * The negative is paired with its positive so it cannot pass by the type
     * being absent from the catalog altogether — which is how a filter test goes
     * quietly vacuous when someone renames an id.
     */
    expect(gameTypesForScoringModel("match_play").map(id)).not.toContain("gtt_scramble");
    expect(gameTypesForScoringModel("points").map(id)).toContain("gtt_scramble");
  });

  it("a null scoring-model offers the whole catalog", () => {
    expect(gameTypesForScoringModel(null)).toHaveLength(GAME_TYPES.length);
  });
});
