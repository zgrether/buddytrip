import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * #1639 (a) — `games.finish` refuses a placement split with more places than
 * possible finishers, BEFORE any result is written.
 *
 * Settings already refuse it for team cups and brackets. Two doors stayed open,
 * and this check at finalize covers both:
 *  - a TEAMLESS race: no team ceiling, so its people are the finishers;
 *  - a split that never went through settings (a direct `save_game_config`
 *    call). Every split below is written with the service role, which is that
 *    door: nothing checked it on the way in.
 *
 * Skins is used because it can finish with nothing banked, so the CONTROL (a
 * split that fits) shows finish genuinely going through, and the refusals are
 * the capacity check, not some other refusal in the arm.
 */

let ctx: TestContext;
let owner: string, member: string, planner: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  owner = ctx.user.id;
  member = ctx.getUser("member").id;
  planner = ctx.getUser("planner").id;
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

async function skinsGame(label: string, teams: string[]) {
  const { tripId, competitionId } = await ctx.createCupTrip({
    name: `1639 ${label}`, scoringModel: "points", teams, members: [["member", "Member"], ["planner", "Organizer"]],
  });
  const g = (await ctx.caller().games.create({ tripId, gameTypeId: "gtt_skins", name: `1639 ${label}`, competitionId })) as { id: string };
  await ctx.caller().games.addParticipants({ tripId, gameId: g.id, userIds: [owner, member, planner] });
  await ctx.groupStrokeParticipants(g.id, [owner, member, planner]);
  return { tripId, gameId: g.id };
}

async function setSplit(gameId: string, values: number[]) {
  const total = values.reduce((a, b) => a + b, 0);
  const { error } = await ctx.admin
    .from("games")
    .update({ points_total: total, points_distribution: { type: "placement", values } })
    .eq("id", gameId);
  if (error) throw error;
}

const statusOf = async (gameId: string) => (await ctx.admin.from("games").select("status").eq("id", gameId).single()).data?.status;

describe("games.finish refuses a split nobody can fill (#1639)", () => {
  it("a TEAMLESS race: 5 places over 3 people is refused", async () => {
    const { tripId, gameId } = await skinsGame("teamless over", []);
    await setSplit(gameId, [5, 4, 3, 2, 1]);
    await expect(ctx.caller().games.finish({ tripId, gameId })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "This split pays 5 places, but only 3 can finish. Change it in settings.",
    });
    expect(await statusOf(gameId)).not.toBe("complete");
  }, 60_000);

  it("a TEAM cup: 3 places over 2 teams is refused", async () => {
    const { tripId, gameId } = await skinsGame("team over", ["Alpha", "Bravo"]);
    await setSplit(gameId, [5, 3, 1]);
    await expect(ctx.caller().games.finish({ tripId, gameId })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "This split pays 3 places, but only 2 can finish. Change it in settings.",
    });
    expect(await statusOf(gameId)).not.toBe("complete");
  }, 60_000);

  it("CONTROL: a split that fits (3 places over 3 people) finishes", async () => {
    const { tripId, gameId } = await skinsGame("teamless fits", []);
    await setSplit(gameId, [5, 3, 1]);
    await ctx.caller().games.finish({ tripId, gameId });
    expect(await statusOf(gameId)).toBe("complete");
  }, 60_000);

  it("CONTROL: FEWER places than finishers stays legitimate", async () => {
    const { tripId, gameId } = await skinsGame("teamless fewer", []);
    await setSplit(gameId, [5]);
    await ctx.caller().games.finish({ tripId, gameId });
    expect(await statusOf(gameId)).toBe("complete");
  }, 60_000);
});
