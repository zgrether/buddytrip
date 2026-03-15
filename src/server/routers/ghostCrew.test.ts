import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;

describe("ghostCrew router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Ghost Crew Test Trip");
    await ctx.addTripMember(tripId, "planner", "Planner");
    await ctx.addTripMember(tripId, "member", "Member");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // ── create ────────────────────────────────────────────────────────────────

  it("create — planner can add a guest user by name", async () => {
    const caller = ctx.callerAs("planner");
    const ghost = await caller.ghostCrew.create({
      tripId,
      name: "Andy",
    });
    expect(ghost.name).toBe("Andy");
    expect(ghost.email).toBeNull();
    expect(ghost.role).toBe("Member");
    expect(ghost.is_guest).toBe(true);
  });

  it("create — planner can add guest with optional email", async () => {
    const caller = ctx.callerAs("planner");
    const ghost = await caller.ghostCrew.create({
      tripId,
      name: "Bob",
      email: "bob-ghost-test@example.com",
    });
    expect(ghost.name).toBe("Bob");
    expect(ghost.email).toBe("bob-ghost-test@example.com");
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

  // ── list ──────────────────────────────────────────────────────────────────

  it("list — any member can view guest users", async () => {
    const caller = ctx.callerAs("member");
    const ghosts = await caller.ghostCrew.list({ tripId });
    expect(ghosts.length).toBeGreaterThanOrEqual(1);
    expect(ghosts[0].name).toBeTruthy();
    expect(ghosts[0].is_guest).toBe(true);
  });

  it("list — tripMembers.list returns guest members alongside real members", async () => {
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
    const ghosts = await plannerCaller.ghostCrew.list({ tripId });
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
    const ghosts = await plannerCaller.ghostCrew.list({ tripId });
    const ghost = ghosts[0];
    const updated = await plannerCaller.ghostCrew.update({
      tripId,
      guestUserId: ghost.id,
      email: "andrew-ghost@example.com",
    });
    expect(updated.email).toBe("andrew-ghost@example.com");
  });

  it("update — member cannot edit guest", async () => {
    const memberCaller = ctx.callerAs("member");
    const ghosts = await ctx.callerAs("planner").ghostCrew.list({ tripId });
    await expect(
      memberCaller.ghostCrew.update({
        tripId,
        guestUserId: ghosts[0].id,
        name: "Hack",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ── remove ────────────────────────────────────────────────────────────────

  it("remove — owner can remove a guest from the trip", async () => {
    // Create one specifically to remove
    const plannerCaller = ctx.callerAs("planner");
    const ghost = await plannerCaller.ghostCrew.create({
      tripId,
      name: "TempGuest",
    });

    const ownerCaller = ctx.caller();
    const result = await ownerCaller.ghostCrew.remove({
      tripId,
      guestUserId: ghost.id,
    });
    expect(result.success).toBe(true);

    // Verify gone from trip member list
    const ghosts = await plannerCaller.ghostCrew.list({ tripId });
    expect(ghosts.find((g) => g.id === ghost.id)).toBeUndefined();
  });

  it("remove — planner cannot remove guest (Owner only)", async () => {
    const plannerCaller = ctx.callerAs("planner");
    const ghosts = await plannerCaller.ghostCrew.list({ tripId });
    await expect(
      plannerCaller.ghostCrew.remove({ tripId, guestUserId: ghosts[0].id })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
