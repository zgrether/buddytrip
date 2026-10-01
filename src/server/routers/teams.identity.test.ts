import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * Captain permission (Rosters PR b2) — teams.update (team IDENTITY: name/short/
 * color) is gated owner OR the captain of THAT team (requireTeamIdentityEdit).
 * Structure (create/delete/assign/remove) stays owner-only and is unaffected.
 *
 * EACH CASE BUILDS ITS OWN CUP (#1527). They used to share one, and the
 * refusal case asserted team B was still "Bravo Prime" — the name the OWNER
 * case had given it. Shuffled ahead of that case, B was still "Bravo", and a
 * refusal that worked read as one that failed.
 */

let ctx: TestContext;
let memberId: string;
let plannerId: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  memberId = ctx.getUser("member").id;
  plannerId = ctx.getUser("planner").id;
}, 30000);

afterAll(async () => {
  await ctx.cleanup();
}, 30000);

/** Team A (owner + member, member CAPTAINS it) and team B (planner, no captain). */
async function identityCup(label: string) {
  const tripId = await ctx.createTrip(`Identity ${label}`);
  await ctx.addTripMember(tripId, "planner", "Organizer"); // organizer — NOT owner, NOT captain
  await ctx.addTripMember(tripId, "member", "Member");
  const competitionId = await ctx.createCompetition(tripId, `Identity Cup ${label}`);
  const teamA = await ctx.createTeam(competitionId, "Alpha", { shortName: "ALP" });
  const teamB = await ctx.createTeam(competitionId, "Bravo", { shortName: "BRV" });
  // NB: keep is_captain on EVERY row — a heterogeneous batch insert unions the
  // columns and writes NULL (not the default) for rows that omit it, tripping the
  // NOT NULL constraint and aborting the whole batch.
  const { error } = await ctx.admin.from("team_assignments").insert([
    { competition_id: competitionId, user_id: ctx.user.id, team_id: teamA, is_captain: false },
    { competition_id: competitionId, user_id: memberId, team_id: teamA, is_captain: true },
    { competition_id: competitionId, user_id: plannerId, team_id: teamB, is_captain: false },
  ]);
  if (error) throw new Error(`seed assignments: ${error.message}`);
  return { tripId, competitionId, teamA, teamB };
}

async function teamName(teamId: string): Promise<string> {
  const { data, error } = await ctx.admin.from("teams").select("name").eq("id", teamId).single();
  if (error) throw new Error(`read team: ${error.message}`);
  return (data as { name: string }).name;
}

describe("teams.update — identity gated owner || captain-of-team", () => {
  it("owner can update any team's identity", async () => {
    const { tripId, teamB } = await identityCup("owner");
    await ctx.caller().teams.update({ tripId, teamId: teamB, name: "Bravo Prime" });
    expect(await teamName(teamB)).toBe("Bravo Prime");
  });

  it("the team's captain can edit THEIR team's identity", async () => {
    const { tripId, teamA } = await identityCup("captain-own");
    await ctx.callerAs("member").teams.update({ tripId, teamId: teamA, name: "Alpha Prime" });
    expect(await teamName(teamA)).toBe("Alpha Prime");
  });

  it("a captain CANNOT edit another team's identity", async () => {
    const { tripId, competitionId, teamB } = await identityCup("captain-other");
    // Premise: the caller really is a captain — of the OTHER team — so the
    // refusal is about which team, not about having no captaincy at all.
    const { data: captaincy, error } = await ctx.admin
      .from("team_assignments")
      .select("team_id, is_captain")
      .eq("competition_id", competitionId)
      .eq("user_id", memberId)
      .single();
    if (error) throw new Error(`read captaincy: ${error.message}`);
    expect(captaincy).toMatchObject({ is_captain: true });
    expect(captaincy!.team_id).not.toBe(teamB);

    await expect(
      ctx.callerAs("member").teams.update({ tripId, teamId: teamB, name: "Hijack" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await teamName(teamB)).toBe("Bravo"); // unchanged
  });

  it("an Organizer (non-captain) CAN edit identity — whoever can delete a team can rename it (migration 199)", async () => {
    // Asserted a refusal until the PR 8 permissions pass reversed it.
    const { tripId, teamA } = await identityCup("organizer");
    await ctx.callerAs("planner").teams.update({ tripId, teamId: teamA, name: "Alpha Organized" });
    expect(await teamName(teamA)).toBe("Alpha Organized");
  });
});
