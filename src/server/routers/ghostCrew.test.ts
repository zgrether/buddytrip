import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

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

  it("create — planner can add a ghost crew member by name", async () => {
    const caller = ctx.callerAs("planner");
    const ghost = await caller.ghostCrew.create({
      tripId,
      id: genId("ghost"),
      name: "Andy",
    });
    expect(ghost.name).toBe("Andy");
    expect(ghost.email).toBeNull();
    expect(ghost.role).toBe("Member");
  });

  it("create — planner can add ghost with optional email", async () => {
    const caller = ctx.callerAs("planner");
    const ghost = await caller.ghostCrew.create({
      tripId,
      id: genId("ghost"),
      name: "Bob",
      email: "bob-ghost-test@example.com",
    });
    expect(ghost.name).toBe("Bob");
    expect(ghost.email).toBe("bob-ghost-test@example.com");
  });

  it("create — member cannot add ghost crew", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.ghostCrew.create({ tripId, id: genId("ghost"), name: "Fail" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("create — rejects email that belongs to an existing account", async () => {
    // The test 'owner' user already has a real account
    const caller = ctx.callerAs("planner");
    const ownerUser = ctx.user; // owner's real account
    await expect(
      caller.ghostCrew.create({
        tripId,
        id: genId("ghost"),
        name: "Dupe",
        email: ownerUser.email,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  // ── list ──────────────────────────────────────────────────────────────────

  it("list — any member can view ghost crew", async () => {
    const caller = ctx.callerAs("member");
    const ghosts = await caller.ghostCrew.list({ tripId });
    expect(ghosts.length).toBeGreaterThanOrEqual(1);
    expect(ghosts[0].name).toBeTruthy();
  });

  it("list — tripMembers.list returns ghost members alongside real members", async () => {
    const caller = ctx.callerAs("member");
    const members = await caller.tripMembers.list({ tripId });
    const realMembers = members.filter((m) => !m.isGuest);
    const ghosts = members.filter((m) => m.isGuest);
    expect(realMembers.length).toBeGreaterThanOrEqual(1);
    expect(ghosts.length).toBeGreaterThanOrEqual(1);
    // All members have a memberId
    members.forEach((m) => expect(m.memberId).toBeTruthy());
    // All members have a displayName
    members.forEach((m) => expect(m.displayName).toBeTruthy());
    // Ghosts have guestCrew, no user
    ghosts.forEach((m) => {
      expect(m.isGuest).toBe(true);
      expect(m.guestCrew).toBeTruthy();
      expect(m.user).toBeNull();
      expect(m.user_id).toBeNull();
    });
  });

  // ── update ────────────────────────────────────────────────────────────────

  it("update — planner can edit ghost name", async () => {
    const caller = ctx.callerAs("planner");
    const ghosts = await caller.ghostCrew.list({ tripId });
    const ghost = ghosts[0];
    const updated = await caller.ghostCrew.update({
      tripId,
      guestCrewId: ghost.id,
      name: "Andrew",
    });
    expect(updated.name).toBe("Andrew");
  });

  it("update — planner can add email to ghost", async () => {
    const caller = ctx.callerAs("planner");
    const ghosts = await caller.ghostCrew.list({ tripId });
    const ghost = ghosts[0];
    const updated = await caller.ghostCrew.update({
      tripId,
      guestCrewId: ghost.id,
      email: "andrew-ghost@example.com",
    });
    expect(updated.email).toBe("andrew-ghost@example.com");
  });

  it("update — member cannot edit ghost", async () => {
    const caller = ctx.callerAs("member");
    const ghosts = await ctx.callerAs("planner").ghostCrew.list({ tripId });
    await expect(
      caller.ghostCrew.update({
        tripId,
        guestCrewId: ghosts[0].id,
        name: "Hack",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ── remove ────────────────────────────────────────────────────────────────

  it("remove — owner can delete a ghost crew member", async () => {
    // Create one specifically to delete
    const plannerCaller = ctx.callerAs("planner");
    const ghost = await plannerCaller.ghostCrew.create({
      tripId,
      id: genId("ghost"),
      name: "TempGuest",
    });

    const ownerCaller = ctx.caller();
    const result = await ownerCaller.ghostCrew.remove({
      tripId,
      guestCrewId: ghost.id,
    });
    expect(result.success).toBe(true);

    // Verify gone from list
    const ghosts = await plannerCaller.ghostCrew.list({ tripId });
    expect(ghosts.find((g) => g.id === ghost.id)).toBeUndefined();
  });

  it("remove — planner cannot delete ghost crew (Owner only)", async () => {
    const plannerCaller = ctx.callerAs("planner");
    const ghosts = await plannerCaller.ghostCrew.list({ tripId });
    await expect(
      plannerCaller.ghostCrew.remove({ tripId, guestCrewId: ghosts[0].id })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
