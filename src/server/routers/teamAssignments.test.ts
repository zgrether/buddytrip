import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;
let eventId: string;
let teamId: string;

describe("teamAssignments router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Assign Test");
    await ctx.addTripMember(tripId, "member", "Member");
    eventId = await ctx.createEvent(tripId);
    teamId = await ctx.createTeam(eventId, "Team A");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("assign — owner can assign a player", async () => {
    const member = ctx.getUser("member");
    const caller = ctx.caller();
    const assignment = await caller.teamAssignments.assign({
      tripId,
      eventId,
      teamId,
      userId: member.id,
    });
    expect(assignment.team_id).toBe(teamId);
  });

  it("list — member can view assignments", async () => {
    const caller = ctx.callerAs("member");
    const assignments = await caller.teamAssignments.list({ tripId, eventId });
    expect(assignments.length).toBeGreaterThanOrEqual(1);
  });

  it("remove — owner can remove assignment", async () => {
    const member = ctx.getUser("member");
    const caller = ctx.caller();
    const result = await caller.teamAssignments.remove({
      tripId,
      eventId,
      userId: member.id,
    });
    expect(result.success).toBe(true);
  });

  it("assign — member cannot assign", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.teamAssignments.assign({
        tripId,
        eventId,
        teamId,
        userId: ctx.user.id,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
