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
  const singles = GAME_TYPES.find((t) => t.id === "gtt_match_play_singles")!;
  const rack = GAME_TYPES.find((t) => t.id === "gtt_rack_n_stack")!;
  const manual = GAME_TYPES.find((t) => t.id === "gtt_manual")!;

  it("stroke is points-only", () => {
    expect(isGameTypeForScoringModel(stroke, "points")).toBe(true);
    expect(isGameTypeForScoringModel(stroke, "match_play")).toBe(false);
  });

  it("match-play formats are match_play-only", () => {
    expect(isGameTypeForScoringModel(singles, "match_play")).toBe(true);
    expect(isGameTypeForScoringModel(singles, "points")).toBe(false);
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
    expect(isGameTypeForScoringModel(singles, undefined)).toBe(true);
  });
});

describe("gameTypesForScoringModel — the offered menu", () => {
  it("a match_play comp offers 1v1/2v2/rack + manual, NOT stroke", () => {
    const offered = gameTypesForScoringModel("match_play").map(id);
    expect(offered).toContain("gtt_match_play_singles");
    expect(offered).toContain("gtt_match_play_doubles");
    expect(offered).toContain("gtt_rack_n_stack");
    expect(offered).toContain("gtt_manual"); // manual types fit any comp
    expect(offered).not.toContain("gtt_stroke_play");
  });

  it("a points comp offers Stroke + manual, NOT the match-play golf formats", () => {
    const offered = gameTypesForScoringModel("points").map(id);
    expect(offered).toContain("gtt_stroke_play");
    expect(offered).toContain("gtt_manual");
    expect(offered).not.toContain("gtt_match_play_singles");
    expect(offered).not.toContain("gtt_match_play_doubles");
    expect(offered).not.toContain("gtt_rack_n_stack");
  });

  it("points golf is Stroke-only today (stableford/sabotage/skins unbuilt)", () => {
    const golfOffered = gameTypesForScoringModel("points").filter((t) => t.isGolf).map(id);
    expect(golfOffered).toEqual(["gtt_stroke_play"]);
  });

  it("a null scoring-model offers the whole catalog", () => {
    expect(gameTypesForScoringModel(null)).toHaveLength(GAME_TYPES.length);
  });
});
