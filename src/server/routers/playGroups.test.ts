import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;
let eventId: string;
let groupId: string;

describe("playGroups router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Groups Test");
    await ctx.addTripMember(tripId, "member", "Member");
    eventId = await ctx.createEvent(tripId);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("create — owner can create a play group", async () => {
    const member = ctx.getUser("member");
    const caller = ctx.caller();
    const group = await caller.playGroups.create({
      tripId,
      id: genId("grp"),
      eventId,
      name: "Group 1",
      teeTime: "8:00 AM",
      playerIds: [ctx.user.id, member.id],
    });
    expect(group.name).toBe("Group 1");
    expect(group.player_ids).toContain(ctx.user.id);
    groupId = group.id;
  });

  it("list — member can view groups", async () => {
    const caller = ctx.callerAs("member");
    const groups = await caller.playGroups.list({ tripId, eventId });
    expect(groups.length).toBeGreaterThanOrEqual(1);
  });

  it("update — owner can update", async () => {
    const caller = ctx.caller();
    const updated = await caller.playGroups.update({
      tripId,
      groupId,
      teeTime: "9:00 AM",
    });
    expect(updated.tee_time).toBe("9:00 AM");
  });

  it("delete — owner can delete a play group", async () => {
    const caller = ctx.caller();
    // Delete the group created in the first test
    await expect(
      caller.playGroups.delete({ tripId, groupId })
    ).resolves.toEqual({ success: true });

    // Confirm it no longer appears in the list
    const groups = await caller.playGroups.list({ tripId, eventId });
    expect(groups.find((g) => g.id === groupId)).toBeUndefined();
  });

  it("delete — member (non-planner) cannot delete a play group", async () => {
    // Create a fresh group to attempt deletion of
    const caller = ctx.caller();
    const fresh = await caller.playGroups.create({
      tripId,
      id: genId("grp"),
      eventId,
      name: "Group 2",
      teeTime: "10:00 AM",
      playerIds: [],
    });

    const memberCaller = ctx.callerAs("member");
    await expect(
      memberCaller.playGroups.delete({ tripId, groupId: fresh.id })
    ).rejects.toThrow();
  });
});
