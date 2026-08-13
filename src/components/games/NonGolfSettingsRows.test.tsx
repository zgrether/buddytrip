import { describe, it, expect } from "vitest";
import { usesPointsPool } from "./NonGolfSettingsRows";

/**
 * The ONE predicate the two non-golf points rows key on.
 *
 * It exists because they used to read `scoring_model` independently — the same
 * question answered twice in one file, which is how the pair drifts apart
 * (CLAUDE.md #24). It is also the same question the leaderboard asks of
 * `points_distribution`, so a game that SAYS "pool" in settings is a game the
 * board AWARDS as a pool.
 */

describe("usesPointsPool", () => {
  it("a points cup is always a pool, split or not", () => {
    expect(usesPointsPool("points", null)).toBe(true);
    expect(usesPointsPool("points", { type: "placement", values: [5, 3] })).toBe(true);
  });

  it("a match-play cup is winner-take-all until the game carries a split", () => {
    expect(usesPointsPool("match_play", null)).toBe(false);
    expect(usesPointsPool("match_play", { type: "placement", values: [5, 3] })).toBe(true);
  });

  it("a per_match distribution is NOT a pool — it agrees with the leaderboard's narrow defer", () => {
    // The board keeps flattening a manual per_match game, so the settings page
    // must not offer it the pool control. The two read the same shape.
    expect(usesPointsPool("match_play", { type: "per_match", value: 3 })).toBe(false);
  });
});
