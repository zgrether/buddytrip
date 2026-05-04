import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let eventId: string;

describe("playGroups router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Groups Test");
    await ctx.addTripMember(tripId, "member", "Member");
    competitionId = await ctx.createCompetition(tripId, "Groups Test Cup");
    eventId = await ctx.createEvent(competitionId, { type: "GOLF" });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("create — owner can create a play group with name + tee time", async () => {
    const caller = ctx.caller();
    const member = ctx.getUser("member");
    const group = await caller.playGroups.create({
      tripId,
      eventId,
      name: "Group 1",
      teeTime: "8:00 AM",
      playerIds: [ctx.user.id, member.id],
    });
    expect(group.name).toBe("Group 1");
    expect(group.tee_time).toBe("8:00 AM");
    expect(group.player_ids).toEqual([ctx.user.id, member.id]);
  });

  it("create — name and tee_time are optional", async () => {
    const caller = ctx.caller();
    const group = await caller.playGroups.create({
      tripId,
      eventId,
      playerIds: [ctx.user.id],
    });
    expect(group.name).toBeNull();
    expect(group.tee_time).toBeNull();
  });

  it("create — member cannot create", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.playGroups.create({
        tripId,
        eventId,
        playerIds: [ctx.user.id],
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("list — any member can view groups", async () => {
    const caller = ctx.callerAs("member");
    const groups = await caller.playGroups.list({ tripId, eventId });
    expect(groups.length).toBeGreaterThanOrEqual(2);
  });

  it("update — planner can change player composition", async () => {
    const caller = ctx.caller();
    const groups = await caller.playGroups.list({ tripId, eventId });
    const target = groups[0];
    const updated = await caller.playGroups.update({
      tripId,
      groupId: target.id,
      playerIds: [ctx.user.id],
    });
    expect(updated.player_ids).toEqual([ctx.user.id]);
  });

  it("delete — planner can delete", async () => {
    const caller = ctx.caller();
    const groups = await caller.playGroups.list({ tripId, eventId });
    const target = groups[0];
    const result = await caller.playGroups.delete({ tripId, groupId: target.id });
    expect(result).toEqual({ success: true });
  });
});
