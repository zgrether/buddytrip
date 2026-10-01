import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

const STROKE_PLAY = "gtt_stroke_play";

/**
 * EVERY CASE BUILDS ITS OWN GAME (#1527). The first block threaded one
 * `gameId` through a life — created by the first case, given participants by
 * the next, read, finished — so shuffled ahead of "create", the participant
 * cases sent `gameId: undefined` and finish tried to group players into no game.
 */
let ctx: TestContext;

/** Owner + planner (Organizer) + member, no games yet. */
async function crewTrip(label: string): Promise<string> {
  const tripId = await ctx.createTrip(`Stroke Play ${label}`);
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  return tripId;
}

/** A crew trip with a pending stroke game the Organizer made; optionally the owner + member on it. */
async function strokeGame(label: string, opts: { withPlayers: boolean }) {
  const tripId = await crewTrip(label);
  const game = await ctx
    .callerAs("planner")
    .games.create({ tripId, gameTypeId: STROKE_PLAY, name: "Saturday Round" });
  if (opts.withPlayers) {
    await ctx.callerAs("planner").games.addParticipants({
      tripId,
      gameId: game.id,
      userIds: [ctx.user.id, ctx.getUser("member").id],
    });
  }
  return { tripId, gameId: game.id as string };
}

async function gamesOn(tripId: string): Promise<number> {
  const { count, error } = await ctx.admin.from("games").select("id", { count: "exact", head: true }).eq("trip_id", tripId);
  if (error) throw new Error(`count games: ${error.message}`);
  return count ?? 0;
}

async function participantCount(gameId: string): Promise<number> {
  const { count, error } = await ctx.admin
    .from("game_participants").select("id", { count: "exact", head: true }).eq("game_id", gameId);
  if (error) throw new Error(`count participants: ${error.message}`);
  return count ?? 0;
}

