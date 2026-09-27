import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * PR 6b — side games: a game on a trip that counts toward no competition
 * (ruling 1), listed on the games page by `games.sideBoard`.
 *
 * Claims, each on its own trip so nothing one case writes is another's
 * starting state:
 *  - a side game can be created on a trip with NO competition — the thing that
 *    made JD build a fake three-team cup — and appears on the side board, its
 *    row built by the same `boardRow` the leaderboard uses;
 *  - a format that records nothing without a competition is REFUSED as a side
 *    game, reading the declaration (`allowedContainers`), with the control
 *    showing the same format is admitted INTO a cup;
 *  - a finished side game names its WINNER (a tie names both), never a row of
 *    zeros;
 *  - a cup game never appears as a side game, and display order is per TRIP.
 */

let ctx: TestContext;
let owner: string, member: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  owner = ctx.user.id;
  member = ctx.getUser("member").id;
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

async function sideTrip(title: string): Promise<string> {
  const tripId = await ctx.createTrip(title);
  await ctx.addTripMember(tripId, "member", "Member");
  return tripId;
}

/** A stroke side game with owner and member grouped and 18 holes each. */
async function finishedStroke(tripId: string, ownerScore: number, memberScore: number): Promise<string> {
  const g = (await ctx.caller().games.create({ tripId, gameTypeId: "gtt_stroke_play", name: "Practice round" })) as { id: string };
  const parts = await ctx.admin.from("game_participants").insert([
    { id: genId("gp"), game_id: g.id, user_id: owner },
    { id: genId("gp"), game_id: g.id, user_id: member },
  ]);
  if (parts.error) throw new Error(`seed participants: ${parts.error.message}`);
  await ctx.groupStrokeParticipants(g.id, [owner, member]);
  const rows = [
    [owner, ownerScore],
    [member, memberScore],
  ].flatMap(([pid, v]) =>
    Array.from({ length: 18 }, (_, i) => ({
      id: genId("se"), game_id: g.id, participant_id: pid as string, participant_type: "user",
      unit_label: String(i + 1), value: v as number, submitted_by: pid as string,
    }))
  );
  const scores = await ctx.admin.from("score_entries").insert(rows);
  if (scores.error) throw new Error(`seed scores: ${scores.error.message}`);
  await ctx.caller().games.finish({ tripId, gameId: g.id });
  return g.id;
}

describe("a game needs no competition", () => {
  it("a stroke game is created on a trip with no competition and shows on the side board", async () => {
    const tripId = await sideTrip("No cup at all");
    const g = (await ctx.caller().games.create({ tripId, gameTypeId: "gtt_stroke_play", name: "Practice round" })) as { id: string };

    const board = await ctx.caller().games.sideBoard({ tripId });
    expect(board.map((r) => r.id)).toEqual([g.id]);
    const row = board[0];
    expect(row.sideGame).toBe(true);
    // Built by the shared `boardRow`: a just-added game is New, not started.
    expect(row.isNewGame).toBe(true);
    expect(row.started).toBe(false);
    expect(row.status).toBe("pending");
    expect(row.winners).toEqual([]);
  }, 60_000);

  it("a member can read the side board; someone off the trip cannot", async () => {
    const tripId = await sideTrip("Who can see");
    await ctx.caller().games.create({ tripId, gameTypeId: "gtt_skins", name: "Skins, back nine" });
    await expect(ctx.callerAs("member").games.sideBoard({ tripId })).resolves.toHaveLength(1);
    await expect(ctx.callerAs("outsider").games.sideBoard({ tripId })).rejects.toThrow();
  }, 60_000);
});

describe("only formats that record a result without a cup can be side games", () => {
  it("pick'em as a side game is refused, naming why and what to do", async () => {
    const tripId = await sideTrip("No side pick'em");
    await expect(
      ctx.caller().games.create({ tripId, gameTypeId: "gtt_pickem", name: "Sunday slate" })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Pick'em records its result against a competition's teams, so it can't be a side game. Add it to the trip's competition.",
    });
    expect(await ctx.caller().games.sideBoard({ tripId })).toEqual([]);
  }, 60_000);

  it("CONTROL: the same format is admitted INTO a cup", async () => {
    const { tripId, competitionId } = await ctx.createCupTrip({ name: "Pick'em cup", scoringModel: "points", members: ["member"] });
    await expect(
      ctx.caller().games.create({ tripId, gameTypeId: "gtt_pickem", name: "Sunday slate", competitionId })
    ).resolves.toBeTruthy();
  }, 60_000);
});

describe("a finished side game names its winner", () => {
  it("the lower stroke total wins, and the row carries a name, not points", async () => {
    const tripId = await sideTrip("Winner named");
    const gameId = await finishedStroke(tripId, 4, 5);
    const row = (await ctx.caller().games.sideBoard({ tripId })).find((r) => r.id === gameId)!;
    expect(row.status).toBe("complete");
    const { data: me } = await ctx.admin.from("users").select("name").eq("id", owner).single();
    expect(row.winners).toEqual([(me as { name: string }).name]);
    expect(row.pointsTotal).toBeNull();
  }, 120_000);

  it("a tie names everyone who shares first", async () => {
    const tripId = await sideTrip("Winner tie");
    const gameId = await finishedStroke(tripId, 4, 4);
    const row = (await ctx.caller().games.sideBoard({ tripId })).find((r) => r.id === gameId)!;
    expect(row.winners).toHaveLength(2);
  }, 120_000);
});

describe("side games and cup games on one trip", () => {
  it("a cup game is not a side game, and display order is per trip", async () => {
    const { tripId, competitionId } = await ctx.createCupTrip({ name: "Mixed trip", scoringModel: "points", members: ["member"] });
    const cupGame = (await ctx.caller().games.create({ tripId, gameTypeId: "gtt_stroke_play", name: "Cup round", competitionId })) as { id: string };
    const side = (await ctx.caller().games.create({ tripId, gameTypeId: "gtt_stroke_play", name: "Practice round" })) as { id: string };

    const board = await ctx.caller().games.sideBoard({ tripId });
    expect(board.map((r) => r.id)).toEqual([side.id]);

    const { data } = await ctx.admin.from("games").select("id, display_order").in("id", [cupGame.id, side.id]);
    const order = new Map((data ?? []).map((r) => [r.id as string, r.display_order as number]));
    expect(order.get(side.id)).toBe((order.get(cupGame.id) ?? 0) + 1);
  }, 60_000);
});
