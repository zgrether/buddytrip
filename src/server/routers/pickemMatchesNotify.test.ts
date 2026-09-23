import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * The organizer push, END TO END through the real `pickem.setResult` procedure
 * (results-first PR). The hook lives in the tRPC procedure, not in the
 * `set_pickem_result` RPC — so these go through `ctx.caller()`, not `.rpc()`,
 * or they would pass with the hook deleted.
 *
 * They assert the MECHANISM — a `push_send_log` row — not the outcome.
 * `sendPushToUsers` records every attempt, including CI's, where push is not
 * configured and every send is a no-op (`notConfigured`); and `afterResponse`
 * runs inline out of a request scope, so the row exists when the call returns.
 */

let ctx: TestContext;
let tripId: string;
let gameId: string;
let slateIds: string[];
let owner: string;
let planner: string;

async function logRows(since: string) {
  const { data } = await ctx.admin
    .from("push_send_log")
    .select("trigger, type_key, game_id, actor_user_id, recipients")
    .eq("game_id", gameId)
    .eq("trigger", "pickem_matches_not_drawn")
    .gte("created_at", since);
  return data ?? [];
}

function setResult(slateGameId: string, result: "away" | "home" | "push" | "cancelled" | null) {
  return ctx.caller().pickem.setResult({ tripId, gameId, slateGameId, result });
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("pickem organizer push");
  await ctx.addTripMember(tripId, "member", "Member");
  await ctx.addTripMember(tripId, "planner", "Organizer");
  owner = ctx.user.id;
  planner = ctx.getUser("planner").id;
  const competitionId = await ctx.createCompetition(tripId, "pickem organizer push cup");
  const g = (await ctx.caller().games.create({
    tripId,
    gameTypeId: "gtt_pickem",
    name: "Push Picks",
    competitionId,
  })) as { id: string };
  gameId = g.id;
  await ctx.admin.from("pickem_games").upsert({
    game_id: gameId,
    picks_opened_at: new Date(Date.now() - 3_600_000).toISOString(),
    picks_locked_at: new Date().toISOString(),
    roll_up: "individual_matches",
  });
  slateIds = [genId("sg"), genId("sg")];
  await ctx.admin.from("pickem_slate_games").insert(
    slateIds.map((id, i) => ({
      id, game_id: gameId, display_order: i, away_team: `Away${i}`, home_team: `Home${i}`, multiplier: 1,
    }))
  );
});

beforeEach(async () => {
  await ctx.admin.from("pickem_slate_games").update({ result: null }).eq("game_id", gameId);
  await ctx.admin.from("game_matches").delete().eq("game_id", gameId);
  await ctx.admin.from("games").update({ status: "active" }).eq("id", gameId);
  await ctx.admin.from("pickem_games").update({ roll_up: "individual_matches" }).eq("game_id", gameId);
});

afterAll(async () => {
  await ctx.cleanup();
});

describe("pickem.setResult → the organizer push", () => {
  it("the FIRST result with no match drawn sends ONE push to the runners, minus the one who entered it", async () => {
    const since = new Date().toISOString();
    await setResult(slateIds[0], "home");
    const rows = await logRows(since);
    expect(rows).toHaveLength(1);
    expect(rows[0].type_key).toBe("organizer");
    expect(rows[0].actor_user_id).toBe(owner);
    // Runners = the Owner and the Organizer; the Member is not one. The Owner
    // entered the result and is excluded, so exactly the Organizer remains.
    expect(rows[0].recipients).toBe(1);
    expect(planner).toBeTruthy();
  });

  it("the SECOND result sends nothing more — one push per game, not per result", async () => {
    await setResult(slateIds[0], "home");
    const since = new Date().toISOString();
    await setResult(slateIds[1], "away");
    expect(await logRows(since)).toHaveLength(0);
  });

  it("with a match already drawn, the first result sends nothing", async () => {
    await ctx.admin.from("game_matches").insert({
      id: genId("gm"), game_id: gameId, display_order: 0,
      side_a: { type: "user", id: owner }, side_b: { type: "user", id: planner },
    });
    const since = new Date().toISOString();
    await setResult(slateIds[0], "home");
    expect(await logRows(since)).toHaveLength(0);
  });

  it("on team totals the first result sends nothing — there are no matches to draw", async () => {
    await ctx.admin.from("pickem_games").update({ roll_up: "team_totals" }).eq("game_id", gameId);
    const since = new Date().toISOString();
    await setResult(slateIds[0], "home");
    expect(await logRows(since)).toHaveLength(0);
  });

  it("clearing a result sends nothing — an unplayed contest is never a first result", async () => {
    const since = new Date().toISOString();
    await setResult(slateIds[0], null);
    expect(await logRows(since)).toHaveLength(0);
  });
});
