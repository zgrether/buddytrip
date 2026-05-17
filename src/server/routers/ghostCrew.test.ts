import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;

// Guest users created during this run — must be cleaned up explicitly because
// the users row outlives the trip_members row (persists for billing history).
const guestUserIds: string[] = [];

// Unique suffix so parallel / re-run tests never collide on the email unique constraint.
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

describe("ghostCrew router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Ghost Crew Test Trip");
    await ctx.addTripMember(tripId, "planner", "Planner");
    await ctx.addTripMember(tripId, "member", "Member");
  });

  afterAll(async () => {
    // Delete guest users rows created in this test run before cleanup()
    // so the unique email constraint doesn't trip future runs.
    if (guestUserIds.length > 0) {
      await ctx.admin.from("users").delete().in("id", guestUserIds).eq("is_guest", true);
    }
    await ctx.cleanup();
  });

  // ── create ────────────────────────────────────────────────────────────────

  it("create — planner can add a guest user by name", async () => {
    const caller = ctx.callerAs("planner");
    const ghost = await caller.ghostCrew.create({
      tripId,
      name: "Andy",
    });
    guestUserIds.push(ghost.id);
    expect(ghost.name).toBe("Andy");
    expect(ghost.email).toBeNull();
    expect(ghost.role).toBe("Member");
    expect(ghost.is_guest).toBe(true);
  });

  it("create — planner can add guest with optional email", async () => {
    const caller = ctx.callerAs("planner");
    const bobEmail = `bob-ghost-${RUN_ID}@example.com`;
    const ghost = await caller.ghostCrew.create({
      tripId,
      name: "Bob",
      email: bobEmail,
    });
    guestUserIds.push(ghost.id);
    expect(ghost.name).toBe("Bob");
    expect(ghost.email).toBe(bobEmail);
    expect(ghost.is_guest).toBe(true);
  });

  it("create — member cannot add guest crew", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.ghostCrew.create({ tripId, name: "Fail" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("create — rejects email that belongs to an existing real account", async () => {
    // 'outsider' has a real BuddyTrip account but is NOT a member of this trip
    const caller = ctx.callerAs("planner");
    const outsider = ctx.getUser("outsider");
    await expect(
      caller.ghostCrew.create({
        tripId,
        name: "Dupe",
        email: outsider.email,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  // ── tripMembers.list returns guest members alongside real ones ───────────
  // (kept for coverage — the dead ghostCrew.list procedure was removed in
  //  pre-launch cleanup; tripMembers.list with isGuest filter is the
  //  canonical way to read guest crew now.)

  it("tripMembers.list — returns guest members alongside real members", async () => {
    const caller = ctx.callerAs("member");
    const members = await caller.tripMembers.list({ tripId });
    const realMembers = members.filter((m) => !m.isGuest);
    const guests = members.filter((m) => m.isGuest);
    expect(realMembers.length).toBeGreaterThanOrEqual(1);
    expect(guests.length).toBeGreaterThanOrEqual(1);
    // All members have a memberId and user_id
    members.forEach((m) => expect(m.memberId).toBeTruthy());
    members.forEach((m) => expect(m.user_id).toBeTruthy());
    // All members have a displayName
    members.forEach((m) => expect(m.displayName).toBeTruthy());
    // Guests have a users row with is_guest=true
    guests.forEach((m) => {
      expect(m.isGuest).toBe(true);
      expect(m.user).toBeTruthy();
      expect(m.user?.is_guest).toBe(true);
      expect(m.user_id).toBeTruthy();
    });
  });

  // ── update ────────────────────────────────────────────────────────────────

  it("update — planner can edit guest name", async () => {
    const plannerCaller = ctx.callerAs("planner");
    const members = await plannerCaller.tripMembers.list({ tripId });
    const ghosts = members.filter((m) => m.isGuest).map((m) => ({ id: m.user_id! }));
    const ghost = ghosts[0];
    const updated = await plannerCaller.ghostCrew.update({
      tripId,
      guestUserId: ghost.id,
      name: "Andrew",
    });
    expect(updated.name).toBe("Andrew");
  });

  it("update — planner can add email to guest", async () => {
    const plannerCaller = ctx.callerAs("planner");
    const members = await plannerCaller.tripMembers.list({ tripId });
    const ghosts = members.filter((m) => m.isGuest).map((m) => ({ id: m.user_id! }));
    const ghost = ghosts[0];
    const andrewEmail = `andrew-ghost-${RUN_ID}@example.com`;
    const updated = await plannerCaller.ghostCrew.update({
      tripId,
      guestUserId: ghost.id,
      email: andrewEmail,
    });
    expect(updated.email).toBe(andrewEmail);
  });

  it("update — member cannot edit guest", async () => {
    const memberCaller = ctx.callerAs("member");
    const members = await ctx.callerAs("planner").tripMembers.list({ tripId });
    const ghosts = members.filter((m) => m.isGuest).map((m) => ({ id: m.user_id! }));
    await expect(
      memberCaller.ghostCrew.update({
        tripId,
        guestUserId: ghosts[0].id,
        name: "Hack",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("update — auto-links to existing real BT account when email matches", async () => {
    // Create a fresh ghost on this trip
    const planner = ctx.callerAs("planner");
    const ghost = await planner.ghostCrew.create({ tripId, name: "LinkMe" });
    guestUserIds.push(ghost.id);

    // 'outsider' has a real BT account but isn't a member of this trip
    const outsider = ctx.getUser("outsider");

    const result = await planner.ghostCrew.update({
      tripId,
      guestUserId: ghost.id,
      email: outsider.email,
    });

    expect(result.linked).toBe(true);
    expect(result.id).toBe(outsider.id);
    expect(result.is_guest).toBe(false);

    // trip_members should now point at the real user, not the ghost
    const members = await planner.tripMembers.list({ tripId });
    expect(members.find((m) => m.user_id === outsider.id)).toBeTruthy();
    expect(members.find((m) => m.user_id === ghost.id)).toBeFalsy();
  });

  it("update — refuses link when real account is already a trip member", async () => {
    // Create another ghost
    const planner = ctx.callerAs("planner");
    const ghost = await planner.ghostCrew.create({ tripId, name: "DupLink" });
    guestUserIds.push(ghost.id);

    // 'member' is already a real member of this trip
    const member = ctx.getUser("member");
    await expect(
      planner.ghostCrew.update({
        tripId,
        guestUserId: ghost.id,
        email: member.email,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("update — non-matching email falls through to plain ghost update", async () => {
    const planner = ctx.callerAs("planner");
    const ghost = await planner.ghostCrew.create({ tripId, name: "Plain" });
    guestUserIds.push(ghost.id);

    const newEmail = `plain-${RUN_ID}@example.com`;
    const result = await planner.ghostCrew.update({
      tripId,
      guestUserId: ghost.id,
      email: newEmail,
    });

    expect(result.linked).toBe(false);
    expect(result.email).toBe(newEmail);
    expect(result.is_guest).toBe(true);
  });

  // ── remove ────────────────────────────────────────────────────────────────

  it("remove — owner can remove a guest from the trip", async () => {
    // Create one specifically to remove
    const plannerCaller = ctx.callerAs("planner");
    const ghost = await plannerCaller.ghostCrew.create({
      tripId,
      name: "TempGuest",
    });
    guestUserIds.push(ghost.id);

    const ownerCaller = ctx.caller();
    const result = await ownerCaller.ghostCrew.remove({
      tripId,
      guestUserId: ghost.id,
    });
    expect(result.success).toBe(true);

    // Verify gone from trip member list
    const members = await plannerCaller.tripMembers.list({ tripId });
    const ghosts = members.filter((m) => m.isGuest).map((m) => ({ id: m.user_id! }));
    expect(ghosts.find((g) => g.id === ghost.id)).toBeUndefined();
  });

  it("remove — planner cannot remove guest (Owner only)", async () => {
    const plannerCaller = ctx.callerAs("planner");
    const members = await plannerCaller.tripMembers.list({ tripId });
    const ghosts = members.filter((m) => m.isGuest).map((m) => ({ id: m.user_id! }));
    await expect(
      plannerCaller.ghostCrew.remove({ tripId, guestUserId: ghosts[0].id })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
