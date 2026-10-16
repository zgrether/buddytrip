import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";
import { gameFinishedMessage } from "./gameFinishNotify";
import { clientFailingRead } from "../../__tests__/helpers/failingRead";

/**
 * #1442 — a finished pick'em tells WHO PLAYED: everyone with a sheet, plus
 * anyone paired in a match (Zach, 2026-10-16).
 *
 * The audience was `game_participants`, which for an individual-matches
 * pick'em holds only whoever was paired at the time. A sheet with no match was
 * never told, and Picks 2 (its matches removed) reached nobody: `no_recipients`.
 *
 * Each case asserts the EXACT audience, so a build that sent to the paired
 * players alone, or to the sheet-holders alone, fails it.
 */

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

/** A finished pick'em in `competitionId` (or a side game when null), with
 *  sheets for `sheetHolders` and a participant row for each of `paired`. */
async function pickem(tripId: string, competitionId: string | null, sheetHolders: string[], paired: string[]) {
  const gameId = genId("game");
  await ctx.admin.from("games").insert({
    id: gameId, trip_id: tripId, competition_id: competitionId, game_type_id: "gtt_pickem", name: "Picks", status: "complete",
  });
  await ctx.admin.from("pickem_games").upsert({ game_id: gameId, roll_up: "individual_matches" });
  const slate = genId("sg");
  await ctx.admin.from("pickem_slate_games").insert({ id: slate, game_id: gameId, display_order: 0, away_team: "A", home_team: "H", multiplier: 1 });
  if (sheetHolders.length) {
    const r = await ctx.admin.from("pickem_picks").insert(
      sheetHolders.map((user_id) => ({ id: genId("pk"), game_id: gameId, slate_game_id: slate, user_id, pick: "away" }))
    );
    if (r.error) throw new Error(r.error.message);
  }
  if (paired.length) {
    const r = await ctx.admin.from("game_participants").insert(paired.map((user_id) => ({ id: genId("gp"), game_id: gameId, user_id })));
    if (r.error) throw new Error(r.error.message);
  }
  return gameId;
}

/** Put each person on a cup team: the database refuses a participant who is not
 *  on one (UNROSTERED), so a paired player has to be rostered first. */
async function roster(competitionId: string, teamIds: string[], people: string[]) {
  const r = await ctx.admin.from("team_assignments").insert(
    people.map((user_id, i) => ({ competition_id: competitionId, user_id, team_id: teamIds[i % teamIds.length] }))
  );
  if (r.error) throw new Error(r.error.message);
}

const audienceOf = async (tripId: string, gameId: string, competitionId: string | null, admin = ctx.admin) =>
  (await gameFinishedMessage(admin, {
    tripId, gameId, gameName: "Picks", gameTypeId: "gtt_pickem", competitionId, strategy: "pickem", actorUserId: "nobody",
  })).audience.slice().sort();

describe("a finished pick'em tells who played (#1442)", () => {
  it("a sheet-holder with no match is told, beside the paired players", async () => {
    const { tripId, competitionId, teamIds } = await ctx.createCupTrip({
      name: "1442 unpaired", scoringModel: "match_play", members: [["member", "Member"], ["outsider", "Member"]], teams: ["A", "B"],
    });
    const owner = ctx.user.id;
    const member = ctx.getUser("member").id;
    const outsider = ctx.getUser("outsider").id;
    await roster(competitionId, teamIds, [owner, member, outsider]);
    // Three sheets; owner and member paired; outsider (odd one out) unpaired.
    const gameId = await pickem(tripId, competitionId, [owner, member, outsider], [owner, member]);
    expect(await audienceOf(tripId, gameId, competitionId)).toEqual([owner, member, outsider].sort());
  }, 60_000);

  it("Picks 2: matches removed (no participants) still tells everyone with a sheet", async () => {
    const { tripId, competitionId, teamIds } = await ctx.createCupTrip({
      name: "1442 no matches", scoringModel: "match_play", members: [["member", "Member"]], teams: ["A", "B"],
    });
    await roster(competitionId, teamIds, [ctx.user.id, ctx.getUser("member").id]);
    const gameId = await pickem(tripId, competitionId, [ctx.user.id, ctx.getUser("member").id], []);
    expect(await audienceOf(tripId, gameId, competitionId)).toEqual([ctx.user.id, ctx.getUser("member").id].sort());
  }, 60_000);

  it("a SIDE pick'em (no cup) tells its sheet-holders too", async () => {
    const tripId = await ctx.createTrip("1442 side");
    await ctx.addTripMember(tripId, "member", "Member");
    const gameId = await pickem(tripId, null, [ctx.user.id, ctx.getUser("member").id], []);
    expect(await audienceOf(tripId, gameId, null)).toEqual([ctx.user.id, ctx.getUser("member").id].sort());
  }, 60_000);

  it("someone with neither a sheet nor a match is NOT told", async () => {
    const { tripId, competitionId, teamIds } = await ctx.createCupTrip({
      name: "1442 bystander", scoringModel: "match_play", members: [["member", "Member"], ["outsider", "Member"]], teams: ["A", "B"],
    });
    await roster(competitionId, teamIds, [ctx.user.id, ctx.getUser("member").id, ctx.getUser("outsider").id]);
    const gameId = await pickem(tripId, competitionId, [ctx.user.id], [ctx.user.id]);
    expect(await audienceOf(tripId, gameId, competitionId)).toEqual([ctx.user.id]);
  }, 60_000);

  it("a failed sheets read throws rather than narrowing the audience", async () => {
    const { tripId, competitionId, teamIds } = await ctx.createCupTrip({
      name: "1442 read fails", scoringModel: "match_play", members: [["member", "Member"]], teams: ["A", "B"],
    });
    await roster(competitionId, teamIds, [ctx.user.id, ctx.getUser("member").id]);
    const gameId = await pickem(tripId, competitionId, [ctx.user.id, ctx.getUser("member").id], [ctx.user.id]);
    const failing = clientFailingRead(ctx.admin, { table: "pickem_picks", columns: "user_id" });
    await expect(audienceOf(tripId, gameId, competitionId, failing)).rejects.toThrow("try again in a moment");
  }, 60_000);
});
