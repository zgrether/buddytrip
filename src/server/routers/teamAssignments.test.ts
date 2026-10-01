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

  // Each case sets the assignment state it needs (#1527): these used to rely on
  // the case above having assigned the member, so a 502 there failed them for a
  // reason that was not theirs.
  it("assign — calling again replaces team (composite PK)", async () => {
    const caller = ctx.caller();
    const member = ctx.getUser("member");
    await caller.teamAssignments.assign({ tripId, competitionId, userId: member.id, teamId: teamA });
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

  // Renamed: it said "only owner can remove (per spec)" and has only ever tested
  // that the owner CAN. Organizers can too (#786), pinned in organizerParity.
  it("remove — the owner removes an assignment, and the row is gone", async () => {
    const ownerCaller = ctx.caller();
    const member = ctx.getUser("member");
    await ownerCaller.teamAssignments.assign({ tripId, competitionId, userId: member.id, teamId: teamA });
    const result = await ownerCaller.teamAssignments.remove({
      tripId,
      competitionId,
      userId: member.id,
    });
    expect(result).toEqual({ success: true });
    const { data } = await ctx.admin
      .from("team_assignments")
      .select("user_id")
      .eq("competition_id", competitionId)
      .eq("user_id", member.id);
    expect(data).toEqual([]);
  });
});

// Canonical roster order (mig 070) — sort_order on assign + the reorder mutation.
//
// Every case builds its OWN trip, cup, team and roster (#1527). They used to
// share one: the reorder cases relied on "assign appends" having seated three
// players, so a 502 there failed "reorder persists" as "Order must be exactly
// this team's current roster", and the two refusal cases passed on an EMPTY
// roster, refusing orders they could not have accepted anyway. A whole trip per
// case, because a trip holds one competition and a player one team per cup.
describe("teamAssignments roster order", () => {
  let octx: TestContext;
  let p1: string; // planner
  let p2: string; // member
  let p3: string; // outsider

  beforeAll(async () => {
    octx = await TestContext.create();
    p1 = octx.getUser("planner").id;
    p2 = octx.getUser("member").id;
    p3 = octx.getUser("outsider").id;
  });

  afterAll(async () => {
    await octx.cleanup();
  });

  /** A trip whose cup has one team, with p1, p2, p3 trip members (not yet on it). */
  async function freshCup(label: string) {
    const tripId = await octx.createTrip(`Roster Order ${label}`);
    await octx.addTripMember(tripId, "planner", "Member");
    await octx.addTripMember(tripId, "member", "Member");
    await octx.addTripMember(tripId, "outsider", "Member");
    const competitionId = await octx.createCompetition(tripId, `Order Cup ${label}`);
    const teamId = await octx.createTeam(competitionId, "Order Team");
    return { tripId, competitionId, teamId };
  }

  /** The same cup with p1, p2, p3 seated in that order: the state assign produces. */
  async function seatedCup(label: string) {
    const c = await freshCup(label);
    const { error } = await octx.admin.from("team_assignments").insert(
      [p1, p2, p3].map((user_id, sort_order) => ({ competition_id: c.competitionId, team_id: c.teamId, user_id, sort_order }))
    );
    if (error) throw new Error(`seat roster: ${error.message}`);
    return c;
  }

  async function order(c: { tripId: string; competitionId: string; teamId: string }) {
    const list = await octx.caller().teamAssignments.list({ tripId: c.tripId, competitionId: c.competitionId });
    return (list as { team_id: string; user_id: string; sort_order?: number }[])
      .filter((a) => a.team_id === c.teamId)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }

  it("assign appends each new player to the end of the team's order", async () => {
    const c = await freshCup("append");
    const caller = octx.caller();
    await caller.teamAssignments.assign({ tripId: c.tripId, competitionId: c.competitionId, userId: p1, teamId: c.teamId });
    await caller.teamAssignments.assign({ tripId: c.tripId, competitionId: c.competitionId, userId: p2, teamId: c.teamId });
    await caller.teamAssignments.assign({ tripId: c.tripId, competitionId: c.competitionId, userId: p3, teamId: c.teamId });

    const o = await order(c);
    expect(o.map((a) => a.user_id)).toEqual([p1, p2, p3]);
    expect(o.map((a) => a.sort_order)).toEqual([0, 1, 2]);
  });

  it("reorder persists a new canonical order (owner)", async () => {
    const c = await seatedCup("persist");
    await octx.caller().teamAssignments.reorder({
      tripId: c.tripId,
      competitionId: c.competitionId,
      teamId: c.teamId,
      orderedUserIds: [p3, p1, p2],
    });
    const o = await order(c);
    expect(o.map((a) => a.user_id)).toEqual([p3, p1, p2]);
    expect(o.map((a) => a.sort_order)).toEqual([0, 1, 2]);
  });

  it("reorder rejects a non-permutation of the roster", async () => {
    const c = await seatedCup("reject");
    // Premise: there IS a three-player roster, so the two orders below are
    // refused for not matching it, not because there was nothing to match.
    expect((await order(c)).map((a) => a.user_id)).toEqual([p1, p2, p3]);
    const caller = octx.caller();
    // Missing a member.
    await expect(
      caller.teamAssignments.reorder({ tripId: c.tripId, competitionId: c.competitionId, teamId: c.teamId, orderedUserIds: [p1, p2] })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Extra / foreign id.
    await expect(
      caller.teamAssignments.reorder({ tripId: c.tripId, competitionId: c.competitionId, teamId: c.teamId, orderedUserIds: [p1, p2, p3, "ghost"] })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // CONTROL: the same roster accepts a true permutation, so the two refusals
    // above are about the order, not the call failing for some other reason.
    await caller.teamAssignments.reorder({ tripId: c.tripId, competitionId: c.competitionId, teamId: c.teamId, orderedUserIds: [p2, p3, p1] });
    expect((await order(c)).map((a) => a.user_id)).toEqual([p2, p3, p1]);
  });

  it("reorder is refused for a plain member who is not this team's captain", async () => {
    const c = await seatedCup("member");
    await expect(
      octx.callerAs("member").teamAssignments.reorder({ tripId: c.tripId, competitionId: c.competitionId, teamId: c.teamId, orderedUserIds: [p3, p1, p2] })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await order(c)).map((a) => a.user_id)).toEqual([p1, p2, p3]);
  });
});
