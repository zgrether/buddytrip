import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * Migration 122 — the trip_members role-column guard (#824), and the RLS
 * relaxation it enables for #786's six Organizer roster procedures.
 *
 * ── These tests deliberately DO NOT go through tRPC ─────────────────────────
 * The whole threat model is a caller who never traverses the application layer:
 * the anon key ships in the browser, so an Organizer holding a real JWT can hit
 * PostgREST directly and the tRPC guard is simply not in that path. A guard
 * proven only through tRPC would prove nothing about the thing being defended.
 * So each test signs in for real and writes straight at the table, exactly as
 * an attacker would.
 *
 * ── The two regression tests are the ones that matter most ─────────────────
 * `merge_guest_to_real_user` repoints memberships inside the `handle_new_user`
 * signup trigger. If the trigger's role-unchanged early exit is ever hoisted
 * below the auth check, signup breaks for every invited user with a colliding
 * placeholder — and nothing named "signup" would fail. The last two tests here
 * are what would catch that.
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "BuddyTripTest2026!";

/** A real, RLS-scoped client for a shared test user — a browser JWT, in effect. */
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
let ownerId: string, organizerId: string, memberId: string;

describe("migration 122 — role-column guard, enforced at the DATABASE", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Role Guard Trip");
    await ctx.addTripMember(tripId, "planner", "Organizer");
    await ctx.addTripMember(tripId, "member", "Member");
    ownerId = ctx.user.id;
    organizerId = ctx.getUser("planner").id;
    memberId = ctx.getUser("member").id;
    organizer = await signInAs(ctx.getUser("planner").email);
    owner = await signInAs(ctx.user.email);
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup();
  }, 60_000);

  it("REFUSES an Organizer self-elevating to Owner", async () => {
    // The exact attack the Owner-only policy existed to prevent, and the reason
    // the policy could not simply be widened.
    const { error } = await organizer
      .from("trip_members")
      .update({ role: "Owner" })
      .eq("trip_id", tripId)
      .eq("user_id", organizerId);

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/only the trip owner/i);

    const { data } = await ctx.admin
      .from("trip_members").select("role")
      .eq("trip_id", tripId).eq("user_id", organizerId).single();
    expect(data!.role).toBe("Organizer"); // unchanged
  }, 60_000);

  it("REFUSES an Organizer changing ANOTHER member's role", async () => {
    const { error } = await organizer
      .from("trip_members")
      .update({ role: "Organizer" })
      .eq("trip_id", tripId)
      .eq("user_id", memberId);

    expect(error).not.toBeNull();
    const { data } = await ctx.admin
      .from("trip_members").select("role")
      .eq("trip_id", tripId).eq("user_id", memberId).single();
    expect(data!.role).toBe("Member");
  }, 60_000);

  it("REFUSES an Organizer removing the OWNER (would orphan the trip)", async () => {
    // Widening the DELETE policy without this arm would hand an Organizer the
    // ability to strand the trip with no Owner — #957's state, reached from a
    // layer #957's application guard cannot see.
    const { error } = await organizer
      .from("trip_members").delete()
      .eq("trip_id", tripId).eq("user_id", ownerId);

    expect(error).not.toBeNull();
    const { data } = await ctx.admin
      .from("trip_members").select("role")
      .eq("trip_id", tripId).eq("user_id", ownerId).maybeSingle();
    expect(data).toMatchObject({ role: "Owner" });
  }, 60_000);

  it("ALLOWS an Organizer a legitimate non-role update", async () => {
    // The capability this migration exists to grant.
    const { error } = await organizer
      .from("trip_members")
      .update({ nickname: "Nickname By Organizer" })
      .eq("trip_id", tripId)
      .eq("user_id", memberId);

    expect(error).toBeNull();
    const { data } = await ctx.admin
      .from("trip_members").select("nickname, role")
      .eq("trip_id", tripId).eq("user_id", memberId).single();
    expect(data).toMatchObject({ nickname: "Nickname By Organizer", role: "Member" });
  }, 60_000);

  it("ALLOWS the Owner to change a role", async () => {
    const { error } = await owner
      .from("trip_members")
      .update({ role: "Organizer" })
      .eq("trip_id", tripId)
      .eq("user_id", memberId);
    expect(error).toBeNull();

    // put it back
    await ctx.admin.from("trip_members").update({ role: "Member" })
      .eq("trip_id", tripId).eq("user_id", memberId);
  }, 60_000);

  it("ALLOWS an Organizer to add a Member, and REFUSES adding an Organizer", async () => {
    const guestOk = `ghost-122-ok-${Date.now()}`;
    const guestBad = `ghost-122-bad-${Date.now()}`;
    await ctx.admin.from("users").insert([
      { id: guestOk, name: "Addable", is_guest: true },
      { id: guestBad, name: "Not Addable", is_guest: true },
    ]);

    const ok = await organizer.from("trip_members")
      .insert({ trip_id: tripId, user_id: guestOk, role: "Member", status: "in" });
    expect(ok.error).toBeNull();

    // Granting a privileged role is "changing who is trusted" — Owner only.
    const bad = await organizer.from("trip_members")
      .insert({ trip_id: tripId, user_id: guestBad, role: "Organizer", status: "in" });
    expect(bad.error).not.toBeNull();

    await ctx.admin.from("trip_members").delete().eq("trip_id", tripId).in("user_id", [guestOk, guestBad]);
    await ctx.admin.from("users").delete().in("id", [guestOk, guestBad]);
  }, 60_000);
});

