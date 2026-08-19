import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * Account deletion must not be blocked by an FK into `public.users`.
 *
 * `on_auth_user_deleted` -> `handle_user_delete()` does
 * `DELETE FROM public.users WHERE id = OLD.id::text`, and ANY child FK with
 * ON DELETE NO ACTION / RESTRICT rolls the whole auth-user delete back. The
 * user sees "Database error deleting user" and has no way forward.
 *
 * Migration 027 set the policy (authorship SET NULL, transient rows CASCADE)
 * and fixed every FK that existed then. `score_entries.submitted_by` arrived
 * later with the default NO ACTION and blocked deletion for anyone who had
 * ever entered a score — found in production on a real account (#993).
 *
 * Two tests, deliberately: one BEHAVIOURAL (the delete actually works and the
 * scores survive), one OBSERVATIONAL (no blocking FK exists at all, so the
 * NEXT such column fails here rather than in someone's account settings).
 */

let ctx: TestContext;

describe("account deletion is not blocked by any FK into public.users", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
  }, 30_000);

  afterAll(async () => {
    await ctx.cleanup();
  }, 30_000);

  // ── Observational: the class, not the instance ──────────────────────────
  it("no FK into public.users has a blocking ON DELETE", async () => {
    const { data, error } = await ctx.admin.rpc("user_delete_blocking_fks");
    expect(error).toBeNull();
    // Named in the failure so the message says WHICH column, not just a count.
    expect(data ?? []).toEqual([]);
  });

  // ── Behavioural: the exact production failure (#993) ────────────────────
  it("a user who submitted a score can be deleted, and the score survives", async () => {
    const tripId = await ctx.createTrip("Delete FK Test");
    const submitterId = genId("submitter");
    await ctx.admin
      .from("users")
      .insert({ id: submitterId, name: "Score Submitter", is_guest: true });

    const { data: game, error: gameErr } = await ctx.admin
      .from("games")
      .insert({ id: genId("game"), trip_id: tripId })
      .select("id")
      .single();
    expect(gameErr).toBeNull();

    const entryId = genId("entry");
    const { error: seErr } = await ctx.admin.from("score_entries").insert({
      id: entryId,
      game_id: game!.id,
      participant_id: submitterId,
      participant_type: "user",
      unit_label: "1",
      value: 4,
      submitted_by: submitterId,
    });
    expect(seErr).toBeNull();

    // The delete that used to fail with 23503.
    const { error: delErr } = await ctx.admin.from("users").delete().eq("id", submitterId);
    expect(delErr).toBeNull();

    // The score is game data, not the submitter's — it must OUTLIVE them, with
    // only the provenance dropped. A CASCADE here would silently punch holes in
    // a finished round's card for everyone else in it.
    const { data: survivor } = await ctx.admin
      .from("score_entries")
      .select("id, value, submitted_by")
      .eq("id", entryId)
      .maybeSingle();
    expect(survivor).toBeTruthy();
    expect(survivor!.value).toBe(4);
    expect(survivor!.submitted_by).toBeNull();

    await ctx.admin.from("score_entries").delete().eq("id", entryId);
    await ctx.admin.from("games").delete().eq("id", game!.id);
  });
});
