import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TRPCError } from "@trpc/server";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * #1304 — `games.create` refuses a format its competition's scoring model does
 * not hold.
 *
 * The add-game menu has always filtered on this (`CompetitionGamesPanel`, via
 * `gameTypesForScoringModel`), so no user sees a change. What changes is a
 * direct call: before this, `games.create` inserted any `gameTypeId` into any
 * competition, and a match game in a Points cup — or a stroke game in a Match
 * Play cup — was one API request away.
 *
 * Create is the ONE door. `game_type_id` and `competition_id` are written by
 * `games.create` and nowhere else, and `competitions.scoring_model` has no
 * update path, so there is no second route into the state to guard.
 *
 * Every refusal case also asserts the row was NOT written. A guard that threw
 * after the insert would pass a throws-only test while leaving the state behind.
 */

let ctx: TestContext;
let tripId: string;
let pointsCup: string;
let matchCup: string;

async function gamesIn(competitionId: string, gameTypeId: string) {
  const { count, error } = await ctx.admin
    .from("games")
    .select("id", { count: "exact", head: true })
    .eq("competition_id", competitionId)
    .eq("game_type_id", gameTypeId);
  expect(error).toBeNull();
  return count ?? 0;
}

async function refusal(competitionId: string, gameTypeId: string): Promise<TRPCError> {
  let caught: unknown;
  try {
    await ctx.caller().games.create({ tripId, gameTypeId, name: "Should not exist", competitionId });
  } catch (e) {
    caught = e;
  }
  expect(caught, `${gameTypeId} was created in a cup that cannot hold it`).toBeInstanceOf(TRPCError);
  return caught as TRPCError;
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Format guard trip");
  pointsCup = await ctx.createCompetition(tripId, "Points Cup", { scoringModel: "points" });
  matchCup = await ctx.createCompetition(tripId, "Match Cup", { scoringModel: "match_play" });
}, 60_000);

afterAll(async () => {
  await ctx.admin.from("games").delete().in("competition_id", [pointsCup, matchCup]);
  await ctx?.cleanup();
}, 60_000);

describe("games.create refuses a format its cup cannot hold (#1304)", () => {
  // Match play in a points cup was the first case here until PR 5 opened it
  // (ruling 5). It is now in the admitted list below; rack is the head-to-head
  // format a points cup still refuses.
  it("Rack-n-Stack in a Points cup — refused, named, not written", async () => {
    const err = await refusal(pointsCup, "gtt_rack_n_stack");
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toMatch(/^A Points cup can't hold Rack-n-Stack\./);
    expect(await gamesIn(pointsCup, "gtt_rack_n_stack")).toBe(0);
  }, 60_000);

  it("Stroke Play in a Match Play cup — refused the other way, not written", async () => {
    const err = await refusal(matchCup, "gtt_stroke_play");
    expect(err.message).toMatch(/^A Match Play cup can't hold Stroke Play\./);
    expect(await gamesIn(matchCup, "gtt_stroke_play")).toBe(0);
  }, 60_000);

  it("is not a blanket refusal: each cup still takes its own formats, and the shared ones", async () => {
    for (const [cup, type] of [
      [pointsCup, "gtt_stroke_play"],
      [pointsCup, "gtt_pickem"],
      [pointsCup, "gtt_manual"],
      [pointsCup, "gtt_match_play"], // PR 5
      [matchCup, "gtt_match_play"],
      [matchCup, "gtt_rack_n_stack"],
      [matchCup, "gtt_pickem"],
      [matchCup, "gtt_generic_card"],
    ] as const) {
      await ctx.caller().games.create({ tripId, gameTypeId: type, name: `ok ${type}`, competitionId: cup });
      expect(await gamesIn(cup, type), `${type} in ${cup === pointsCup ? "points" : "match_play"}`).toBe(1);
    }
  }, 60_000);

  it("a standalone game is untouched — no competition, no scoring model, no question", async () => {
    const g = (await ctx.caller().games.create({ tripId, gameTypeId: "gtt_match_play", name: "Standalone" })) as { id: string };
    expect(g.id).toBeTruthy();
    await ctx.admin.from("games").delete().eq("id", g.id);
  }, 60_000);
});
