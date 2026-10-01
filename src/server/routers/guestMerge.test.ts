import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * merge_guest_to_real_user — scoring-table reassignment (DB delete-semantics audit
 * finding #5, PRE-LAUNCH). Migration 078 adds the four scoring tables to the merge.
 *
 * These are DB-integration tests: seed a guest with rows in ALL four scoring tables
 * (+ polymorphic non-user rows that must be left alone), call the merge RPC as the
 * service role (the function is SECURITY DEFINER, REVOKEd from anon/authenticated),
 * and assert reassignment + polymorphic-safety + ghost-cleanup + atomicity.
 */

const HOOK_TIMEOUT_MS = 30_000;

describe("merge_guest_to_real_user — scoring tables (audit #5)", () => {
  /**
   * EACH CASE SEEDS ITS OWN GUEST (#1527). Both cases used to merge the SAME
   * ghost, with a comment ordering them: atomicity first, "BEFORE the happy
   * merge consumes it". Shuffled, the happy merge ran first and deleted the
   * ghost, so the atomicity case read a row that no longer existed — and a
   * merge that had genuinely rolled back would have failed the same way. Both
   * now build a guest with history and assert it is there before merging.
   */
  let ctx: TestContext;
  const madeUsers: string[] = [];
  const madeGames: string[] = [];

  type Seed = {
    tripId: string;
    ghostId: string;
    realId: string;
    gameId: string;
    gpId: string;
    seUserId: string;
    sePgId: string;
    grUserId: string;
    grTeamId: string;
    mhoId: string;
  };

  async function must(label: string, p: PromiseLike<{ error: { message: string } | null }>) {
    const { error } = await p;
    if (error) throw new Error(`${label}: ${error.message}`);
  }

  /** A guest with rows in all four scoring tables, plus polymorphic non-user rows. */
  async function seedGuestWithHistory(label: string): Promise<Seed> {
    const tripId = await ctx.createTrip(`Guest Merge #5 ${label}`);
    const ghostId = genId("ghost");
    const realId = genId("real");
    // A guest placeholder + the freshly-created real account the merge targets
    // (handle_new_user makes the real row immediately before merging — modelled here).
    await must("seed users", ctx.admin.from("users").insert([
      { id: ghostId, name: "Ghosty McScore", is_guest: true },
      { id: realId, name: "Real McReal", is_guest: false },
    ]));
    madeUsers.push(ghostId, realId);

    // The ghost is also a trip member — the existing-10 reassignment (regression #6).
    await ctx.addTripMemberById(tripId, ghostId, "Member");

    // A game + a match to hang scoring rows off (game_id / match_id FKs).
    const gameId = genId("game");
    const matchId = genId("match");
    await must("seed game", ctx.admin.from("games").insert({
      id: gameId, trip_id: tripId, game_type_id: "gtt_match_play", name: "Merge #5 Game", status: "active",
    }));
    madeGames.push(gameId);
    await must("seed game_match", ctx.admin.from("game_matches").insert({
      id: matchId, game_id: gameId, match_number: 1, status: "active",
    }));

    const s = {
      gpId: genId("gp"),
      seUserId: genId("se-user"),
      sePgId: genId("se-pg"), // polymorphic play_group row — MUST stay under ghost
      grUserId: genId("gr-user"),
      grTeamId: genId("gr-team"), // polymorphic team row — MUST stay under ghost
      mhoId: genId("mho"),
    };
    const now = new Date().toISOString();
    // Sequentially, never Promise.all — these race and flake (CLAUDE.md).
    // ── guest-USER scoring rows (must all follow the merge) ──
    await must("seed game_participants", ctx.admin.from("game_participants").insert({ id: s.gpId, game_id: gameId, user_id: ghostId, created_at: now }));
    await must("seed score_entries", ctx.admin.from("score_entries").insert({ id: s.seUserId, game_id: gameId, participant_id: ghostId, participant_type: "user", unit_label: "1", value: 4, annotations: {}, submitted_by: ghostId, submitted_at: now }));
    await must("seed game_results", ctx.admin.from("game_results").insert({ id: s.grUserId, game_id: gameId, entity_id: ghostId, entity_type: "user", value_kind: "rank", position: 1, computed_at: now }));
    await must("seed match_hole_outcomes", ctx.admin.from("match_hole_outcomes").insert({ id: s.mhoId, game_id: gameId, match_id: matchId, hole_number: 1, result: "side_a", submitted_by: ghostId, submitted_at: now }));
    // ── polymorphic NON-user rows whose id EQUALS the ghost's — the guard test:
    //    a naive "WHERE = ghost" without the type filter would wrongly rewrite these.
    await must("seed play_group score", ctx.admin.from("score_entries").insert({ id: s.sePgId, game_id: gameId, participant_id: ghostId, participant_type: "play_group", unit_label: "2", value: 5, annotations: {}, submitted_at: now }));
    await must("seed team result", ctx.admin.from("game_results").insert({ id: s.grTeamId, game_id: gameId, entity_id: ghostId, entity_type: "team", value_kind: "rank", position: 1, computed_at: now }));

    return { tripId, ghostId, realId, gameId, ...s };
  }

  /** The premise both cases rest on: the ghost exists and owns its history. */
  async function expectGhostHoldsHistory(seed: Seed) {
    const gp = await ctx.admin.from("game_participants").select("user_id").eq("id", seed.gpId).single();
    expect(gp.data?.user_id).toBe(seed.ghostId);
    const tm = await ctx.admin.from("trip_members").select("user_id").eq("trip_id", seed.tripId).eq("user_id", seed.ghostId);
    expect(tm.data?.length).toBe(1);
    const ghost = await ctx.admin.from("users").select("id").eq("id", seed.ghostId).single();
    expect(ghost.data?.id).toBe(seed.ghostId);
  }

  beforeAll(async () => {
    ctx = await TestContext.create();
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    // Delete the games (CASCADE clears all scoring rows + the matches) then the
    // users, then the trips via cleanup().
    if (madeGames.length) await ctx.admin.from("games").delete().in("id", madeGames);
    if (madeUsers.length) await ctx.admin.from("users").delete().in("id", madeUsers);
    await ctx.cleanup();
  }, HOOK_TIMEOUT_MS);

  it("is ATOMIC — a merge to a non-existent real id rolls back ALL reassignments (nothing moves)", async () => {
    const seed = await seedGuestWithHistory("atomic");
    await expectGhostHoldsHistory(seed); // premise

    const { error } = await ctx.admin.rpc("merge_guest_to_real_user", {
      p_ghost_id: seed.ghostId,
      p_real_id: "no-such-real-user-xyz",
    });
    expect(error).not.toBeNull(); // FK violation on the first user-referencing UPDATE

    // Nothing was reassigned — every guest row is still under the ghost id, and
    // the ghost was NOT deleted.
    await expectGhostHoldsHistory(seed);
  }, HOOK_TIMEOUT_MS);

  it("reassigns all four scoring tables + the existing 10, leaves polymorphic non-user rows, and removes the ghost", async () => {
    const seed = await seedGuestWithHistory("happy");
    const { ghostId, realId, gameId, tripId } = seed;
    await expectGhostHoldsHistory(seed); // premise: the absences below are a change, not a starting state

    const { error } = await ctx.admin.rpc("merge_guest_to_real_user", {
      p_ghost_id: ghostId,
      p_real_id: realId,
    });
    expect(error).toBeNull();

    // (1) scoring history followed the merge — every guest-user row is now the real id.
    const gp = await ctx.admin.from("game_participants").select("user_id").eq("id", seed.gpId).single();
    expect(gp.data?.user_id).toBe(realId);
    const seUser = await ctx.admin.from("score_entries").select("participant_id, submitted_by").eq("id", seed.seUserId).single();
    expect(seUser.data?.participant_id).toBe(realId);
    expect(seUser.data?.submitted_by).toBe(realId);
    const grUser = await ctx.admin.from("game_results").select("entity_id").eq("id", seed.grUserId).single();
    expect(grUser.data?.entity_id).toBe(realId);
    const mho = await ctx.admin.from("match_hole_outcomes").select("submitted_by").eq("id", seed.mhoId).single();
    expect(mho.data?.submitted_by).toBe(realId);

    // (6) existing-10 still works — the ghost's trip membership moved too.
    const tmReal = await ctx.admin.from("trip_members").select("user_id").eq("trip_id", tripId).eq("user_id", realId);
    expect(tmReal.data?.length).toBe(1);

    // (3) polymorphic NON-user rows are UNTOUCHED — the type guard held.
    const sePg = await ctx.admin.from("score_entries").select("participant_id, participant_type").eq("id", seed.sePgId).single();
    expect(sePg.data?.participant_id).toBe(ghostId);
    expect(sePg.data?.participant_type).toBe("play_group");
    const grTeam = await ctx.admin.from("game_results").select("entity_id, entity_type").eq("id", seed.grTeamId).single();
    expect(grTeam.data?.entity_id).toBe(ghostId);
    expect(grTeam.data?.entity_type).toBe("team");

    // (4) ghost is reference-free in the four tables AND deleted (was undeletable before).
    const ghostGp = await ctx.admin.from("game_participants").select("id").eq("game_id", gameId).eq("user_id", ghostId);
    expect(ghostGp.data?.length).toBe(0);
    const ghostSubmit = await ctx.admin.from("score_entries").select("id").eq("game_id", gameId).eq("submitted_by", ghostId);
    expect(ghostSubmit.data?.length).toBe(0);
    const ghost = await ctx.admin.from("users").select("id").eq("id", ghostId);
    expect(ghost.data?.length).toBe(0);
  }, HOOK_TIMEOUT_MS);
});
