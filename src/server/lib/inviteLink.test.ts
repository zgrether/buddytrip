import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";
import { resolveInviteLink, viewerCanSeeTrip } from "./inviteLink";

vi.mock("@/lib/email", () => ({
  sendInvitationBlast: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
  sendInviteExistingUser: vi.fn().mockResolvedValue({}),
  sendInviteNewUser: vi.fn().mockResolvedValue({}),
}));

/**
 * The DB half of invite deep-linking. `resolveAccessRoute` decides the branch
 * from four facts; this is the module that produces them, and each of its
 * answers picks a different screen — so getting `hasAccount` wrong lands a new
 * person on "Welcome back" (#980) and getting `viewerCanSeeTrip` wrong turns
 * branch 1 into a dead end.
 *
 * Runs against the ephemeral local Supabase the suite boots (#636). Seeds
 * sequentially, never Promise.all.
 */

let ctx: TestContext;
let tripId: string;

describe("inviteLink — resolveInviteLink", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Deep Link Test Trip");
  }, 30_000);

  afterAll(async () => {
    await ctx.admin.from("invites").delete().eq("trip_id", tripId);
    await ctx.cleanup();
  }, 30_000);

  async function seedInvite(email: string): Promise<string> {
    const { data, error } = await ctx.admin
      .from("invites")
      .insert({ trip_id: tripId, email, role: "Member", created_by: ctx.user.id })
      .select("token")
      .single();
    if (error || !data) throw new Error(`seed invite failed: ${error?.message}`);
    return data.token as string;
  }

  it("resolves a token to the trip, the inviter and the invited address", async () => {
    const email = `${genId("invitee")}@example.com`.toLowerCase();
    const token = await seedInvite(email);

    const resolved = await resolveInviteLink(token);

    expect(resolved).toBeTruthy();
    expect(resolved!.tripId).toBe(tripId);
    expect(resolved!.target.path).toBe(`/trips/${tripId}`);
    expect(resolved!.target.resourceName).toBe("Deep Link Test Trip");
    expect(resolved!.addressee.email).toBe(email);
    // The inviter's display name — what the auth page puts in "X added you to Y".
    expect(typeof resolved!.inviterName === "string" || resolved!.inviterName === null).toBe(true);
  });

  it("hasAccount is FALSE for a guest placeholder — the sign-UP branch (#980)", async () => {
    const email = `${genId("ghost")}@example.com`.toLowerCase();
    const guestId = genId("guest-user");
    await ctx.admin
      .from("users")
      .insert({ id: guestId, name: "Ghost", email, is_guest: true, created_by: ctx.user.id });
    const token = await seedInvite(email);

    const resolved = await resolveInviteLink(token);
    expect(resolved!.addressee.hasAccount).toBe(false);

    await ctx.admin.from("users").delete().eq("id", guestId);
  });

  it("hasAccount is TRUE for a real account — the sign-IN branch", async () => {
    const outsider = ctx.getUser("outsider");
    const token = await seedInvite(outsider.email.toLowerCase());

    const resolved = await resolveInviteLink(token);
    expect(resolved!.addressee.hasAccount).toBe(true);
  });

  it("resolves an EXPIRED token — there is no offer to expire (see the module header)", async () => {
    const email = `${genId("stale")}@example.com`.toLowerCase();
    const token = await seedInvite(email);
    await ctx.admin
      .from("invites")
      .update({ expires_at: new Date(Date.now() - 86_400_000).toISOString() })
      .eq("token", token);

    // The person is already on the roster; refusing here would strand them with
    // no self-serve recovery while disclosing nothing a fresh token wouldn't.
    expect(await resolveInviteLink(token)).toBeTruthy();
  });

  it("resolves a token that has already been used — the link is a notification, not a ticket", async () => {
    const email = `${genId("repeat")}@example.com`.toLowerCase();
    const token = await seedInvite(email);
    await ctx.admin
      .from("invites")
      .update({ accepted_at: new Date().toISOString() })
      .eq("token", token);

    expect(await resolveInviteLink(token)).toBeTruthy();
  });

  it("returns null for anything that isn't a live token", async () => {
    expect(await resolveInviteLink(null)).toBeNull();
    expect(await resolveInviteLink(undefined)).toBeNull();
    expect(await resolveInviteLink("")).toBeNull();
    expect(await resolveInviteLink("   ")).toBeNull();
    expect(await resolveInviteLink("not-a-real-token")).toBeNull();
    expect(await resolveInviteLink("x".repeat(500))).toBeNull();
  });

  it("resolves the token the invite EMAIL actually carries (producer → consumer)", async () => {
    // Pins the contract end to end: whatever `inviteByEmail` mints and mails is
    // what the landing page has to be able to read back. A change to either side
    // that breaks the other fails here rather than in someone's inbox.
    const email = `${genId("e2e-invitee")}@example.com`.toLowerCase();
    await ctx.caller().tripMembers.inviteByEmail({ tripId, email, role: "Member" });

    const { data: row } = await ctx.admin
      .from("invites")
      .select("token")
      .eq("trip_id", tripId)
      .eq("email", email)
      .single();

    const resolved = await resolveInviteLink(row!.token as string);
    expect(resolved!.tripId).toBe(tripId);
    expect(resolved!.addressee.email).toBe(email);
    // inviteByEmail's Path B mints a guest placeholder, so this is sign-UP.
    expect(resolved!.addressee.hasAccount).toBe(false);
  });
});

describe("inviteLink — viewerCanSeeTrip", () => {
  let seenTripId: string;

  beforeAll(async () => {
    ctx = await TestContext.create();
    seenTripId = await ctx.createTrip("Visibility Test Trip");
    await ctx.addTripMember(seenTripId, "member", "Member");
  }, 30_000);

  afterAll(async () => {
    await ctx.cleanup();
  }, 30_000);

  it("true for a member of the trip", async () => {
    expect(await viewerCanSeeTrip(ctx.getUser("member").id, seenTripId)).toBe(true);
  });

  it("true for a roster row still sitting at status 'invited' — this is what makes branch 1 work", async () => {
    // Someone invited but never opened the app has status 'invited', and
    // `is_trip_member` (the RLS helper) does not filter on status. If this ever
    // became status-sensitive, an invited person clicking their link while
    // signed in would be told they aren't on the trip.
    const uid = genId("invited-member");
    await ctx.admin.from("users").insert({ id: uid, name: "Invited", is_guest: true });
    await ctx.admin
      .from("trip_members")
      .insert({ trip_id: seenTripId, user_id: uid, role: "Member", status: "invited" });

    expect(await viewerCanSeeTrip(uid, seenTripId)).toBe(true);

    await ctx.admin.from("trip_members").delete().eq("trip_id", seenTripId).eq("user_id", uid);
    await ctx.admin.from("users").delete().eq("id", uid);
  });

  it("false for someone who is not on the trip", async () => {
    expect(await viewerCanSeeTrip(ctx.getUser("outsider").id, seenTripId)).toBe(false);
  });
});
