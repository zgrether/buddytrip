import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * Migration 131 — the FK backstop under the contribution guard.
 *
 * The guard (#996) is the primary defence and has to be: four of the nine
 * columns recording a contribution have no foreign key at all, and one is
 * `{type,id}` inside JSONB, which cannot be one. These two FKs are the backstop
 * for the two the database CAN see, and they exist because the guard is
 * application code that a direct PostgREST caller does not run.
 *
 * The measurement that produced it, taken before migration 130: deleting ONE
 * account removed 2 expenses and the 14 splits owed by 14 OTHER people.
 */

let ctx: TestContext;
let tripId: string;

describe("migration 131 — shared money survives removing a person", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Expense Restrict Trip");
  }, 30_000);

  afterAll(async () => {
    await ctx.cleanup();
  }, 30_000);

  it("a placeholder who PAID for something is not hard-deleted, and the expense survives", async () => {
    const ghost = genId("paying-ghost");
    await ctx.admin.from("users").insert({ id: ghost, name: "Paying Ghost", is_guest: true });
    const expenseId = genId("expense");
    const { error: expErr } = await ctx.admin.from("expenses").insert({
      id: expenseId, trip_id: tripId, title: "Dinner", amount: 200, paid_by_user_id: ghost,
    });
    expect(expErr).toBeNull();

    // The hard-delete path ghostCrew.remove ends in. It swallows the FK
    // violation by design, so it reports nothing — the assertion is on the rows.
    await ctx.admin.rpc("delete_orphan_guest_user", { p_user_id: ghost });

    const { data: stillThere } = await ctx.admin
      .from("users").select("id").eq("id", ghost).maybeSingle();
    expect(stillThere).toBeTruthy();

    const { data: expense } = await ctx.admin
      .from("expenses").select("id, paid_by_user_id").eq("id", expenseId).maybeSingle();
    expect(expense).toBeTruthy();
    expect(expense!.paid_by_user_id).toBe(ghost);

    await ctx.admin.from("expenses").delete().eq("id", expenseId);
    await ctx.admin.from("users").delete().eq("id", ghost);
  });

  it("a placeholder SPLIT INTO someone else's expense is not hard-deleted either", async () => {
    // The direction that changes what OTHER people owe, and the one an owner's
    // mental model misses.
    const payer = ctx.getUser("owner").id;
    const ghost = genId("split-ghost");
    await ctx.admin.from("users").insert({ id: ghost, name: "Split Ghost", is_guest: true });
    const expenseId = genId("expense");
    await ctx.admin.from("expenses").insert({
      id: expenseId, trip_id: tripId, title: "Cart", amount: 100, paid_by_user_id: payer,
    });
    const { error: splitErr } = await ctx.admin.from("expense_splits").insert([
      { expense_id: expenseId, user_id: payer, amount: 50 },
      { expense_id: expenseId, user_id: ghost, amount: 50 },
    ]);
    expect(splitErr).toBeNull();

    await ctx.admin.rpc("delete_orphan_guest_user", { p_user_id: ghost });

    const { data: stillThere } = await ctx.admin
      .from("users").select("id").eq("id", ghost).maybeSingle();
    expect(stillThere).toBeTruthy();

    // Both splits intact — the payer's balance is unchanged by the attempt.
    const { data: splits } = await ctx.admin
      .from("expense_splits").select("user_id").eq("expense_id", expenseId);
    expect(splits).toHaveLength(2);

    await ctx.admin.from("expense_splits").delete().eq("expense_id", expenseId);
    await ctx.admin.from("expenses").delete().eq("id", expenseId);
    await ctx.admin.from("users").delete().eq("id", ghost);
  });

  it("a placeholder with NO history is still hard-deleted — the frictionless case", async () => {
    // RESTRICT must not become a blanket refusal. Most placeholders have
    // nothing attached and must still disappear cleanly.
    const ghost = genId("clean-ghost");
    await ctx.admin.from("users").insert({ id: ghost, name: "Clean Ghost", is_guest: true });

    await ctx.admin.rpc("delete_orphan_guest_user", { p_user_id: ghost });

    const { data: gone } = await ctx.admin
      .from("users").select("id").eq("id", ghost).maybeSingle();
    expect(gone).toBeNull();
  });

  it("account deletion is unaffected — it never reaches this constraint", async () => {
    // Migration 130 converts the users row rather than deleting it, which is
    // what makes RESTRICT safe here. Landing 131 before 130 would have
    // re-created #993, an undeleteable account.
    const email = `${genId("restrict-acct")}@example.com`.toLowerCase();
    const { data: created, error } = await ctx.admin.auth.admin.createUser({
      email, password: "BuddyTripTest2026!", email_confirm: true,
      user_metadata: { name: "Restrict Probe" },
    });
    expect(error).toBeNull();
    const uid = created!.user!.id;

    const expenseId = genId("expense");
    await ctx.admin.from("expenses").insert({
      id: expenseId, trip_id: tripId, title: "Round of drinks", amount: 80, paid_by_user_id: uid,
    });

    const { error: delErr } = await ctx.admin.auth.admin.deleteUser(uid);
    expect(delErr).toBeNull();

    // Placeholder survives, and so does the expense they paid for.
    const { data: row } = await ctx.admin
      .from("users").select("id, name").eq("id", uid).maybeSingle();
    expect(row?.name).toBe("Deleted User");
    const { data: expense } = await ctx.admin
      .from("expenses").select("id").eq("id", expenseId).maybeSingle();
    expect(expense).toBeTruthy();

    await ctx.admin.from("expenses").delete().eq("id", expenseId);
    await ctx.admin.from("users").delete().eq("id", uid);
  });
});
