import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { HEAD_TO_HEAD_NO_THIRD_TEAM, HEAD_TO_HEAD_KEEPS_BOTH_TEAMS } from "./teams";

/**
 * EVERY CASE BUILDS ITS OWN CUP (#1527). The first block used to share one,
 * which started with NO teams: "create" made the only one, and list, rename and
 * delete all read `teams[0]` — so shuffled ahead of create, list found nothing
 * and rename/delete dereferenced an undefined team.
 */
let ctx: TestContext;

/**
 * A POINTS cup on a crew trip, holding one team. These cases are about WHO may
 * create, rename and delete teams, and a points race takes any number. How many
 * a head-to-head cup holds is its own block below (ruling 2, PR 4).
 */
async function pointsCup(label: string, opts: { withTeam: boolean }) {
  const tripId = await ctx.createTrip(`Teams ${label}`);
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  const competitionId = await ctx.createCompetition(tripId, `Teams Cup ${label}`, { scoringModel: "points" });
  const teamId = opts.withTeam ? await ctx.createTeam(competitionId, "Team Hammer") : null;
  return { tripId, competitionId, teamId };
}

async function teamCount(competitionId: string): Promise<number> {
  const { count, error } = await ctx.admin
    .from("teams").select("id", { count: "exact", head: true }).eq("competition_id", competitionId);
  if (error) throw new Error(`count teams: ${error.message}`);
  return count ?? 0;
}

async function teamName(teamId: string): Promise<string | null> {
  const { data, error } = await ctx.admin.from("teams").select("name").eq("id", teamId).maybeSingle();
  if (error) throw new Error(`read team: ${error.message}`);
  return (data?.name as string | undefined) ?? null;
}

describe("teams router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("create — planner can create a team", async () => {
    const { tripId, competitionId } = await pointsCup("organizer-create", { withTeam: false });
    const team = await ctx.callerAs("planner").teams.create({
      tripId,
      competitionId,
      name: "Team Hammer",
      shortName: "HAM",
      color: "#3b82f6",
      colorDim: "#0a1a2a",
    });
    expect(team.name).toBe("Team Hammer");
    expect(team.short_name).toBe("HAM");
    expect(await teamCount(competitionId)).toBe(1);
  });

  it("create — member cannot create", async () => {
    const { tripId, competitionId } = await pointsCup("member-create", { withTeam: false });
    await expect(
      ctx.callerAs("member").teams.create({
        tripId,
        competitionId,
        name: "Sneaky",
        shortName: "SNK",
        color: "#000000",
        colorDim: "#000000",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await teamCount(competitionId)).toBe(0);
  });

  it("list — any member can list teams", async () => {
    const { tripId, competitionId, teamId } = await pointsCup("list", { withTeam: true });
    const teams = await ctx.callerAs("member").teams.list({ tripId, competitionId });
    // Exactly the team this case made — `>= 1` was satisfied by whatever an
    // earlier case had left behind.
    expect(teams.map((t) => t.id)).toEqual([teamId]);
  });

  it("update — the owner and an Organizer can rename a team's identity; a Member cannot", async () => {
    // Identity (name/short/color): Owner, Organizer (migration 199 — whoever can
    // delete a team can rename it; PR b2 had gated Organizer out), or the team's
    // captain. Captain-specific cases live in teams.identity.test.ts.
    const { tripId, teamId } = await pointsCup("rename", { withTeam: true });
    const updated = await ctx.caller().teams.update({ tripId, teamId: teamId!, name: "Team Hammer 2.0" });
    expect(updated.name).toBe("Team Hammer 2.0");

    const byOrganizer = await ctx.callerAs("planner").teams.update({ tripId, teamId: teamId!, name: "Team Hammer 3.0" });
    expect(byOrganizer.name).toBe("Team Hammer 3.0");

    await expect(
      ctx.callerAs("member").teams.update({ tripId, teamId: teamId!, name: "Nope" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await teamName(teamId!)).toBe("Team Hammer 3.0");
  });

  it("delete — an Organizer can delete a team; a member cannot", async () => {
    const { tripId, competitionId, teamId } = await pointsCup("delete", { withTeam: true });
    // Member is gated out at the organizer boundary — and the team survives it.
    await expect(
      ctx.callerAs("member").teams.delete({ tripId, teamId: teamId! })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await teamCount(competitionId)).toBe(1);

    // Organizer (planner) can — editing teams is owner-minus-destructive
    // (deleting a TEAM isn't a competition-destructive action).
    const result = await ctx.callerAs("planner").teams.delete({ tripId, teamId: teamId! });
    expect(result).toEqual({ success: true });
    expect(await teamCount(competitionId)).toBe(0);
  });

  /**
   * Ruling 2 (PR 4): a head-to-head cup is EXACTLY two teams. Each case is one a
   * wrong build gets wrong: no guard on create (the third team lands), no guard
   * on delete (one team is left), an off-by-one (a cup whose seed never landed
   * cannot reach two), or a guard that ignores the cup's type (a points race
   * loses its any-number rule).
   */
  describe("teams — a head-to-head cup is exactly two teams", () => {
    const TEAM = { shortName: "T", color: "#3b82f6", colorDim: "#0a1a2a" };

    it("refuses a third team, naming what to do instead", async () => {
      const { tripId, competitionId: cup } = await ctx.createCupTrip({ name: "H2H Two", scoringModel: "match_play" });
      await ctx.createTeam(cup, "Blue");
      await ctx.createTeam(cup, "Red");
      await expect(
        ctx.caller().teams.create({ tripId, competitionId: cup, name: "Green", ...TEAM }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: HEAD_TO_HEAD_NO_THIRD_TEAM });
      expect(await teamCount(cup)).toBe(2);
    });

    it("refuses to delete either team, naming what to do instead", async () => {
      const { tripId, competitionId: cup } = await ctx.createCupTrip({ name: "H2H Keep", scoringModel: "match_play" });
      const blue = await ctx.createTeam(cup, "Blue");
      await ctx.createTeam(cup, "Red");
      await expect(
        ctx.caller().teams.delete({ tripId, teamId: blue }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: HEAD_TO_HEAD_KEEPS_BOTH_TEAMS });
      expect(await teamCount(cup)).toBe(2);
    });

    it("admits a team while a head-to-head cup has fewer than two — a seed that never landed can reach two", async () => {
      const { tripId, competitionId: cup } = await ctx.createCupTrip({ name: "H2H One", scoringModel: "match_play" });
      await ctx.createTeam(cup, "Blue");
      const red = await ctx.caller().teams.create({ tripId, competitionId: cup, name: "Red", ...TEAM });
      expect(red.name).toBe("Red");
      expect(await teamCount(cup)).toBe(2);
    });

    it("leaves a points race alone — a third team is added, and one can be deleted", async () => {
      const { tripId, competitionId: cup } = await ctx.createCupTrip({ name: "Points Any", scoringModel: "points" });
      await ctx.createTeam(cup, "Blue");
      await ctx.createTeam(cup, "Red");
      const green = await ctx.caller().teams.create({ tripId, competitionId: cup, name: "Green", ...TEAM });
      expect(await teamCount(cup)).toBe(3);
      await expect(ctx.caller().teams.delete({ tripId, teamId: green.id })).resolves.toEqual({ success: true });
      expect(await teamCount(cup)).toBe(2);
    });
  });
});
