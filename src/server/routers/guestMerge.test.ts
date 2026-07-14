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
  let ctx: TestContext;
  let tripId: string;
  let gameId: string;
  let matchId: string;
  let ghostId: string;
  let realId: string;

  // Row ids we assert on (so a parallel run's data can't confuse the counts).
  const gpId = genId("gp");
  const seUserId = genId("se-user");
  const sePgId = genId("se-pg"); // polymorphic play_group row — MUST stay under ghost
  const grUserId = genId("gr-user");
  const grTeamId = genId("gr-team"); // polymorphic team row — MUST stay under ghost
  const mhoId = genId("mho");

  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Guest Merge #5 Trip");

    ghostId = genId("ghost");
    realId = genId("real");
    // A guest placeholder + the freshly-created real account the merge targets
    // (handle_new_user makes the real row immediately before merging — modelled here).
    const { error: uErr } = await ctx.admin.from("users").insert([
      { id: ghostId, name: "Ghosty McScore", is_guest: true },
      { id: realId, name: "Real McReal", is_guest: false },
    ]);
    if (uErr) throw new Error(`seed users: ${uErr.message}`);

    // The ghost is also a trip member — the existing-10 reassignment (regression #6).
    await ctx.addTripMemberById(tripId, ghostId, "Member");

    // A game + a match to hang scoring rows off (game_id / match_id FKs).
    gameId = genId("game");
    matchId = genId("match");
    const { error: gErr } = await ctx.admin.from("games").insert({
      id: gameId, trip_id: tripId, game_type_id: "gtt_match_play", name: "Merge #5 Game", status: "active",
    });
    if (gErr) throw new Error(`seed game: ${gErr.message}`);
    const { error: mErr } = await ctx.admin.from("game_matches").insert({
      id: matchId, game_id: gameId, match_number: 1, status: "active",
    });
    if (mErr) throw new Error(`seed game_match: ${mErr.message}`);

    const now = new Date().toISOString();
    // ── guest-USER scoring rows (must all follow the merge) ──
    const seeds = await Promise.all([
      ctx.admin.from("game_participants").insert({ id: gpId, game_id: gameId, user_id: ghostId, created_at: now }),
      ctx.admin.from("score_entries").insert({ id: seUserId, game_id: gameId, participant_id: ghostId, participant_type: "user", unit_label: "1", value: 4, annotations: {}, submitted_by: ghostId, submitted_at: now }),
      ctx.admin.from("game_results").insert({ id: grUserId, game_id: gameId, entity_id: ghostId, entity_type: "user", position: 1, computed_at: now }),
      ctx.admin.from("match_hole_outcomes").insert({ id: mhoId, game_id: gameId, match_id: matchId, hole_number: 1, result: "side_a", submitted_by: ghostId, submitted_at: now }),
      // ── polymorphic NON-user rows whose id EQUALS the ghost's — the guard test:
      //    a naive "WHERE = ghost" without the type filter would wrongly rewrite these.
      ctx.admin.from("score_entries").insert({ id: sePgId, game_id: gameId, participant_id: ghostId, participant_type: "play_group", unit_label: "2", value: 5, annotations: {}, submitted_at: now }),
      ctx.admin.from("game_results").insert({ id: grTeamId, game_id: gameId, entity_id: ghostId, entity_type: "team", position: 1, computed_at: now }),
    ]);
    const seedErr = seeds.find((r) => r.error);
    if (seedErr?.error) throw new Error(`seed scoring rows: ${seedErr.error.message}`);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    // Delete the game (CASCADE clears all scoring rows + the match) then the two
    // users, then the trip via cleanup().
    await ctx.admin.from("games").delete().eq("id", gameId);
    await ctx.admin.from("users").delete().in("id", [ghostId, realId]);
    await ctx.cleanup();
  }, HOOK_TIMEOUT_MS);

  // Ordered: atomicity (rolls back, ghost intact) BEFORE the happy merge consumes it.
  it("is ATOMIC — a merge to a non-existent real id rolls back ALL reassignments (nothing moves)", async () => {
    const { error } = await ctx.admin.rpc("merge_guest_to_real_user", {
      p_ghost_id: ghostId,
      p_real_id: "no-such-real-user-xyz",
    });
    expect(error).not.toBeNull(); // FK violation on the first user-referencing UPDATE

    // Nothing was reassigned — every guest row is still under the ghost id.
    const gp = await ctx.admin.from("game_participants").select("user_id").eq("id", gpId).single();
    expect(gp.data?.user_id).toBe(ghostId);
    const tm = await ctx.admin.from("trip_members").select("user_id").eq("trip_id", tripId).eq("user_id", ghostId);
    expect(tm.data?.length).toBe(1);
    const ghost = await ctx.admin.from("users").select("id").eq("id", ghostId).single();
    expect(ghost.data?.id).toBe(ghostId); // ghost NOT deleted
  }, HOOK_TIMEOUT_MS);

  it("reassigns all four scoring tables + the existing 10, leaves polymorphic non-user rows, and removes the ghost", async () => {
    const { error } = await ctx.admin.rpc("merge_guest_to_real_user", {
      p_ghost_id: ghostId,
      p_real_id: realId,
    });
    expect(error).toBeNull();

    // (1) scoring history followed the merge — every guest-user row is now the real id.
    const gp = await ctx.admin.from("game_participants").select("user_id").eq("id", gpId).single();
    expect(gp.data?.user_id).toBe(realId);
    const seUser = await ctx.admin.from("score_entries").select("participant_id, submitted_by").eq("id", seUserId).single();
    expect(seUser.data?.participant_id).toBe(realId);
    expect(seUser.data?.submitted_by).toBe(realId);
    const grUser = await ctx.admin.from("game_results").select("entity_id").eq("id", grUserId).single();
    expect(grUser.data?.entity_id).toBe(realId);
    const mho = await ctx.admin.from("match_hole_outcomes").select("submitted_by").eq("id", mhoId).single();
    expect(mho.data?.submitted_by).toBe(realId);

    // (6) existing-10 still works — the ghost's trip membership moved too.
    const tmReal = await ctx.admin.from("trip_members").select("user_id").eq("trip_id", tripId).eq("user_id", realId);
    expect(tmReal.data?.length).toBe(1);

    // (3) polymorphic NON-user rows are UNTOUCHED — the type guard held.
    const sePg = await ctx.admin.from("score_entries").select("participant_id, participant_type").eq("id", sePgId).single();
    expect(sePg.data?.participant_id).toBe(ghostId);
    expect(sePg.data?.participant_type).toBe("play_group");
    const grTeam = await ctx.admin.from("game_results").select("entity_id, entity_type").eq("id", grTeamId).single();
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
