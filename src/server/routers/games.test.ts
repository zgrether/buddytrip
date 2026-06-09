import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

const STROKE_PLAY = "gtt_stroke_play";

let ctx: TestContext;
let tripId: string;
let gameId: string;

describe("games router (Slice A — stroke play)", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Stroke Play Trip");
    await ctx.addTripMember(tripId, "planner", "Organizer");
    await ctx.addTripMember(tripId, "member", "Member");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("create — Organizer can create a pending game", async () => {
    const game = await ctx
      .callerAs("planner")
      .games.create({ tripId, gameTypeId: STROKE_PLAY, name: "Saturday Round" });
    gameId = game.id;
    expect(game.status).toBe("pending");
    expect(game.competition_id).toBeNull();
    expect(game.trip_id).toBe(tripId);
  });

  it("create — Owner can create too", async () => {
    const game = await ctx.caller().games.create({ tripId, gameTypeId: STROKE_PLAY });
    expect(game.status).toBe("pending");
  });

  it("create — a plain Member cannot (Organizer+ gate)", async () => {
    await expect(
      ctx.callerAs("member").games.create({ tripId, gameTypeId: STROKE_PLAY })
    ).rejects.toThrow();
  });

  it("create — an outsider cannot", async () => {
    await expect(
      ctx.callerAs("outsider").games.create({ tripId, gameTypeId: STROKE_PLAY })
    ).rejects.toThrow();
  });

  it("addParticipants — Organizer adds 2 users", async () => {
    const participants = await ctx.callerAs("planner").games.addParticipants({
      tripId,
      gameId,
      userIds: [ctx.user.id, ctx.getUser("member").id],
    });
    expect(participants).toHaveLength(2);
    expect(participants.every((p: { play_group_id: string | null }) => p.play_group_id === null)).toBe(true);
  });

  it("addParticipants — idempotent (re-adding the same users doesn't duplicate)", async () => {
    const participants = await ctx
      .callerAs("planner")
      .games.addParticipants({ tripId, gameId, userIds: [ctx.user.id, ctx.getUser("member").id] });
    expect(participants).toHaveLength(2);
  });

  it("addParticipants — a Member cannot", async () => {
    await expect(
      ctx.callerAs("member").games.addParticipants({ tripId, gameId, userIds: [ctx.user.id] })
    ).rejects.toThrow();
  });

  it("getById — any member sees the game + participants", async () => {
    const game = await ctx.callerAs("member").games.getById({ tripId, gameId });
    expect(game.id).toBe(gameId);
    expect(game.participants).toHaveLength(2);
  });

  it("listByTrip — any member sees the trip's games", async () => {
    const games = await ctx.callerAs("member").games.listByTrip({ tripId });
    expect(games.some((g: { id: string }) => g.id === gameId)).toBe(true);
  });

  it("finish — computes results, ranks by total, marks complete", async () => {
    const caller = ctx.caller();
    const memberId = ctx.getUser("member").id;
    // owner 4+4 = 8, member 5+6 = 11
    await caller.scores.upsertEntry({ tripId, gameId, participantId: ctx.user.id, unitLabel: "1", value: 4 });
    await caller.scores.upsertEntry({ tripId, gameId, participantId: ctx.user.id, unitLabel: "2", value: 4 });
    await caller.scores.upsertEntry({ tripId, gameId, participantId: memberId, unitLabel: "1", value: 5 });
    await caller.scores.upsertEntry({ tripId, gameId, participantId: memberId, unitLabel: "2", value: 6 });

    const { standings } = await caller.games.finish({ tripId, gameId });
    expect(standings.find((s) => s.entityId === ctx.user.id)).toMatchObject({ rawScore: 8, position: 1 });
    expect(standings.find((s) => s.entityId === memberId)).toMatchObject({ rawScore: 11, position: 2 });

    const { data: game } = await ctx.admin.from("games").select("status").eq("id", gameId).single();
    expect((game as { status: string }).status).toBe("complete");
    const { data: results } = await ctx.admin.from("game_results").select("entity_id").eq("game_id", gameId);
    expect(results).toHaveLength(2);
  });

  it("finish — a Member cannot", async () => {
    await expect(ctx.callerAs("member").games.finish({ tripId, gameId })).rejects.toThrow();
  });
});
