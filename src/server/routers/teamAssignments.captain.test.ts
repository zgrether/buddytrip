import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * Captain (Rosters PR b) — teamAssignments.setCaptain + the atomic plpgsql swap
 * (migration 064). Owner-or-Organizer-gated (migration 200; Owner-only before),
 * one-captain-per-team, target-must-be-on-team.
 */

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let teamA: string;
let teamB: string;
let ownerId: string;
let memberId: string;
let plannerId: string;

async function captainsOf(teamId: string): Promise<string[]> {
  const { data } = await ctx.admin
    .from("team_assignments")
    .select("user_id")
    .eq("team_id", teamId)
    .eq("is_captain", true);
  return (data ?? []).map((r) => r.user_id as string);
}

beforeAll(async () => {
  ctx = await TestContext.create();
  ownerId = ctx.user.id;
  tripId = await ctx.createTrip("Captain Trip");
  await ctx.addTripMember(tripId, "planner", "Organizer"); // organizer — NOT owner
  await ctx.addTripMember(tripId, "member", "Member");
  memberId = ctx.getUser("member").id;
  plannerId = ctx.getUser("planner").id;
  competitionId = await ctx.createCompetition(tripId, "Captain Cup");
  teamA = await ctx.createTeam(competitionId, "Alpha", { shortName: "ALP" });
  teamB = await ctx.createTeam(competitionId, "Bravo", { shortName: "BRV" });
  // owner + member on A, planner on B
  await ctx.admin.from("team_assignments").insert([
    { competition_id: competitionId, user_id: ownerId, team_id: teamA },
    { competition_id: competitionId, user_id: memberId, team_id: teamA },
    { competition_id: competitionId, user_id: plannerId, team_id: teamB },
  ]);
}, 30000);

afterAll(async () => {
  await ctx.admin.from("team_assignments").delete().eq("competition_id", competitionId);
  await ctx.cleanup();
}, 30000);

describe("teamAssignments.setCaptain", () => {
  it("owner sets a captain; setting another on the same team CLEARS the first (one per team)", async () => {
    await ctx.caller().teamAssignments.setCaptain({ tripId, competitionId, teamId: teamA, userId: memberId, isCaptain: true });
    expect(await captainsOf(teamA)).toEqual([memberId]);

    await ctx.caller().teamAssignments.setCaptain({ tripId, competitionId, teamId: teamA, userId: ownerId, isCaptain: true });
    expect(await captainsOf(teamA)).toEqual([ownerId]); // member cleared — exactly one
  });

  it("unmark clears just that captain (team left with none)", async () => {
    await ctx.caller().teamAssignments.setCaptain({ tripId, competitionId, teamId: teamA, userId: ownerId, isCaptain: false });
    expect(await captainsOf(teamA)).toEqual([]);
  });

  it("target must be assigned to the team", async () => {
    // plannerId is on team B, not A
    await expect(
      ctx.caller().teamAssignments.setCaptain({ tripId, competitionId, teamId: teamA, userId: plannerId, isCaptain: true })
    ).rejects.toThrow();
    expect(await captainsOf(teamA)).toEqual([]); // unchanged
  });

  it("a plain member cannot set captain — through tRPC, or by calling the function directly", async () => {
    await expect(
      ctx.callerAs("member").teamAssignments.setCaptain({ tripId, competitionId, teamId: teamA, userId: memberId, isCaptain: true })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Below tRPC: the function's own gate. Without this, a database gate
    // widened to anyone would hide behind the still-closed tRPC one.
    const { error } = await ctx.authedClient("member").rpc("set_team_captain", {
      p_trip_id: tripId, p_competition_id: competitionId, p_team_id: teamA, p_user_id: memberId, p_is_captain: true,
    });
    expect(error?.code).toBe("42501");
    expect(await captainsOf(teamA)).toEqual([]); // neither write landed
  });

  it("an Organizer (not owner) CAN set a captain — migration 200", async () => {
    // Asserted a refusal until the PR 8 permissions pass: you can hand out
    // powers you already hold, and an Organizer holds every roster right a
    // captain gets. The one-per-team swap is the same function, so it holds too.
    await ctx.callerAs("planner").teamAssignments.setCaptain({ tripId, competitionId, teamId: teamA, userId: memberId, isCaptain: true });
    expect(await captainsOf(teamA)).toEqual([memberId]);
    await ctx.callerAs("planner").teamAssignments.setCaptain({ tripId, competitionId, teamId: teamA, userId: ownerId, isCaptain: true });
    expect(await captainsOf(teamA)).toEqual([ownerId]);
    // Leave team A captainless, as the next case expects to set it from scratch.
    await ctx.callerAs("planner").teamAssignments.setCaptain({ tripId, competitionId, teamId: teamA, userId: ownerId, isCaptain: false });
    expect(await captainsOf(teamA)).toEqual([]);
  });

  it("an Organizer of THIS trip cannot appoint in another trip's cup by naming this trip", async () => {
    // Migration 200 carried assert_competition_owner's second half — the
    // competition belongs to the trip — into set_team_captain's own gate. The
    // role check is on p_trip_id, so without it an Organizer here could name
    // this trip and another trip's competition. Called directly: the tRPC gate
    // reads the same tripId and would admit it too.
    const otherTrip = await ctx.createTrip("Captain other trip");
    await ctx.addTripMember(otherTrip, "member", "Member");
    const otherComp = await ctx.createCompetition(otherTrip, "Other Cup");
    const otherTeam = await ctx.createTeam(otherComp, "Other", { shortName: "OTH" });
    const seed = await ctx.admin.from("team_assignments").insert({
      competition_id: otherComp, user_id: memberId, team_id: otherTeam,
    });
    if (seed.error) throw new Error(`seed: ${seed.error.message}`);

    const { error } = await ctx.authedClient("planner").rpc("set_team_captain", {
      p_trip_id: tripId, p_competition_id: otherComp, p_team_id: otherTeam, p_user_id: memberId, p_is_captain: true,
    });
    expect(error?.code).toBe("P0002");
    expect(await captainsOf(otherTeam)).toEqual([]);
  });

  it("captains are independent per team (N-team)", async () => {
    await ctx.caller().teamAssignments.setCaptain({ tripId, competitionId, teamId: teamA, userId: memberId, isCaptain: true });
    await ctx.caller().teamAssignments.setCaptain({ tripId, competitionId, teamId: teamB, userId: plannerId, isCaptain: true });
    expect(await captainsOf(teamA)).toEqual([memberId]);
    expect(await captainsOf(teamB)).toEqual([plannerId]);
  });
});