describe("migration 122 — the signup path stays inert (the regression cases)", () => {
  it("trips.create still bootstraps its first Owner", async () => {
    // The INSERT-side twin of the signup trap: at this instant the trip has no
    // Owner, so has_trip_role(...,'Owner') is FALSE. Without the bootstrap arm
    // the guard would refuse EVERY trip creation.
    const c = await TestContext.create();
    const id = `test-trip-122-boot-${Date.now()}`;
    const created = await c.caller().trips.create({ id, title: "Bootstrap Trip" });
    expect(created).toBeTruthy();

    const { data } = await c.admin.from("trip_members").select("role")
      .eq("trip_id", id).eq("user_id", c.user.id).single();
    expect(data!.role).toBe("Owner");

    await c.admin.from("trip_members").delete().eq("trip_id", id);
    await c.admin.from("trips").delete().eq("id", id);
    await c.cleanup();
  }, 90_000);

  it("handle_new_user + merge_guest_to_real_user complete for a colliding placeholder", async () => {
    // THE test this migration is most at risk from. A brand-new account signs
    // up whose email matches an existing placeholder; the signup trigger runs
    // the merge, which repoints trip_members rows. The acting identity is the
    // new user — NOT the trip's Owner — so if the role-unchanged early exit
    // were ever moved below the auth check, this signup would fail outright.
    const c = await TestContext.create();
    const trip = await c.createTrip("Merge Path Trip");
    const email = `t122-merge-${Date.now()}@example.test`;

    // A placeholder on the trip, carrying the email the new account will use.
    const ghostId = `ghost-122-merge-${Date.now()}`;
    await c.admin.from("users").insert({ id: ghostId, name: "Colliding Ghost", email, is_guest: true });
    await c.admin.from("trip_members").insert({ trip_id: trip, user_id: ghostId, role: "Member", status: "in" });

    // Sign up for real — fires handle_new_user -> merge_guest_to_real_user.
    const { data, error } = await c.admin.auth.admin.createUser({
      email, password: PASSWORD, email_confirm: true, user_metadata: { name: "Real Account" },
    });
    expect(error).toBeNull(); // <- signup did NOT break
    const realId = data?.user?.id;
    expect(realId).toBeTruthy();

    // The membership was repointed to the real account, role intact.
    const { data: row } = await c.admin.from("trip_members").select("user_id, role")
      .eq("trip_id", trip).eq("user_id", realId).maybeSingle();
    expect(row).toMatchObject({ role: "Member" });

    await c.admin.from("trip_members").delete().eq("trip_id", trip);
    if (realId) await c.admin.auth.admin.deleteUser(realId);
    await c.admin.from("users").delete().eq("id", ghostId);
    await c.cleanup();
  }, 90_000);
});
