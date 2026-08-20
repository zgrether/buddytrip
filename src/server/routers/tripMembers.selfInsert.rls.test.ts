import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * Migration 128 — you cannot add yourself to a trip you aren't on.
 *
 * These run through `authedClient` (a real JWT against PostgREST), NOT through
 * tRPC, because the hole was never in tRPC: `tripMembers.add` is Organizer-
 * gated and mints no self rows. The policy was wider than every caller used,
 * and a test that goes through the callers cannot see that — which is how it
 * survived migrations 030, 101 and 122.
 *
 * Provenance: confirmed against production before the fix, by an impersonated
 * insert inside a force-aborted transaction. `test-outsider` (0 memberships)
 * added itself as a Member to a real 15-person trip, then read 69 crew chat
 * messages and 148 score entries and posted into the chat. Nothing was written.
 */

let ctx: TestContext;
let tripId: string;

describe("migration 128 — trip_members self-insert is bootstrap-only", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Self Insert RLS");
    await ctx.addTripMember(tripId, "planner", "Organizer");
    await ctx.addTripMember(tripId, "member", "Member");
  }, 30_000);

  afterAll(async () => {
    await ctx.cleanup();
  }, 30_000);

  // ── The hole ────────────────────────────────────────────────────────────

  it("an outsider CANNOT add themselves to a trip they aren't on", async () => {
    const outsider = ctx.getUser("outsider");
    const { error } = await ctx.authedClient("outsider").from("trip_members").insert({
      id: genId("self-insert"),
      trip_id: tripId,
      user_id: outsider.id,
      role: "Member",
      status: "in",
    });
    expect(error).not.toBeNull();
  });

  it("...and still cannot when they aim higher than Member", async () => {
    // Refused before this migration too (the role guard), pinned so a future
    // change to either layer can't quietly leave the other as the only gate.
    const outsider = ctx.getUser("outsider");
    for (const role of ["Organizer", "Owner"]) {
      const { error } = await ctx.authedClient("outsider").from("trip_members").insert({
        id: genId("self-elevate"),
        trip_id: tripId,
        user_id: outsider.id,
        role,
        status: "in",
      });
      expect(error, `role=${role}`).not.toBeNull();
    }
  });

  it("a REMOVED member cannot re-add themselves", async () => {
    // The sharpest case, because knowing the UUID isn't hypothetical here:
    // anyone ever on the trip has it, and a forwarded invite email carries it
    // too — `sendInvitationBlast` still links to /trips/{uuid} for recipients
    // who already have an account (placeholders now get a /invite?token= link
    // instead, but that narrows the leak, it does not close it). Before this
    // fix, removal from a trip was not enforceable.
    const uid = genId("rejoiner");
    const rejoinTrip = await ctx.createTrip("Rejoin Test");
    await ctx.admin
      .from("trip_members")
      .insert({ trip_id: rejoinTrip, user_id: ctx.getUser("outsider").id, role: "Member", status: "in" });
    await ctx.admin
      .from("trip_members")
      .delete()
      .eq("trip_id", rejoinTrip)
      .eq("user_id", ctx.getUser("outsider").id);

    const { error } = await ctx.authedClient("outsider").from("trip_members").insert({
      id: uid,
      trip_id: rejoinTrip,
      user_id: ctx.getUser("outsider").id,
      role: "Member",
      status: "in",
    });
    expect(error).not.toBeNull();
  });

  it("an outsider cannot read the trip after being refused", async () => {
    // The insert failing is only interesting because of what it would have
    // unlocked. This is the consequence, asserted rather than assumed.
    const { data } = await ctx.authedClient("outsider").from("trips").select("id").eq("id", tripId);
    expect(data ?? []).toHaveLength(0);
  });

  // ── What must keep working ──────────────────────────────────────────────

  it("the bootstrap still works — a creator adds their OWN first Owner row", async () => {
    // `trips.create` inserts the trip, then inserts itself as Owner through the
    // user-scoped client, at which point is_trip_planner() is still false. If
    // this breaks, nobody can create a trip.
    const newTripId = genId("boot-trip");
    await ctx.callerAs("outsider").trips.create({ id: newTripId, title: "Bootstrap Trip" });

    const { data: roster } = await ctx.admin
      .from("trip_members")
      .select("user_id, role")
      .eq("trip_id", newTripId);
    expect(roster).toHaveLength(1);
    expect(roster![0]).toMatchObject({ user_id: ctx.getUser("outsider").id, role: "Owner" });

    await ctx.admin.from("trip_members").delete().eq("trip_id", newTripId);
    await ctx.admin.from("trips").delete().eq("id", newTripId);
  });

  it("...but a second person cannot claim a trip that already has an Owner", async () => {
    const { error } = await ctx.authedClient("outsider").from("trip_members").insert({
      id: genId("claim"),
      trip_id: tripId,
      user_id: ctx.getUser("outsider").id,
      role: "Owner",
      status: "in",
    });
    expect(error).not.toBeNull();
  });

  it("an Organizer can still add someone else (migration 122's capability, intact)", async () => {
    const guestId = genId("addable-guest");
    await ctx.admin.from("users").insert({ id: guestId, name: "Addable", is_guest: true });

    const { error } = await ctx.authedClient("planner").from("trip_members").insert({
      id: genId("org-add"),
      trip_id: tripId,
      user_id: guestId,
      role: "Member",
      status: "in",
    });
    expect(error).toBeNull();

    await ctx.admin.from("trip_members").delete().eq("trip_id", tripId).eq("user_id", guestId);
    await ctx.admin.from("users").delete().eq("id", guestId);
  });

  it("a member can still write their OWN row — travel and status are untouched", async () => {
    // Migration 122 justified the self arm with "join, travel, status,
    // nickname". Only "join" is removed; the rest were always UPDATE, and this
    // pins that the fix didn't overreach into them.
    const { error } = await ctx
      .authedClient("member")
      .from("trip_members")
      .update({ status: "likely" })
      .eq("trip_id", tripId)
      .eq("user_id", ctx.getUser("member").id);
    expect(error).toBeNull();
  });

  it("a member can still leave the trip on their own", async () => {
    const leaveTrip = await ctx.createTrip("Leave Test");
    await ctx.admin
      .from("trip_members")
      .insert({ trip_id: leaveTrip, user_id: ctx.getUser("member").id, role: "Member", status: "in" });

    const { error } = await ctx
      .authedClient("member")
      .from("trip_members")
      .delete()
      .eq("trip_id", leaveTrip)
      .eq("user_id", ctx.getUser("member").id);
    expect(error).toBeNull();
  });
});
