import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * Captain permission (Rosters PR b2) — teams.update (team IDENTITY: name/short/
 * color) is gated owner OR the captain of THAT team (requireTeamIdentityEdit).
 * Structure (create/delete/assign/remove) stays owner-only and is unaffected.
 */

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let teamA: string;
let teamB: string;
let memberId: string;
let plannerId: string;

async function teamName(teamId: string): Promise<string> {
  const { data } = await ctx.admin.from("teams").select("name").eq("id", teamId).single();
  return (data as { name: string }).name;
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Identity Trip");
  await ctx.addTripMember(tripId, "planner", "Organizer"); // co_admin — NOT owner, NOT captain
  await ctx.addTripMember(tripId, "member", "Member");
  memberId = ctx.getUser("member").id;
  plannerId = ctx.getUser("planner").id;
  competitionId = await ctx.createCompetition(tripId, "Identity Cup");
  teamA = await ctx.createTeam(competitionId, "Alpha", { shortName: "ALP" });
  teamB = await ctx.createTeam(competitionId, "Bravo", { shortName: "BRV" });
  // member is the CAPTAIN of team A; planner is on B (no captaincy).
  // NB: keep is_captain on EVERY row — a heterogeneous batch insert unions the
  // columns and writes NULL (not the default) for rows that omit it, tripping the
  // NOT NULL constraint and aborting the whole batch.
  await ctx.admin.from("team_assignments").insert([
    { competition_id: competitionId, user_id: ctx.user.id, team_id: teamA, is_captain: false },
    { competition_id: competitionId, user_id: memberId, team_id: teamA, is_captain: true },
    { competition_id: competitionId, user_id: plannerId, team_id: teamB, is_captain: false },
  ]);
}, 30000);

afterAll(async () => {
  await ctx.admin.from("team_assignments").delete().eq("competition_id", competitionId);
  await ctx.cleanup();
}, 30000);

describe("teams.update — identity gated owner || captain-of-team", () => {
  it("owner can update any team's identity", async () => {
    await ctx.caller().teams.update({ tripId, teamId: teamB, name: "Bravo Prime" });
    expect(await teamName(teamB)).toBe("Bravo Prime");
  });

  it("the team's captain can edit THEIR team's identity", async () => {
    await ctx.callerAs("member").teams.update({ tripId, teamId: teamA, name: "Alpha Prime" });
    expect(await teamName(teamA)).toBe("Alpha Prime");
  });

  it("a captain CANNOT edit another team's identity", async () => {
    await expect(
      ctx.callerAs("member").teams.update({ tripId, teamId: teamB, name: "Hijack" })
    ).rejects.toThrow();
    expect(await teamName(teamB)).toBe("Bravo Prime"); // unchanged
  });

  it("a co-admin (Organizer, non-captain) CANNOT edit identity — re-gated off co_admin", async () => {
    await expect(
      ctx.callerAs("planner").teams.update({ tripId, teamId: teamA, name: "Nope" })
    ).rejects.toThrow();
    expect(await teamName(teamA)).toBe("Alpha Prime"); // unchanged
  });
});
