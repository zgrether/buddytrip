import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { hasPositivePoints } from "./gameReadiness";

/**
 * #1029 — "has points" means a POSITIVE value, everywhere it is asked.
 *
 * Every game is created with a 0 sentinel (`points_total: 0`, or
 * `{type:'per_match', value: 0}`), so the old reading, "either column
 * non-null", was true of every game from creation. A fresh non-golf game read
 * "Ready — enable scoring" on the board while the server refused the enable.
 */

describe("hasPositivePoints", () => {
  it("the 0 sentinels are NOT points", () => {
    expect(hasPositivePoints({ points_total: 0, points_distribution: null })).toBe(false);
    expect(hasPositivePoints({ points_total: null, points_distribution: { type: "per_match", value: 0 } })).toBe(false);
    expect(hasPositivePoints({ points_total: 0, points_distribution: { type: "placement", values: [0, 0] } })).toBe(false);
    expect(hasPositivePoints({ points_total: null, points_distribution: null })).toBe(false);
  });

  it("a positive value in either shape IS points", () => {
    expect(hasPositivePoints({ points_total: 10, points_distribution: null })).toBe(true);
    expect(hasPositivePoints({ points_total: null, points_distribution: { type: "per_match", value: 2 } })).toBe(true);
    expect(hasPositivePoints({ points_total: 0, points_distribution: { type: "placement", values: [3, 0] } })).toBe(true);
  });
});

describe("the enable guard reads the same answer (#1029)", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await TestContext.create();
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup();
  }, 60_000);

  it("a fresh 0-point non-golf cup game cannot be enabled; once it carries points, it can", async () => {
    const { tripId, competitionId } = await ctx.createCupTrip({ name: "1029 enable", scoringModel: "points", teams: ["A", "B"] });
    // As the add-game modal creates it: the 0 sentinel.
    const g = (await ctx.caller().games.create({
      tripId, gameTypeId: "gtt_generic_card", name: "Euchre", competitionId, pointsTotal: 0,
    })) as { id: string };

    await expect(ctx.caller().games.enableScoring({ tripId, gameId: g.id })).rejects.toThrow(
      "Finish setting up this game before switching it to scoring."
    );
    const { data: before } = await ctx.admin.from("games").select("scoring_enabled").eq("id", g.id).single();
    expect(before?.scoring_enabled).toBe(false);

    // CONTROL: a real point value set, the same enable goes through.
    await ctx.admin.from("games").update({ points_total: 6 }).eq("id", g.id);
    await ctx.caller().games.enableScoring({ tripId, gameId: g.id });
    const { data: after } = await ctx.admin.from("games").select("scoring_enabled").eq("id", g.id).single();
    expect(after?.scoring_enabled).toBe(true);
  }, 60_000);
});
