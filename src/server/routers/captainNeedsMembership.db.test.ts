import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * Migration 206: a team captain's rights require trip membership — the same
 * rule 205 gave game delegates. A right granted through a relationship row
 * ends with the membership that made it meaningful.
 *
 * Two arms, each on its own cup (destructive writes, CLAUDE.md):
 *   - CONTROL: a captain on the trip may use every captain-gated RPC, so the
 *     refusals below are the membership check and not a broken fixture;
 *   - the same captaincy row, with the membership gone and the row left in
 *     place, opens none of them and changes nothing.
 *
 * Membership is removed with the service client, deliberately NOT through the
 * archive: the archive clears the captaincy too, and then the row would not
 * be there to test.
 */

let ctx: TestContext;
let owner: string;
let member: string;   // the captain
let outsider: string; // on the captain's team
let planner: string;  // on the trip, on no team

beforeAll(async () => {
  ctx = await TestContext.create();
  owner = ctx.user.id;
  member = ctx.getUser("member").id;
  outsider = ctx.getUser("outsider").id;
  planner = ctx.getUser("planner").id;
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

async function captainCup(label: string) {
  const tripId = await ctx.createTrip(`Captain membership ${label}`);
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  await ctx.addTripMember(tripId, "outsider", "Member");
  const competitionId = await ctx.createCompetition(tripId, `Captain membership cup ${label}`);
  const teamA = await ctx.createTeam(competitionId, "Alpha", { shortName: "ALP" });
  const ins = await ctx.admin.from("team_assignments").insert([
    { competition_id: competitionId, user_id: member, team_id: teamA, is_captain: true },
    // Every row names every key: a bulk insert sends the union of them, so a
    // missing `is_captain` arrives as null rather than as the column default.
    { competition_id: competitionId, user_id: outsider, team_id: teamA, is_captain: false },
    { competition_id: competitionId, user_id: owner, team_id: teamA, is_captain: false },
  ]);
  if (ins.error) throw ins.error;
  return { tripId, competitionId, teamA };
}

async function roster(teamId: string): Promise<string[]> {
  const { data, error } = await ctx.admin.from("team_assignments").select("user_id").eq("team_id", teamId);
  if (error) throw error;
  return (data ?? []).map((r) => r.user_id as string).sort();
}

async function teamName(teamId: string): Promise<string> {
  const { data, error } = await ctx.admin.from("teams").select("name").eq("id", teamId).single();
  if (error) throw error;
  return data.name as string;
}

const asCaptain = () => ctx.authedClient("member");

describe("a captain's rights require trip membership", () => {
  it("CONTROL: a captain on the trip may rename, reorder, add and remove", async () => {
    const c = await captainCup("control");

    expect((await asCaptain().rpc("is_team_captain", { p_team_id: c.teamA })).data).toBe(true);
    expect((await asCaptain().rpc("update_team_identity", { p_team_id: c.teamA, p_name: "Renamed" })).error).toBeNull();
    expect((await asCaptain().rpc("reorder_team_roster", {
      p_competition_id: c.competitionId, p_team_id: c.teamA, p_ordered_user_ids: [outsider, member, owner],
    })).error).toBeNull();
    expect((await asCaptain().rpc("captain_add_player", {
      p_competition_id: c.competitionId, p_team_id: c.teamA, p_user_id: planner,
    })).error).toBeNull();
    expect((await asCaptain().rpc("captain_remove_player", {
      p_competition_id: c.competitionId, p_team_id: c.teamA, p_user_id: outsider,
    })).error).toBeNull();

    expect(await teamName(c.teamA)).toBe("Renamed");
    expect(await roster(c.teamA)).toEqual([member, owner, planner].sort());
  });

  it("the same captaincy, off the trip, opens none of them and changes nothing", async () => {
    const c = await captainCup("off trip");
    const off = await ctx.admin.from("trip_members").delete().eq("trip_id", c.tripId).eq("user_id", member);
    if (off.error) throw off.error;
    // Premise: the captaincy row is still there; only the membership went.
    const { data: still } = await ctx.admin.from("team_assignments")
      .select("is_captain").eq("team_id", c.teamA).eq("user_id", member).single();
    expect(still?.is_captain).toBe(true);
    const before = await roster(c.teamA);

    expect((await asCaptain().rpc("is_team_captain", { p_team_id: c.teamA })).data).toBe(false);
    expect((await asCaptain().rpc("update_team_identity", { p_team_id: c.teamA, p_name: "Renamed" })).error?.code).toBe("42501");
    expect((await asCaptain().rpc("reorder_team_roster", {
      p_competition_id: c.competitionId, p_team_id: c.teamA, p_ordered_user_ids: [outsider, member, owner],
    })).error?.code).toBe("42501");
    expect((await asCaptain().rpc("captain_add_player", {
      p_competition_id: c.competitionId, p_team_id: c.teamA, p_user_id: planner,
    })).error?.code).toBe("42501");
    expect((await asCaptain().rpc("captain_remove_player", {
      p_competition_id: c.competitionId, p_team_id: c.teamA, p_user_id: outsider,
    })).error?.code).toBe("42501");

    expect(await teamName(c.teamA)).toBe("Alpha");
    expect(await roster(c.teamA)).toEqual(before);
  });
});
