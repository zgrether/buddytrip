import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { HEAD_TO_HEAD_NO_THIRD_TEAM, HEAD_TO_HEAD_KEEPS_BOTH_TEAMS } from "./teams";

let ctx: TestContext;
let tripId: string;
let competitionId: string;

describe("teams router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Teams Test");
    await ctx.addTripMember(tripId, "planner", "Organizer");
    await ctx.addTripMember(tripId, "member", "Member");
    // A POINTS cup: these cases are about WHO may create and delete teams, and a
    // points race takes any number. How many a head-to-head cup holds is its own
    // block below (ruling 2, PR 4).
    competitionId = await ctx.createCompetition(tripId, "Teams Test Cup", { scoringModel: "points" });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("create — planner can create a team", async () => {
    const caller = ctx.callerAs("planner");
    const team = await caller.teams.create({
      tripId,
      competitionId,
      name: "Team Hammer",
      shortName: "HAM",
      color: "#3b82f6",
      colorDim: "#0a1a2a",
    });
    expect(team.name).toBe("Team Hammer");
    expect(team.short_name).toBe("HAM");
  });

  it("create — member cannot create", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.teams.create({
        tripId,
        competitionId,
        name: "Sneaky",
        shortName: "SNK",
        color: "#000000",
        colorDim: "#000000",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("list — any member can list teams", async () => {
    const caller = ctx.callerAs("member");
    const teams = await caller.teams.list({ tripId, competitionId });
    expect(teams.length).toBeGreaterThanOrEqual(1);
  });

  it("update — the owner can rename a team's identity; a co-admin (Organizer) cannot (PR b2)", async () => {
    // Identity (name/short/color) is the captain tier now: owner OR the team's
    // captain. A co-admin (Organizer) who is NOT the captain is re-gated out —
    // captain-specific cases live in teams.identity.test.ts.
    const teams = await ctx.caller().teams.list({ tripId, competitionId });
    const target = teams[0];
    const updated = await ctx.caller().teams.update({
      tripId,
      teamId: target.id,
      name: "Team Hammer 2.0",
    });
    expect(updated.name).toBe("Team Hammer 2.0");

    await expect(
      ctx.callerAs("planner").teams.update({ tripId, teamId: target.id, name: "Nope" })
    ).rejects.toThrow();
  });

  it("delete — a co-admin (trip Organizer) can delete a team; a member cannot", async () => {
    // Member is gated out at the co_admin boundary.
    const memberCaller = ctx.callerAs("member");
    const memberTeams = await memberCaller.teams.list({ tripId, competitionId });
    await expect(
      memberCaller.teams.delete({ tripId, teamId: memberTeams[0].id })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Co-admin (planner) can — editing teams is owner-minus-destructive
    // (deleting a TEAM isn't a competition-destructive action).
    const plannerCaller = ctx.callerAs("planner");
    const teams = await plannerCaller.teams.list({ tripId, competitionId });
    const result = await plannerCaller.teams.delete({ tripId, teamId: teams[0].id });
    expect(result).toEqual({ success: true });
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

    async function teamCount(competitionId: string): Promise<number> {
      const { count } = await ctx.admin
        .from("teams").select("id", { count: "exact", head: true }).eq("competition_id", competitionId);
      return count ?? 0;
    }

    it("refuses a third team, naming what to do instead", async () => {
      const cup = await ctx.createCompetition(tripId, "H2H Two", { scoringModel: "match_play" });
      await ctx.createTeam(cup, "Blue");
      await ctx.createTeam(cup, "Red");
      await expect(
        ctx.caller().teams.create({ tripId, competitionId: cup, name: "Green", ...TEAM }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: HEAD_TO_HEAD_NO_THIRD_TEAM });
      expect(await teamCount(cup)).toBe(2);
    });

    it("refuses to delete either team, naming what to do instead", async () => {
      const cup = await ctx.createCompetition(tripId, "H2H Keep", { scoringModel: "match_play" });
      const blue = await ctx.createTeam(cup, "Blue");
      await ctx.createTeam(cup, "Red");
      await expect(
        ctx.caller().teams.delete({ tripId, teamId: blue }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: HEAD_TO_HEAD_KEEPS_BOTH_TEAMS });
      expect(await teamCount(cup)).toBe(2);
    });

    it("admits a team while a head-to-head cup has fewer than two — a seed that never landed can reach two", async () => {
      const cup = await ctx.createCompetition(tripId, "H2H One", { scoringModel: "match_play" });
      await ctx.createTeam(cup, "Blue");
      const red = await ctx.caller().teams.create({ tripId, competitionId: cup, name: "Red", ...TEAM });
      expect(red.name).toBe("Red");
      expect(await teamCount(cup)).toBe(2);
    });

    it("leaves a points race alone — a third team is added, and one can be deleted", async () => {
      const cup = await ctx.createCompetition(tripId, "Points Any", { scoringModel: "points" });
      await ctx.createTeam(cup, "Blue");
      await ctx.createTeam(cup, "Red");
      const green = await ctx.caller().teams.create({ tripId, competitionId: cup, name: "Green", ...TEAM });
      expect(await teamCount(cup)).toBe(3);
      await expect(ctx.caller().teams.delete({ tripId, teamId: green.id })).resolves.toEqual({ success: true });
      expect(await teamCount(cup)).toBe(2);
    });
  });
});
