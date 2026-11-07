import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { flipCupToCompleted } from "./finishCup";

/**
 * The finish's "once" (spec §5, v2.8): a single conditional UPDATE, so two
 * finishes at the same moment flip the cup once. Against the real database,
 * because the guarantee is Postgres's row lock, not anything in this code.
 */

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
}, 120_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

const status = async (competitionId: string) =>
  (await ctx.admin.from("competitions").select("status, tiebreak_order").eq("id", competitionId).single()).data;

describe("flipCupToCompleted", () => {
  it("two at once: exactly one moves the row, whatever the timing", async () => {
    const cup = await ctx.createCupTrip({ title: "Race", name: "Race", scoringModel: "points", teams: ["A", "B"] });
    const results = await Promise.all([
      flipCupToCompleted(ctx.admin, cup, []),
      flipCupToCompleted(ctx.admin, cup, []),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await status(cup.competitionId)).toEqual({ status: "completed", tiebreak_order: [] });
  });

  it("a cup already finished is not moved again, and keeps its order", async () => {
    const cup = await ctx.createCupTrip({ title: "Again", name: "Again", scoringModel: "points", teams: ["A", "B"] });
    expect(await flipCupToCompleted(ctx.admin, cup, [cup.teamIds[1], cup.teamIds[0]])).toBe(true);
    expect(await flipCupToCompleted(ctx.admin, cup, [])).toBe(false);
    expect(await status(cup.competitionId)).toEqual({ status: "completed", tiebreak_order: [cup.teamIds[1], cup.teamIds[0]] });
  });

  it("CONTROL: an open cup is moved, and with no order the column is left unreviewed", async () => {
    const cup = await ctx.createCupTrip({ title: "Open", name: "Open", scoringModel: "points", teams: ["A", "B"] });
    expect(await flipCupToCompleted(ctx.admin, cup)).toBe(true);
    expect(await status(cup.competitionId)).toEqual({ status: "completed", tiebreak_order: null });
  });

  it("another trip's id moves nothing", async () => {
    const cup = await ctx.createCupTrip({ title: "Wrong trip", name: "Wrong trip", scoringModel: "points", teams: ["A", "B"] });
    expect(await flipCupToCompleted(ctx.admin, { tripId: "not-this-trip", competitionId: cup.competitionId })).toBe(false);
    expect((await status(cup.competitionId))?.status).not.toBe("completed");
  });
});
