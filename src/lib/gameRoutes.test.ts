import { describe, it, expect } from "vitest";
import { gameHref, isGolfFormat, MANUAL_ROUTE } from "@/lib/gameRoutes";

describe("gameHref", () => {
  it("routes golf formats to their per-format game pages", () => {
    expect(gameHref("trip1", "gtt_stroke_play", "g1")).toBe("/trips/trip1/games/new?game=g1");
    expect(gameHref("trip1", "gtt_match_play_singles", "g1")).toBe("/trips/trip1/games/match/new?game=g1");
    expect(gameHref("trip1", "gtt_match_play_doubles", "g1")).toBe("/trips/trip1/games/match/new?game=g1");
    expect(gameHref("trip1", "gtt_rack_n_stack", "g1")).toBe("/trips/trip1/games/rack/new?game=g1");
  });

  it("routes non-golf manual formats to the shared manual scoreboard page", () => {
    for (const t of ["gtt_manual", "gtt_generic_card", "gtt_generic_yard", "gtt_generic_bar"]) {
      expect(gameHref("trip1", t, "g1")).toBe(`/trips/trip1/games/${MANUAL_ROUTE}?game=g1`);
    }
  });

  it("returns null for a null or unregistered game type", () => {
    expect(gameHref("trip1", null, "g1")).toBeNull();
    expect(gameHref("trip1", "gtt_not_a_real_type", "g1")).toBeNull();
  });
});

describe("isGolfFormat", () => {
  it("is true only for golf formats — never for manual or unknown types", () => {
    expect(isGolfFormat("gtt_stroke_play")).toBe(true);
    expect(isGolfFormat("gtt_rack_n_stack")).toBe(true);
    // The manual page route must NOT make a non-golf game read as golf (it would
    // wrongly show the golf-only scorecard column on the board row).
    expect(isGolfFormat("gtt_manual")).toBe(false);
    expect(isGolfFormat("gtt_generic_card")).toBe(false);
    expect(isGolfFormat(null)).toBe(false);
    expect(isGolfFormat("gtt_not_a_real_type")).toBe(false);
  });
});
