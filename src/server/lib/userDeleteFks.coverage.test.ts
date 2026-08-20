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

/**
 * Every FK into `public.users` that BLOCKS a delete must be a deliberate,
 * declared choice — not an accident of a column added with the default.
 *
 * ── This assertion CHANGED in migration 131, and the reason is the point ──
 *
 * It used to be `toEqual([])`: no blocking FK, ever. That was correct while
 * `handle_user_delete` DELETED the `public.users` row, because then any
 * blocking FK failed the whole auth-user delete and made an account
 * undeleteable (#993).
 *
 * Migration 130 changed the premise. Account deletion now CONVERTS the row to
 * a placeholder and never deletes it, so a blocking FK cannot break account
 * deletion any more. The only thing that still deletes a `users` row is
 * `delete_orphan_guest_user`, which catches `foreign_key_violation` on purpose
 * — there, being blocked is the DESIRED outcome: the placeholder survives with
 * its history rather than taking an expense and everyone's splits with it.
 *
 * So the invariant is no longer "nothing blocks" but "only these block, and we
 * said so". Same shape as the configHash coverage guard: read the live
 * catalog, and require every row to be in a declared set. A new blocking FK
 * added carelessly still fails here; a deliberate one is written down.
 */
const DELIBERATELY_BLOCKING: Record<string, string> = {
  // Shared ledger entries. Deleting a person must never change what someone
  // else owes, so these refuse — and `delete_orphan_guest_user` swallows the
  // refusal, leaving the placeholder in place (migration 131, reversing 027).
  expenses_paid_by_user_id_fkey: "expenses.paid_by_user_id",
  expense_splits_user_id_fkey: "expense_splits.user_id",
};

describe("FKs into public.users that block a delete are declared, not accidental", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
  }, 30_000);

  afterAll(async () => {
    await ctx.cleanup();
  }, 30_000);

  // ── Observational: the class, not the instance ──────────────────────────
  it("every blocking FK into public.users is one we declared", async () => {
    const { data, error } = await ctx.admin.rpc("user_delete_blocking_fks");
    expect(error).toBeNull();

    const found = (data ?? []) as { constraint_name: string; child_table: string; child_column: string }[];
    const undeclared = found.filter((f) => !(f.constraint_name in DELIBERATELY_BLOCKING));
    // Names the column in the failure, so the message says WHICH one is new
    // rather than just that a count moved.
    expect(undeclared.map((f) => `${f.child_table}.${f.child_column}`)).toEqual([]);
  });

  it("...and each declared one is actually still there", async () => {
    // The other direction, which a one-sided allowlist misses: if a future
    // migration quietly relaxes one of these back to CASCADE, deleting a
    // placeholder would silently destroy shared money again — the exact
    // regression migration 131 exists to prevent. An entry that no longer
    // matches reality is a stale claim, so it fails too.
    const { data } = await ctx.admin.rpc("user_delete_blocking_fks");
    const names = new Set(((data ?? []) as { constraint_name: string }[]).map((f) => f.constraint_name));
    for (const declared of Object.keys(DELIBERATELY_BLOCKING)) {
      expect(names.has(declared), `${declared} no longer blocks`).toBe(true);
    }
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
