import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * Migration 142 — `delete_orphan_guest_user` must see a match SEAT.
 *
 * The function's guard was `NOT EXISTS (trip_members)` plus an
 * `EXCEPTION WHEN foreign_key_violation` arm. Both are FOREIGN-KEY shaped, and
 * the one person-reference no foreign key can see is
 * `game_matches.side_a/side_b` — a `{type,id}` inside JSONB. So the delete
 * succeeded and left a side ref naming a `users` row that no longer existed,
 * which surfaces much later as an illegible `save_game_config` refusal (#1032).
 *
 * ── ⚠️ The assertion that matters, and the one that would prove nothing ─────
 *
 * A guest seeded with ANY foreign-key-visible history (an expense, a split, a
 * score) is kept by the OLD function too — its exception arm catches the
 * violation. Such a test is green against the bug.
 *
 * So the decisive case seeds a guest with NO trip membership, NO expenses, NO
 * splits, NO scores and NO `game_participants` row — nothing a foreign key
 * could fire on — and ONLY a JSONB side ref. The old function deletes that row;
 * the new one must not. That is the CLAUDE.md rule applied directly: ask what
 * would leave this green that shouldn't.
 *
 * The CONTROL is equally load-bearing. A function that refused every delete
 * would satisfy the case above while destroying the reason 016 exists (freeing
 * a removed guest's email for reuse), so an otherwise-identical guest with no
 * seat must still be deleted.
 */

let ctx: TestContext;

/** A bare guest `users` row — no memberships, no history of any kind. */
async function createBareGuest(label: string): Promise<string> {
  const id = genId(label);
  const { error } = await ctx.admin
    .from("users")
    .insert({ id, name: "Seat Holder", is_guest: true, email: `${id}@example.com` });
  if (error) throw new Error(`guest insert failed: ${error.message}`);
  return id;
}

async function userExists(id: string): Promise<boolean> {
  const { data } = await ctx.admin.from("users").select("id").eq("id", id).maybeSingle();
  return !!data;
}

describe("delete_orphan_guest_user sees the JSONB match seat (migration 142)", () => {
  let tripId: string;
  let gameId: string;

  beforeAll(async () => {
    ctx = await TestContext.create();
    // Sequential, never Promise.all — createTrip/addTripMember can race.
    tripId = await ctx.createTrip("Orphan seat guard");
    gameId = genId("game");
    const { error } = await ctx.admin.from("games").insert({
      id: gameId,
      trip_id: tripId,
      game_type_id: "gtt_match_play",
      name: "Seat guard game",
      status: "pending",
    });
    if (error) throw new Error(`game insert failed: ${error.message}`);
  }, 60_000);

  afterAll(async () => {
    await ctx.admin.from("game_matches").delete().eq("game_id", gameId);
    await ctx.admin.from("games").delete().eq("id", gameId);
    await ctx.cleanup();
  }, 60_000);

  it("REFUSES to delete a guest still named by a side ref — the case with no FK to fire", async () => {
    const guest = await createBareGuest("seated-guest");
    const matchId = genId("match");
    const { error } = await ctx.admin.from("game_matches").insert({
      id: matchId,
      game_id: gameId,
      match_number: 1,
      display_order: 0,
      side_a: { type: "user", id: guest },
      side_b: null,
      status: "pending",
    });
    if (error) throw new Error(`match insert failed: ${error.message}`);

    // Premise assertion — without this the test could pass for the wrong
    // reason (a guest that some other row was quietly holding). Nothing
    // foreign-key-visible references this guest at all.
    for (const table of ["trip_members", "game_participants", "team_assignments"] as const) {
      const { count } = await ctx.admin
        .from(table)
        .select("user_id", { count: "exact", head: true })
        .eq("user_id", guest);
      expect(count, `${table} should hold nothing for this guest`).toBe(0);
    }

    await ctx.admin.rpc("delete_orphan_guest_user", { p_user_id: guest });

    expect(await userExists(guest), "the seat is the only reference, and it must count").toBe(true);

    // And the seat still resolves — the point of keeping the row.
    const { data: m } = await ctx.admin
      .from("game_matches")
      .select("side_a")
      .eq("id", matchId)
      .maybeSingle();
    expect((m!.side_a as { id: string }).id).toBe(guest);
  });

  it("REFUSES on side_b too, not just side_a", async () => {
    const guest = await createBareGuest("seated-guest-b");
    const matchId = genId("match");
    await ctx.admin.from("game_matches").insert({
      id: matchId,
      game_id: gameId,
      match_number: 2,
      display_order: 1,
      side_a: null,
      side_b: { type: "user", id: guest },
      status: "pending",
    });

    await ctx.admin.rpc("delete_orphan_guest_user", { p_user_id: guest });
    expect(await userExists(guest)).toBe(true);
  });

  it("CONTROL: still deletes an orphan guest with no seat — 016's whole purpose", async () => {
    // Without this, a function that refused everything would pass the cases
    // above while breaking email reuse.
    const guest = await createBareGuest("unseated-guest");
    await ctx.admin.rpc("delete_orphan_guest_user", { p_user_id: guest });
    expect(await userExists(guest), "no seat, no membership, no history → deletable").toBe(false);
  });

  it("CONTROL: a vacated seat releases the guest — the removal path's own sequence", async () => {
    // `ghostCrew.remove` vacates via clearTripParticipation and THEN calls this.
    // Once the seat is NULL the guard must stop holding the row, or removal
    // would never free an email again.
    const guest = await createBareGuest("vacated-guest");
    const matchId = genId("match");
    await ctx.admin.from("game_matches").insert({
      id: matchId,
      game_id: gameId,
      match_number: 3,
      display_order: 2,
      side_a: { type: "user", id: guest },
      side_b: null,
      status: "pending",
    });

    await ctx.admin.rpc("delete_orphan_guest_user", { p_user_id: guest });
    expect(await userExists(guest), "held while seated").toBe(true);

    await ctx.admin.from("game_matches").update({ side_a: null }).eq("id", matchId);
    await ctx.admin.rpc("delete_orphan_guest_user", { p_user_id: guest });
    expect(await userExists(guest), "released once vacated").toBe(false);
  });

  it("anon cannot call it at all — the REVOKE that makes the guard load-bearing", async () => {
    /**
     * Postgres grants EXECUTE to PUBLIC by default and migration 016 added
     * `authenticated` without revoking it, so this SECURITY DEFINER function —
     * which DELETES rows — was reachable by `anon`.
     *
     * This test is what keeps migration 142's own argument honest: moving the
     * seat check from the caller into the function is only worth more than
     * leaving it in the caller if the function cannot be invoked by someone who
     * never went through that caller.
     */
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const guest = await createBareGuest("anon-target");

    const { error } = await anon.rpc("delete_orphan_guest_user", { p_user_id: guest });
    expect(error, "no EXECUTE grant for anon → PostgREST refuses").not.toBeNull();

    // And the refusal was real, not merely reported: the row is still there.
    expect(await userExists(guest)).toBe(true);
    await ctx.admin.from("users").delete().eq("id", guest);
  });

  it("a play_group side does not hold a USER row hostage", async () => {
    // A doubles side names a play_group, whose id is never a users id. The
    // guard compares only `type = 'user'` refs, so a group seat must not block
    // an unrelated guest's delete — the id spaces cannot collide, and matching
    // on id alone would be comparing two different namespaces.
    const guest = await createBareGuest("group-side-guest");
    const matchId = genId("match");
    await ctx.admin.from("game_matches").insert({
      id: matchId,
      game_id: gameId,
      match_number: 4,
      display_order: 3,
      side_a: { type: "play_group", id: guest }, // same string, different namespace
      side_b: null,
      status: "pending",
    });

    await ctx.admin.rpc("delete_orphan_guest_user", { p_user_id: guest });
    expect(await userExists(guest), "a play_group ref is not a user ref").toBe(false);
  });
});
