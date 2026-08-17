import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * Migration 123 — an Organizer may not remove another Organizer.
 *
 * #786 widened `tripMembers.remove` to Organizer, which left the roster rules
 * inconsistent in the worst direction: `updateRole` stays Owner-only because
 * "only the Owner changes who is trusted" (PERMISSIONS.md:186), so an Organizer
 * could not DEMOTE a peer — but could DELETE them, reaching the same outcome
 * through the door nobody was watching. 123 closes it one tier below migration
 * 122's Owner-row protection.
 *
 * WRITES GO DIRECTLY AT THE TABLE, as a signed-in Organizer. The threat is a
 * caller who never traverses tRPC — the anon key ships in the browser — so a
 * test that only exercised the procedure would prove nothing about the rule.
 * (The procedure's readable-message half rides with #960, which merges after
 * this; the database is what enforces either way.)
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "BuddyTripTest2026!";

async function signInAs(email: string): Promise<SupabaseClient> {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
  return c;
}

let ctx: TestContext;
let organizer: SupabaseClient;
let owner: SupabaseClient;
let tripId: string;
let ownerId: string, memberId: string, secondOrganizerId: string;

describe("migration 123 — Organizer may remove Members, not peers", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Remove Scoping Trip");
    await ctx.addTripMember(tripId, "planner", "Organizer");
    await ctx.addTripMember(tripId, "member", "Member");
    await ctx.addTripMember(tripId, "outsider", "Organizer"); // the peer
    ownerId = ctx.user.id;
    memberId = ctx.getUser("member").id;
    secondOrganizerId = ctx.getUser("outsider").id;
    organizer = await signInAs(ctx.getUser("planner").email);
    owner = await signInAs(ctx.user.email);
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup();
  }, 60_000);

  it("REFUSES an Organizer removing a fellow Organizer", async () => {
    // The gap #786 opened: demoting a peer was already impossible, deleting
    // them was not.
    const { error } = await organizer
      .from("trip_members").delete()
      .eq("trip_id", tripId).eq("user_id", secondOrganizerId);

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/only the trip owner/i);

    const { data } = await ctx.admin
      .from("trip_members").select("role")
      .eq("trip_id", tripId).eq("user_id", secondOrganizerId).maybeSingle();
    expect(data).toMatchObject({ role: "Organizer" }); // still there
  }, 60_000);

  it("REFUSES an Organizer removing the Owner (migration 122, still holds)", async () => {
    const { error } = await organizer
      .from("trip_members").delete()
      .eq("trip_id", tripId).eq("user_id", ownerId);
    expect(error).not.toBeNull();

    const { data } = await ctx.admin
      .from("trip_members").select("role")
      .eq("trip_id", tripId).eq("user_id", ownerId).maybeSingle();
    expect(data).toMatchObject({ role: "Owner" });
  }, 60_000);

  it("ALLOWS an Organizer removing a Member", async () => {
    const { error } = await organizer
      .from("trip_members").delete()
      .eq("trip_id", tripId).eq("user_id", memberId);
    expect(error).toBeNull();

    const { data } = await ctx.admin
      .from("trip_members").select("user_id")
      .eq("trip_id", tripId).eq("user_id", memberId).maybeSingle();
    expect(data).toBeNull();

    await ctx.admin.from("trip_members")
      .insert({ trip_id: tripId, user_id: memberId, role: "Member", status: "in" });
  }, 60_000);

  it("ALLOWS an Organizer removing a ghost (ghosts are Members)", async () => {
    const ghostId = `ghost-123-${Date.now()}`;
    await ctx.admin.from("users").insert({ id: ghostId, name: "Removable Ghost", is_guest: true });
    await ctx.admin.from("trip_members")
      .insert({ trip_id: tripId, user_id: ghostId, role: "Member", status: "in" });

    const { error } = await organizer
      .from("trip_members").delete()
      .eq("trip_id", tripId).eq("user_id", ghostId);
    expect(error).toBeNull();

    await ctx.admin.from("users").delete().eq("id", ghostId);
  }, 60_000);

  it("ALLOWS the Owner removing an Organizer", async () => {
    const { error } = await owner
      .from("trip_members").delete()
      .eq("trip_id", tripId).eq("user_id", secondOrganizerId);
    expect(error).toBeNull();

    await ctx.admin.from("trip_members")
      .insert({ trip_id: tripId, user_id: secondOrganizerId, role: "Organizer", status: "in" });
  }, 60_000);

  // ── migration 124 — the regression 123 shipped ────────────────────────────
  it("ALLOWS deleting a whole TRIP that has an Organizer on it (cascade)", async () => {
    // 123 broke this in production. Deleting a trip cascades one DELETE per
    // trip_members row; an Organizer row then reached the Owner check, and by
    // that point the OWNER's own row could already be gone from the same
    // cascade — so has_trip_role returned false and the entire delete raised.
    //
    // Neither side's tests covered it: `trips.test.ts`'s delete case has an
    // Owner-only roster, and 123's tests delete MEMBERSHIPS, never a TRIP. The
    // cascade is a writer that was not enumerated. It is now.
    const doomed = `remove-scoping-cascade-${Date.now()}`;
    await ctx.admin.from("trips").insert({ id: doomed, title: "Cascade Trip" });
    await ctx.admin.from("trip_members").insert([
      { trip_id: doomed, user_id: ownerId, role: "Owner", status: "in" },
      { trip_id: doomed, user_id: secondOrganizerId, role: "Organizer", status: "in" },
      { trip_id: doomed, user_id: memberId, role: "Member", status: "in" },
    ]);

    const { error } = await owner.from("trips").delete().eq("id", doomed);
    expect(error).toBeNull();

    const { data: trip } = await ctx.admin
      .from("trips").select("id").eq("id", doomed).maybeSingle();
    const { data: rows } = await ctx.admin
      .from("trip_members").select("user_id").eq("trip_id", doomed);
    expect(trip).toBeNull();
    expect(rows ?? []).toHaveLength(0);
  }, 60_000);

  it("the cascade allowance does NOT weaken the rule on a live trip", async () => {
    // The pass is keyed on the parent trip being gone. A live trip still has
    // its row, so an Organizer acting on one is held to 122/123 exactly as
    // before — asserted here so a future "simplification" of that condition
    // can't quietly turn it into a general bypass.
    const { error } = await organizer
      .from("trip_members").delete()
      .eq("trip_id", tripId).eq("user_id", secondOrganizerId);
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/only the trip owner/i);
  }, 60_000);
});
