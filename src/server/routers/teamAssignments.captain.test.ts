import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * Captain (Rosters PR b) — teamAssignments.setCaptain + the atomic plpgsql swap
 * (migration 064). Owner-gated, one-captain-per-team, target-must-be-on-team.
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
  await ctx.addTripMember(tripId, "planner", "Organizer"); // co_admin — NOT owner
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

  it("owner-only: a co-admin (Organizer) and a plain member cannot set captain", async () => {
    await expect(
      ctx.callerAs("planner").teamAssignments.setCaptain({ tripId, competitionId, teamId: teamA, userId: memberId, isCaptain: true })
    ).rejects.toThrow();
    await expect(
      ctx.callerAs("member").teamAssignments.setCaptain({ tripId, competitionId, teamId: teamA, userId: memberId, isCaptain: true })
    ).rejects.toThrow();
    expect(await captainsOf(teamA)).toEqual([]); // neither write landed
  });

  it("captains are independent per team (N-team)", async () => {
    await ctx.caller().teamAssignments.setCaptain({ tripId, competitionId, teamId: teamA, userId: memberId, isCaptain: true });
    await ctx.caller().teamAssignments.setCaptain({ tripId, competitionId, teamId: teamB, userId: plannerId, isCaptain: true });
    expect(await captainsOf(teamA)).toEqual([memberId]);
    expect(await captainsOf(teamB)).toEqual([plannerId]);
  });
});
