import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let teamA: string;
let teamB: string;

describe("teamAssignments router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Assignments Test");
    await ctx.addTripMember(tripId, "member", "Member");
    competitionId = await ctx.createCompetition(tripId, "Assignments Test Cup");
    teamA = await ctx.createTeam(competitionId, "Team A");
    teamB = await ctx.createTeam(competitionId, "Team B");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("assign — planner can assign a member to a team", async () => {
    const caller = ctx.caller();
    const member = ctx.getUser("member");
    const assignment = await caller.teamAssignments.assign({
      tripId,
      competitionId,
      userId: member.id,
      teamId: teamA,
    });
    expect(assignment.team_id).toBe(teamA);
  });

  it("assign — calling again replaces team (composite PK)", async () => {
    const caller = ctx.caller();
    const member = ctx.getUser("member");
    const updated = await caller.teamAssignments.assign({
      tripId,
      competitionId,
      userId: member.id,
      teamId: teamB,
    });
    expect(updated.team_id).toBe(teamB);

    const list = await caller.teamAssignments.list({ tripId, competitionId });
    const memberAssignments = list.filter((a) => a.user_id === member.id);
    expect(memberAssignments.length).toBe(1);
    expect(memberAssignments[0].team_id).toBe(teamB);
  });

  it("assign — member cannot assign", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.teamAssignments.assign({
        tripId,
        competitionId,
        userId: ctx.user.id,
        teamId: teamA,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("remove — only owner can remove (per spec)", async () => {
    const ownerCaller = ctx.caller();
    const member = ctx.getUser("member");
    const result = await ownerCaller.teamAssignments.remove({
      tripId,
      competitionId,
      userId: member.id,
    });
    expect(result).toEqual({ success: true });
  });
});
