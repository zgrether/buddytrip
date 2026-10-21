import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * Migration 220 — a competition stores the starting point it was made from and
 * the suggestions its organizers skipped. The CHECK is the guard: every writer
 * (service role and fixtures included) can store only a known starting point.
 * Asserted with real writes, so a constraint that refused nothing would fail.
 *
 * Every case builds its OWN competition (a trip holds one): the suite runs
 * shuffled, so a case reading a row another case wrote is order-dependent.
 */

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

async function fresh(label: string): Promise<string> {
  const tripId = await ctx.createTrip(`220 ${label}`);
  return ctx.createCompetition(tripId, `220 ${label}`, { scoringModel: "points" });
}
const row = async (id: string) =>
  (await ctx.admin.from("competitions").select("starting_point, skipped_suggestions").eq("id", id).single()).data;

describe("competitions.starting_point and skipped_suggestions (220)", () => {
  it("a new competition has no starting point and nothing skipped", async () => {
    const id = await fresh("defaults");
    expect(await row(id)).toEqual({ starting_point: null, skipped_suggestions: [] });
  });

  it("a known starting point and skipped suggestion keys are stored", async () => {
    const id = await fresh("stored");
    const { error } = await ctx.admin
      .from("competitions")
      .update({ starting_point: "golf_week", skipped_suggestions: ["gtt_skins", "gtt_generic_bar:bracket"] })
      .eq("id", id);
    expect(error).toBeNull();
    expect(await row(id)).toEqual({ starting_point: "golf_week", skipped_suggestions: ["gtt_skins", "gtt_generic_bar:bracket"] });
  });

  it("an unknown starting point is refused by the database", async () => {
    const id = await fresh("refused");
    const { error } = await ctx.admin.from("competitions").update({ starting_point: "pickem_pool" }).eq("id", id);
    expect(error?.code).toBe("23514");
    expect(error?.message).toContain("competitions_starting_point_known");
    expect((await row(id))?.starting_point).toBeNull();
  });

  it("CONTROL: clearing a starting point (Build your own) is allowed", async () => {
    const id = await fresh("cleared");
    await ctx.admin.from("competitions").update({ starting_point: "team_cup_weekend" }).eq("id", id);
    const { error } = await ctx.admin.from("competitions").update({ starting_point: null }).eq("id", id);
    expect(error).toBeNull();
    expect((await row(id))?.starting_point).toBeNull();
  });
});