describe("games router (Slice A — stroke play)", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("create — Organizer can create a pending game", async () => {
    const tripId = await crewTrip("organizer-create");
    const game = await ctx
      .callerAs("planner")
      .games.create({ tripId, gameTypeId: STROKE_PLAY, name: "Saturday Round" });
    expect(game.status).toBe("pending");
    expect(game.competition_id).toBeNull();
    expect(game.trip_id).toBe(tripId);
    expect(await gamesOn(tripId)).toBe(1);
  });

  it("create — Owner can create too", async () => {
    const tripId = await crewTrip("owner-create");
    const game = await ctx.caller().games.create({ tripId, gameTypeId: STROKE_PLAY });
    expect(game.status).toBe("pending");
  });

  it("create — a plain Member cannot (Organizer+ gate)", async () => {
    const tripId = await crewTrip("member-create");
    await expect(
      ctx.callerAs("member").games.create({ tripId, gameTypeId: STROKE_PLAY })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await gamesOn(tripId)).toBe(0);
  });

  it("create — an outsider cannot", async () => {
    const tripId = await crewTrip("outsider-create");
    await expect(
      ctx.callerAs("outsider").games.create({ tripId, gameTypeId: STROKE_PLAY })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await gamesOn(tripId)).toBe(0);
  });

  it("addParticipants — Organizer adds 2 users", async () => {
    const { tripId, gameId } = await strokeGame("add", { withPlayers: false });
    const participants = await ctx.callerAs("planner").games.addParticipants({
      tripId,
      gameId,
      userIds: [ctx.user.id, ctx.getUser("member").id],
    });
    expect(participants).toHaveLength(2);
    expect(participants.every((p: { play_group_id: string | null }) => p.play_group_id === null)).toBe(true);
  });

  it("addParticipants — idempotent (re-adding the same users doesn't duplicate)", async () => {
    const { tripId, gameId } = await strokeGame("idempotent", { withPlayers: true });
    expect(await participantCount(gameId)).toBe(2); // premise: they are already on it
    const participants = await ctx
      .callerAs("planner")
      .games.addParticipants({ tripId, gameId, userIds: [ctx.user.id, ctx.getUser("member").id] });
    expect(participants).toHaveLength(2);
    expect(await participantCount(gameId)).toBe(2);
  });

  it("addParticipants — a Member cannot", async () => {
    // A VALID input — two ids, the schema's floor. This case used to send ONE
    // id, so zod refused it (BAD_REQUEST) before the permission check ever ran,
    // and a bare `.rejects.toThrow()` read that as the Member being refused. It
    // never tested the gate in its name.
    const { tripId, gameId } = await strokeGame("member-add", { withPlayers: false });
    await expect(
      ctx.callerAs("member").games.addParticipants({
        tripId,
        gameId,
        userIds: [ctx.user.id, ctx.getUser("member").id],
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await participantCount(gameId)).toBe(0);
  });

  it("getById — a member gets the existence shell for a pending game; the owner sees the roster", async () => {
    // A2-core: a SETUP-mode (pending) game is members-walled — the existence shell
    // (the game row: name/type/status) stays so the placeholder renders, but the
    // ROSTER is withheld from a plain member. The owner (editor) sees it in full.
    const { tripId, gameId } = await strokeGame("shell", { withPlayers: true });
    const asMember = await ctx.callerAs("member").games.getById({ tripId, gameId });
    expect(asMember.id).toBe(gameId);
    expect(asMember.participants).toHaveLength(0);
    const asOwner = await ctx.caller().games.getById({ tripId, gameId });
    expect(asOwner.participants).toHaveLength(2);
  });

  it("listByTrip — any member sees the trip's games", async () => {
    const { tripId, gameId } = await strokeGame("list", { withPlayers: false });
    const games = await ctx.callerAs("member").games.listByTrip({ tripId });
    expect(games.map((g: { id: string }) => g.id)).toEqual([gameId]);
  });

  it("finish — computes results, ranks by total, marks complete", async () => {
    const { tripId, gameId } = await strokeGame("finish", { withPlayers: true });
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

    // QUALIFICATION (the "BBMI Playground" corruption): finalize now records only
    // players who COMPLETED the round, because an unscored player totalling 0
    // ranked FIRST under lowest-wins. Two holes each is no longer a finishable
    // round, so fill holes 3–18 in bulk — the two above still exercise the real
    // `scores.upsertEntry` path, which is what this test is about.
    const rest = [ctx.user.id, memberId].flatMap((pid) =>
      Array.from({ length: 16 }, (_, i) => ({
        id: crypto.randomUUID(),
        game_id: gameId,
        participant_id: pid,
        participant_type: "user",
        unit_label: String(i + 3),
        value: 0,
        annotations: {},
        submitted_by: ctx.user.id,
        submitted_at: new Date().toISOString(),
      }))
    );
    const { error: restErr } = await ctx.admin.from("score_entries").insert(rest);
    if (restErr) throw new Error(`seed remaining holes: ${restErr.message}`);

    const { standings } = await caller.games.finish({ tripId, gameId });
    expect(standings.find((s) => s.entityId === ctx.user.id)).toMatchObject({ rawScore: 8, position: 1 });
    expect(standings.find((s) => s.entityId === memberId)).toMatchObject({ rawScore: 11, position: 2 });

    const { data: game, error: gErr } = await ctx.admin.from("games").select("status").eq("id", gameId).single();
    if (gErr) throw new Error(`read game: ${gErr.message}`);
    expect((game as { status: string }).status).toBe("complete");
    const { data: results, error: rErr } = await ctx.admin.from("game_results").select("entity_id").eq("game_id", gameId);
    if (rErr) throw new Error(`read results: ${rErr.message}`);
    expect(results).toHaveLength(2);
  });

  it("finish — a Member cannot", async () => {
    const { tripId, gameId } = await strokeGame("member-finish", { withPlayers: true });
    await expect(ctx.callerAs("member").games.finish({ tripId, gameId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { data, error } = await ctx.admin.from("games").select("status").eq("id", gameId).single();
    if (error) throw new Error(`read game: ${error.message}`);
    expect((data as { status: string }).status).toBe("pending");
  });
});

describe("games router — result_strategy dispatch guard", () => {
  let ctx: TestContext;
  let tripId: string;
  let competitionId: string;

  beforeAll(async () => {
    ctx = await TestContext.create();
    // The manual games below are not side games (`allowedContainers`), so they
    // live in the trip's cup — a POINTS cup, which takes placement formats. The
    // stroke and unregistered-type games stay side games on the same trip.
    ({ tripId, competitionId } = await ctx.createCupTrip({
      name: "Dispatch Guard Trip",
      scoringModel: "points",
      teams: ["Team A", "Team B"],
    }));
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  /**
   * BEHAVIOUR CHANGE (finish/post merge). This case used to assert that a manual
   * game was REFUSED by `finish` ("Manual games cannot be finalized via finish —
   * use post with a placements array"), because a second procedure, `games.post`,
   * owned the manual arm. That fork is gone: `null` is now a served arm of the
   * one dispatch. What survives from the old assertion is the part that was
   * actually load-bearing — a manual game must never fall through to stroke-play
   * compute — so that is what is pinned, on BOTH the refusal and success paths.
   */
  it("finish — manual game (strategy=null) without placements throws BAD_REQUEST, nothing written", async () => {
    const game = await ctx.caller().games.create({ tripId, competitionId, gameTypeId: "gtt_manual", name: "Cornhole" });
    await expect(ctx.caller().games.finish({ tripId, gameId: game.id })).rejects.toMatchObject({
      message: expect.stringContaining("finishing order"),
    });
    // Guard must fire before any compute — confirm no game_results rows exist.
    const { data: results } = await ctx.admin.from("game_results").select("id").eq("game_id", game.id);
    expect(results).toHaveLength(0);
  });

  it("finish — manual game WITH placements writes the entered order and locks, via the same procedure", async () => {
    const game = await ctx.caller().games.create({ tripId, competitionId, gameTypeId: "gtt_manual", name: "Cornhole 2" });
    // entity ids are opaque to the manual arm (teams in production); the point
    // here is that the null arm commits an ORDER rather than computing scores.
    await ctx.caller().games.finish({
      tripId,
      gameId: game.id,
      placements: [
        { entityId: "entity-a", position: 1 },
        { entityId: "entity-b", position: 2 },
      ],
    });

    const { data: results } = await ctx.admin
      .from("game_results")
      .select("entity_id, entity_type, position")
      .eq("game_id", game.id)
      .order("position", { ascending: true });
    expect(results).toHaveLength(2);
    expect(results![0]).toMatchObject({ entity_id: "entity-a", entity_type: "team", position: 1 });
    expect(results![1]).toMatchObject({ entity_id: "entity-b", entity_type: "team", position: 2 });

    // Same lock as every other format — one finalize, one locked state.
    const { data: row } = await ctx.admin
      .from("games")
      .select("status, corrections_open, scoring_enabled")
      .eq("id", game.id)
      .maybeSingle();
    expect(row).toMatchObject({ status: "complete", corrections_open: false, scoring_enabled: true });
  });

  it("finish — an ENGINE game ignores placements rather than committing them", async () => {
    // Defence against the merge's one new input reaching an arm it does not
    // belong to: `placements` is manual-only, so a stroke game must compute from
    // scores (none here → empty standings) and never write the passed order.
    const game = await ctx.caller().games.create({ tripId, gameTypeId: "gtt_stroke_play", name: "Stroke Ignore" });

    // With no scores at all, finalize now REFUSES rather than recording an empty
    // result — qualification means "completed the round", and nobody has. That
    // strengthens this test rather than replacing it: the original point was
    // that `placements` must not reach an engine arm, and the strongest form of
    // that is the engine refusing outright while writing nothing.
    await expect(
      ctx.caller().games.finish({
        tripId,
        gameId: game.id,
        placements: [{ entityId: "should-not-appear", position: 1 }],
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    const { data: results } = await ctx.admin
      .from("game_results")
      .select("entity_id")
      .eq("game_id", game.id);
    expect((results ?? []).map((r) => r.entity_id)).not.toContain("should-not-appear");
    expect(results ?? []).toHaveLength(0);
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
