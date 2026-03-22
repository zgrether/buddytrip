import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;

describe("tripMembers router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Members Test Trip");
    await ctx.addTripMember(tripId, "planner", "Planner");
    await ctx.addTripMember(tripId, "member", "Member");
  }, 30_000);

  afterAll(async () => {
    await ctx.cleanup();
  }, 30_000);

  // list
  it("list — any member can view crew roster", async () => {
    const caller = ctx.callerAs("member");
    const members = await caller.tripMembers.list({ tripId });
    expect(members.length).toBe(3);
    expect(members[0].user).toBeTruthy();
  });

  // add
  it("add — planner can add a member", async () => {
    const outsider = ctx.getUser("outsider");
    const caller = ctx.callerAs("planner");
    const added = await caller.tripMembers.add({
      tripId,
      userId: outsider.id,
    });
    expect(added.user_id).toBe(outsider.id);
    expect(added.role).toBe("Member");
  });

  it("add — member cannot add", async () => {
    const caller = ctx.callerAs("member");
    // Use a random UUID — the FORBIDDEN check fires before user lookup
    await expect(
      caller.tripMembers.add({ tripId, userId: genId("fake-user") })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("add — duplicate throws CONFLICT", async () => {
    const outsider = ctx.getUser("outsider");
    const caller = ctx.callerAs("planner");
    await expect(
      caller.tripMembers.add({ tripId, userId: outsider.id })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // updateRole
  it("updateRole — owner can promote member to planner", async () => {
    const outsider = ctx.getUser("outsider");
    const caller = ctx.caller();
    const updated = await caller.tripMembers.updateRole({
      tripId,
      userId: outsider.id,
      role: "Planner",
    });
    expect(updated.role).toBe("Planner");
  });

  it("updateRole — owner cannot change own role", async () => {
    const caller = ctx.caller();
    await expect(
      caller.tripMembers.updateRole({ tripId, userId: ctx.user.id, role: "Member" })
    ).rejects.toThrow("Cannot change your own role");
  });

  it("updateRole — planner cannot change roles", async () => {
    const member = ctx.getUser("member");
    const caller = ctx.callerAs("planner");
    await expect(
      caller.tripMembers.updateRole({ tripId, userId: member.id, role: "Planner" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // updateRsvp
  it("updateRsvp — member can update own RSVP", async () => {
    const caller = ctx.callerAs("member");
    const updated = await caller.tripMembers.updateRsvp({
      tripId,
      status: "in",
    });
    expect(updated.status).toBe("in");
  });

  // inviteByEmail
  it("inviteByEmail — planner can invite a new email", async () => {
    const caller = ctx.callerAs("planner");
    const result = await caller.tripMembers.inviteByEmail({
      tripId,
      email: "newperson@example.com",
    });
    expect(result.status).toBe("invited");
    expect(result.userId).toBeTruthy();
  });

  it("inviteByEmail — duplicate invite returns already_member", async () => {
    const caller = ctx.callerAs("planner");
    const result = await caller.tripMembers.inviteByEmail({
      tripId,
      email: "newperson@example.com",
    });
    expect(result.status).toBe("already_member");
  });

  it("inviteByEmail — member cannot invite", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.tripMembers.inviteByEmail({ tripId, email: "another@example.com" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // remove
  it("remove — owner cannot remove self", async () => {
    const caller = ctx.caller();
    await expect(
      caller.tripMembers.remove({ tripId, userId: ctx.user.id })
    ).rejects.toThrow("Cannot remove yourself");
  });

  it("remove — owner can remove a member", async () => {
    const outsider = ctx.getUser("outsider");
    const caller = ctx.caller();
    const result = await caller.tripMembers.remove({ tripId, userId: outsider.id });
    expect(result.success).toBe(true);
  });
});
