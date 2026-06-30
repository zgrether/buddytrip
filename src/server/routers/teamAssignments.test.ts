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

// Canonical roster order (mig 069) — sort_order on assign + the reorder mutation.
describe("teamAssignments roster order", () => {
  let octx: TestContext;
  let otrip: string;
  let ocomp: string;
  let oteam: string;
  let p1: string; // planner
  let p2: string; // member
  let p3: string; // outsider

  beforeAll(async () => {
    octx = await TestContext.create();
    otrip = await octx.createTrip("Roster Order Test");
    await octx.addTripMember(otrip, "planner", "Member");
    await octx.addTripMember(otrip, "member", "Member");
    await octx.addTripMember(otrip, "outsider", "Member");
    ocomp = await octx.createCompetition(otrip, "Order Cup");
    oteam = await octx.createTeam(ocomp, "Order Team");
    p1 = octx.getUser("planner").id;
    p2 = octx.getUser("member").id;
    p3 = octx.getUser("outsider").id;
  });

  afterAll(async () => {
    await octx.cleanup();
  });

  const teamOrder = (
    list: { team_id: string; user_id: string; sort_order?: number }[]
  ) => list.filter((a) => a.team_id === oteam);

  it("assign appends each new player to the end of the team's order", async () => {
    const caller = octx.caller();
    await caller.teamAssignments.assign({ tripId: otrip, competitionId: ocomp, userId: p1, teamId: oteam });
    await caller.teamAssignments.assign({ tripId: otrip, competitionId: ocomp, userId: p2, teamId: oteam });
    await caller.teamAssignments.assign({ tripId: otrip, competitionId: ocomp, userId: p3, teamId: oteam });

    const order = teamOrder(await caller.teamAssignments.list({ tripId: otrip, competitionId: ocomp }));
    expect(order.map((a) => a.user_id)).toEqual([p1, p2, p3]);
    expect(order.map((a) => a.sort_order)).toEqual([0, 1, 2]);
  });

  it("reorder persists a new canonical order (owner)", async () => {
    const caller = octx.caller();
    await caller.teamAssignments.reorder({
      tripId: otrip,
      competitionId: ocomp,
      teamId: oteam,
      orderedUserIds: [p3, p1, p2],
    });

    const order = teamOrder(await caller.teamAssignments.list({ tripId: otrip, competitionId: ocomp }));
    expect(order.map((a) => a.user_id)).toEqual([p3, p1, p2]);
    expect(order.map((a) => a.sort_order)).toEqual([0, 1, 2]);
  });

  it("reorder rejects a non-permutation of the roster", async () => {
    const caller = octx.caller();
    // Missing a member.
    await expect(
      caller.teamAssignments.reorder({ tripId: otrip, competitionId: ocomp, teamId: oteam, orderedUserIds: [p1, p2] })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Extra / foreign id.
    await expect(
      caller.teamAssignments.reorder({ tripId: otrip, competitionId: ocomp, teamId: oteam, orderedUserIds: [p1, p2, p3, "ghost"] })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("reorder is owner-only (a plain member is refused)", async () => {
    const memberCaller = octx.callerAs("member");
    await expect(
      memberCaller.teamAssignments.reorder({ tripId: otrip, competitionId: ocomp, teamId: oteam, orderedUserIds: [p3, p1, p2] })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
