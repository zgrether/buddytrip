import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;
let competitionId: string;

describe("teams router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Teams Test");
    await ctx.addTripMember(tripId, "planner", "Organizer");
    await ctx.addTripMember(tripId, "member", "Member");
    competitionId = await ctx.createCompetition(tripId, "Teams Test Cup");
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

  it("update — planner can rename a team", async () => {
    const caller = ctx.callerAs("planner");
    const teams = await caller.teams.list({ tripId, competitionId });
    const target = teams[0];
    const updated = await caller.teams.update({
      tripId,
      teamId: target.id,
      name: "Team Hammer 2.0",
    });
    expect(updated.name).toBe("Team Hammer 2.0");
  });

  it("delete — only owner can delete a team", async () => {
    const plannerCaller = ctx.callerAs("planner");
    const teams = await plannerCaller.teams.list({ tripId, competitionId });
    const target = teams[0];

    await expect(
      plannerCaller.teams.delete({ tripId, teamId: target.id })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const ownerCaller = ctx.caller();
    const result = await ownerCaller.teams.delete({ tripId, teamId: target.id });
    expect(result).toEqual({ success: true });
  });
});
