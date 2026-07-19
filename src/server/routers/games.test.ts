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

  it("getById — a member gets the existence shell for a pending game; the owner sees the roster", async () => {
    // A2-core: a SETUP-mode (pending) game is members-walled — the existence shell
    // (the game row: name/type/status) stays so the placeholder renders, but the
    // ROSTER is withheld from a plain member. The owner (editor) sees it in full.
    const asMember = await ctx.callerAs("member").games.getById({ tripId, gameId });
    expect(asMember.id).toBe(gameId);
    expect(asMember.participants).toHaveLength(0);
    const asOwner = await ctx.caller().games.getById({ tripId, gameId });
    expect(asOwner.participants).toHaveLength(2);
  });

  it("listByTrip — any member sees the trip's games", async () => {
    const games = await ctx.callerAs("member").games.listByTrip({ tripId });
    expect(games.some((g: { id: string }) => g.id === gameId)).toBe(true);
  });

  it("finish — computes results, ranks by total, marks complete", async () => {
    const caller = ctx.caller();
    const memberId = ctx.getUser("member").id;
    // Stroke go-live requires grouped participants (mig 089).
    await ctx.groupStrokeParticipants(gameId, [ctx.user.id, memberId]);
    await caller.games.enableScoring({ tripId, gameId }); // Phase 2B.1 universal gate
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

describe("games router — result_strategy dispatch guard", () => {
  let ctx: TestContext;
  let tripId: string;

  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Dispatch Guard Trip");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("finish — manual game (strategy=null) throws BAD_REQUEST, no stroke-play results written", async () => {
    const game = await ctx.caller().games.create({ tripId, gameTypeId: "gtt_manual", name: "Cornhole" });
    await expect(ctx.caller().games.finish({ tripId, gameId: game.id })).rejects.toMatchObject({
      message: expect.stringContaining("Manual games cannot be finalized via finish"),
    });
    // Guard must fire before any compute — confirm no game_results rows exist.
    const { data: results } = await ctx.admin.from("game_results").select("id").eq("game_id", game.id);
    expect(results).toHaveLength(0);
  });

  it("finish — an unregistered game type throws rather than silently scoring as stroke play", async () => {
    // The B2 guard, generalized by W-PERF-01: format definitions live in code,
    // so "unrecognized" now means "game_type_id not in the code catalog" (it used
    // to mean "unknown result_strategy string read from the DB"). The DB FK on
    // games.game_type_id still requires the type row to EXIST, so we seed it — but
    // because the id is absent from GAME_TYPE_DEFINITIONS, finish refuses to
    // compute. Seed, exercise the guard, clean up.
    const FAKE_ID = "gtt_b2_test_unknown";
    await ctx.admin.from("game_type_templates").insert({
      id: FAKE_ID,
      key: "b2_test_unknown",
      name: "B2 Test Unknown",
      description: "Temporary template for B2 guard test",
      result_strategy: "unknown_strategy",
      entry_schema: "user_holes",
      supports_free_for_all: true,
      supports_sides: false,
      requires_sides: false,
      sort_order: 999,
    });
    try {
      const game = await ctx.caller().games.create({ tripId, gameTypeId: FAKE_ID, name: "Unknown" });
      await expect(ctx.caller().games.finish({ tripId, gameId: game.id })).rejects.toMatchObject({
        message: expect.stringContaining(`Unknown game type '${FAKE_ID}'`),
      });
      // Guard fires before any compute — no results written.
      const { data: results } = await ctx.admin.from("game_results").select("id").eq("game_id", game.id);
      expect(results).toHaveLength(0);
    } finally {
      await ctx.admin.from("game_type_templates").delete().eq("id", FAKE_ID);
    }
  });
});
