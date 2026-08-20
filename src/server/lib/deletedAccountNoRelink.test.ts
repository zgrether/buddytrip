import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * Migration 132 — a deleted account is never reattached to its old address.
 *
 * After migration 130 a deleted account IS a placeholder in every structural
 * sense: `is_guest = true`, name-only, holding its history. That is what keeps
 * the roster and the scorecard working, and it is also why `deleted_at` has to
 * exist — nothing else distinguishes "placeholder that was never an account"
 * from "placeholder that was one", and the two must link differently.
 *
 * Both routes to a merge are covered, and they behave DIFFERENTLY on purpose:
 *   signup      -> silently gets a NEW account (the person did nothing wrong)
 *   owner link  -> refused loudly (a deliberate act deserves an answer)
 */

let ctx: TestContext;
let tripId: string;

async function seed(table: string, rows: Record<string, unknown> | Record<string, unknown>[]) {
  const { error } = await ctx.admin.from(table).insert(rows as never);
  if (error) throw new Error(`fixture insert into ${table} failed: ${error.message}`);
}

describe("migration 132 — a deleted account cannot be resurrected by its address", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Deleted Relink Trip");
  }, 30_000);

  afterAll(async () => {
    await ctx.cleanup();
  }, 30_000);

  it("deleting an account stamps deleted_at", async () => {
    const email = `${genId("stamp")}@example.com`.toLowerCase();
    const { data: created } = await ctx.admin.auth.admin.createUser({
      email, password: "BuddyTripTest2026!", email_confirm: true,
      user_metadata: { name: "Stamp Probe" },
    });
    const uid = created!.user!.id;

    await ctx.admin.auth.admin.deleteUser(uid);

    const { data: row } = await ctx.admin
      .from("users").select("deleted_at, is_guest, email").eq("id", uid).maybeSingle();
    expect(row!.deleted_at).not.toBeNull();
    // Still a placeholder in every other respect — that is the point of 130.
    expect(row!.is_guest).toBe(true);
    expect(row!.email).toBeNull();

    await ctx.admin.from("users").delete().eq("id", uid);
  });

  it("SIGNUP with the old address gets a NEW account, not the old history", async () => {
    // The route that stays open even with the email nulled, because an owner
    // can put an address back onto the placeholder.
    const email = `${genId("resurrect")}@example.com`.toLowerCase();
    const { data: created } = await ctx.admin.auth.admin.createUser({
      email, password: "BuddyTripTest2026!", email_confirm: true,
      user_metadata: { name: "Original Person" },
    });
    const oldId = created!.user!.id;
    await ctx.admin.auth.admin.deleteUser(oldId);

    // An owner types the address back onto the placeholder.
    await ctx.admin.from("users").update({ email }).eq("id", oldId);

    // Same address signs up again.
    const { data: reborn, error } = await ctx.admin.auth.admin.createUser({
      email: `${genId("newcomer")}@example.com`.toLowerCase(),
      password: "BuddyTripTest2026!", email_confirm: true,
      user_metadata: { name: "Newcomer" },
    });
    expect(error).toBeNull();
    const newId = reborn!.user!.id;

    // Distinct rows: the deleted placeholder was NOT merged away.
    expect(newId).not.toBe(oldId);
    const { data: oldRow } = await ctx.admin
      .from("users").select("id, deleted_at").eq("id", oldId).maybeSingle();
    expect(oldRow).toBeTruthy();
    expect(oldRow!.deleted_at).not.toBeNull();

    await ctx.admin.auth.admin.deleteUser(newId);
    await ctx.admin.from("users").delete().in("id", [oldId, newId]);
  });

  it("the ORDINARY guest→real conversion still works — 132 must not break signup", async () => {
    // The half that must keep working. A placeholder that was never an account
    // still merges into a new signup with a matching address, which is how most
    // of this app's people become real users.
    const email = `${genId("ordinary")}@example.com`.toLowerCase();
    const ghost = genId("ordinary-ghost");
    await seed("users", { id: ghost, name: "Ordinary Ghost", email, is_guest: true });
    await seed("trip_members", { trip_id: tripId, user_id: ghost, role: "Member", status: "in" });

    const { data: created, error } = await ctx.admin.auth.admin.createUser({
      email, password: "BuddyTripTest2026!", email_confirm: true,
      user_metadata: { name: "Real Person" },
    });
    expect(error).toBeNull();
    const realId = created!.user!.id;

    // The merge ran: the ghost is gone and its membership moved.
    const { data: ghostRow } = await ctx.admin
      .from("users").select("id").eq("id", ghost).maybeSingle();
    expect(ghostRow).toBeNull();
    const { data: membership } = await ctx.admin
      .from("trip_members").select("user_id").eq("trip_id", tripId).eq("user_id", realId).maybeSingle();
    expect(membership).toBeTruthy();

    await ctx.admin.from("trip_members").delete().eq("user_id", realId);
    await ctx.admin.auth.admin.deleteUser(realId);
    await ctx.admin.from("users").delete().eq("id", realId);
  });

  it("link_guest_to_account REFUSES a deleted placeholder, and still allows an ordinary one", async () => {
    const owner = ctx.getUser("owner").id;
    const target = ctx.getUser("outsider").id;

    const dead = genId("dead-ghost");
    const live = genId("live-ghost");
    await seed("users", [
      { id: dead, name: "Deleted User", is_guest: true, deleted_at: new Date().toISOString() },
      { id: live, name: "Ordinary Ghost", is_guest: true },
    ]);
    await seed("trip_members", [
      { trip_id: tripId, user_id: dead, role: "Member", status: "in" },
      { trip_id: tripId, user_id: live, role: "Member", status: "in" },
    ]);
    expect(owner).toBeTruthy();

    // Deleted → refused. This is the DB guard, reached directly, so a caller
    // that skips the router still cannot resurrect anyone.
    const refused = await ctx.authedClient("owner").rpc("link_guest_to_account", {
      p_trip_id: tripId, p_ghost_id: dead, p_real_id: target,
    });
    expect(refused.error).not.toBeNull();
    const { data: stillDead } = await ctx.admin
      .from("users").select("id").eq("id", dead).maybeSingle();
    expect(stillDead).toBeTruthy();

    // Ordinary → still links, so the guard is not a blanket refusal.
    const allowed = await ctx.authedClient("owner").rpc("link_guest_to_account", {
      p_trip_id: tripId, p_ghost_id: live, p_real_id: target,
    });
    expect(allowed.error).toBeNull();
    const { data: goneLive } = await ctx.admin
      .from("users").select("id").eq("id", live).maybeSingle();
    expect(goneLive).toBeNull();

    await ctx.admin.from("trip_members").delete().eq("trip_id", tripId).in("user_id", [dead, target]);
    await ctx.admin.from("users").delete().eq("id", dead);
  });
});
