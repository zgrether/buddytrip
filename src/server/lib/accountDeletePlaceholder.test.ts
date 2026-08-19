import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * Migration 130 — deleting an account converts it to a placeholder.
 *
 * Drives the REAL path: `auth.admin.createUser` (fires `handle_new_user`) then
 * `auth.admin.deleteUser` (fires `handle_user_delete`). Nothing is simulated —
 * the trigger is the thing under test, and a test that reproduced its body
 * would pass while the trigger did something else.
 *
 * The measurements this design came from, taken on the live database BEFORE
 * the change: deleting ONE account removed 2 expenses and the 14 splits owed
 * by 14 OTHER people, and left 2 score rows and 1 match side pointing at a
 * `users` row that no longer existed.
 */

let ctx: TestContext;

/** Create a real auth-backed account; returns its id. */
async function createAccount(label: string): Promise<{ id: string; email: string }> {
  const email = `${genId(label)}@example.com`.toLowerCase();
  const { data, error } = await ctx.admin.auth.admin.createUser({
    email,
    password: "BuddyTripTest2026!",
    email_confirm: true,
    user_metadata: { name: "Doomed Account" },
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  return { id: data.user.id, email };
}

describe("account deletion → placeholder (migration 130)", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
  }, 30_000);

  afterAll(async () => {
    await ctx.cleanup();
  }, 30_000);

  it("keeps the users row as a placeholder, with the email nulled", async () => {
    const acct = await createAccount("deleted-acct");

    const { error } = await ctx.admin.auth.admin.deleteUser(acct.id);
    expect(error).toBeNull();

    const { data: row } = await ctx.admin
      .from("users")
      .select("id, name, email, avatar_url, is_guest")
      .eq("id", acct.id)
      .maybeSingle();

    // NOT deleted — this is what keeps every shared record resolving.
    expect(row).toBeTruthy();
    expect(row!.name).toBe("Deleted User");
    expect(row!.is_guest).toBe(true);
    // Required, not hygiene: a placeholder that kept its address would be
    // auto-linked into the next signup that used it (handle_new_user matches
    // on `email = NEW.email AND is_guest = true`).
    expect(row!.email).toBeNull();
    expect(row!.avatar_url).toBeNull();

    await ctx.admin.from("users").delete().eq("id", acct.id);
  });

  it("a deleted account can no longer be resurrected by signing up with its old address", async () => {
    const acct = await createAccount("resurrect");
    await ctx.admin.auth.admin.deleteUser(acct.id);

    // Same address signs up fresh. It must become a NEW, separate account —
    // not an auto-link back into the deleted person's history.
    const { data: reborn, error } = await ctx.admin.auth.admin.createUser({
      email: acct.email,
      password: "BuddyTripTest2026!",
      email_confirm: true,
      user_metadata: { name: "Someone Else" },
    });
    expect(error).toBeNull();
    expect(reborn!.user!.id).not.toBe(acct.id);

    const { data: oldRow } = await ctx.admin
      .from("users")
      .select("id, name")
      .eq("id", acct.id)
      .maybeSingle();
    expect(oldRow?.name).toBe("Deleted User");

    await ctx.admin.auth.admin.deleteUser(reborn!.user!.id);
    await ctx.admin.from("users").delete().in("id", [acct.id, reborn!.user!.id]);
  });

  it("does NOT delete other people's money — the finding that drove this", async () => {
    const tripId = await ctx.createTrip("Delete Money Test");
    const payer = await createAccount("payer");
    const owerId = genId("ower");
    await ctx.admin.from("users").insert({ id: owerId, name: "Ower", is_guest: true });

    const expenseId = genId("expense");
    await ctx.admin.from("expenses").insert({
      id: expenseId,
      trip_id: tripId,
      title: "Dinner",
      amount: 400,
      paid_by_user_id: payer.id,
    });
    await ctx.admin.from("expense_splits").insert([
      { expense_id: expenseId, user_id: payer.id, amount: 200 },
      { expense_id: expenseId, user_id: owerId, amount: 200 },
    ]);

    await ctx.admin.auth.admin.deleteUser(payer.id);

    // The expense and BOTH splits survive. Before migration 130 the expense
    // CASCADEd away and took the other person's debt with it.
    const { data: expense } = await ctx.admin
      .from("expenses")
      .select("id, amount, paid_by_user_id")
      .eq("id", expenseId)
      .maybeSingle();
    expect(expense).toBeTruthy();
    expect(expense!.paid_by_user_id).toBe(payer.id);

    const { data: splits } = await ctx.admin
      .from("expense_splits")
      .select("user_id, amount")
      .eq("expense_id", expenseId);
    expect(splits).toHaveLength(2);
    expect(splits!.map((s) => s.user_id).sort()).toEqual([owerId, payer.id].sort());

    await ctx.admin.from("expense_splits").delete().eq("expense_id", expenseId);
    await ctx.admin.from("expenses").delete().eq("id", expenseId);
    await ctx.admin.from("users").delete().in("id", [payer.id, owerId]);
  });

  it("shared game records keep resolving — scores stay, and their player still exists", async () => {
    const tripId = await ctx.createTrip("Delete Scores Test");
    const player = await createAccount("player");

    const { data: game } = await ctx.admin
      .from("games")
      .insert({ id: genId("game"), trip_id: tripId })
      .select("id")
      .single();

    const entryId = genId("entry");
    await ctx.admin.from("score_entries").insert({
      id: entryId,
      game_id: game!.id,
      participant_id: player.id,
      participant_type: "user",
      unit_label: "1",
      value: 4,
      submitted_by: player.id,
    });

    await ctx.admin.auth.admin.deleteUser(player.id);

    const { data: score } = await ctx.admin
      .from("score_entries")
      .select("id, value, participant_id")
      .eq("id", entryId)
      .maybeSingle();
    expect(score).toBeTruthy();
    expect(score!.value).toBe(4);

    // The whole point: participant_id has NO foreign key, so before this change
    // it pointed at a row that no longer existed. It must still resolve.
    const { data: stillThere } = await ctx.admin
      .from("users")
      .select("id")
      .eq("id", score!.participant_id)
      .maybeSingle();
    expect(stillThere).toBeTruthy();

    await ctx.admin.from("score_entries").delete().eq("id", entryId);
    await ctx.admin.from("games").delete().eq("id", game!.id);
    await ctx.admin.from("users").delete().eq("id", player.id);
  });

  it("clears rows that are about the person alone", async () => {
    const acct = await createAccount("personal-rows");
    const tripId = await ctx.createTrip("Personal Rows Test");
    await ctx.admin
      .from("trip_members")
      .insert({ trip_id: tripId, user_id: acct.id, role: "Member", status: "in" });
    await ctx.admin
      .from("chat_reads")
      .insert({ trip_id: tripId, user_id: acct.id, visibility: "crew", last_read_at: new Date().toISOString() });

    await ctx.admin.auth.admin.deleteUser(acct.id);

    const { data: reads } = await ctx.admin
      .from("chat_reads")
      .select("user_id")
      .eq("user_id", acct.id);
    expect(reads ?? []).toHaveLength(0);

    // ...but the roster row stays: a deleted member still belongs on last
    // year's roster. Removing them from an UPCOMING trip is the owner's call,
    // not something deletion decides.
    const { data: roster } = await ctx.admin
      .from("trip_members")
      .select("user_id, nickname")
      .eq("user_id", acct.id)
      .maybeSingle();
    expect(roster).toBeTruthy();
    expect(roster!.nickname).toBeNull();

    await ctx.admin.from("trip_members").delete().eq("user_id", acct.id);
    await ctx.admin.from("users").delete().eq("id", acct.id);
  });
});
