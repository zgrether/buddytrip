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

/**
 * The Point Distribution row's three outputs must agree, because they describe one
 * game to one reader at one moment.
 *
 * The bug this pins (#911): the row's subtitle said "Winner takes all" while the
 * panel it opened rendered the placement editor — "0 of 2 · not distributed yet".
 * Not a wording slip. `FormatPointsPanel` decides winner-takes-all from a
 * `winnerTakesAll` prop that DEFAULTS TO FALSE, and this row never passed it, so
 * the control could not agree with its own label whatever the label said.
 *
 * `!usesPointsPool(...)` is now the single source for the prop AND the subtitle, so
 * the two cannot be given different answers. That is the point of the test: the
 * mapping below is what the row promises, and all three outputs read it.
 */
describe("the row's label and its control read ONE predicate", () => {
  const split = { type: "placement" as const, values: [5, 3] };

  it("match-play cup, no split → winner takes all (the case that contradicted itself)", () => {
    // Subtitle "Winner takes all" · panel gets winnerTakesAll = !false = true.
    expect(usesPointsPool("match_play", null)).toBe(false);
  });

  it("points cup, no split → EVEN, not winner-takes-all — why stroke's bare pass is wrong here", () => {
    // Stroke passes `winnerTakesAll` unconditionally because an unset split always
    // means the winner takes the pool there. Copying that would make a points cup
    // claim winner-takes-all, which is the opposite of what it does.
    expect(usesPointsPool("points", null)).toBe(true);
  });

  it("either cup WITH a split → the placement editor, never the winner-takes-all row", () => {
    expect(usesPointsPool("match_play", split)).toBe(true);
    expect(usesPointsPool("points", split)).toBe(true);
  });
});
