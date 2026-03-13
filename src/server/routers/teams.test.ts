import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;
let eventId: string;

describe("teams router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Teams Test");
    await ctx.addTripMember(tripId, "member", "Member");
    eventId = await ctx.createEvent(tripId, "BBMI");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("upsert — owner can create a team", async () => {
    const caller = ctx.caller();
    const team = await caller.teams.upsert({
      tripId,
      id: genId("team"),
      eventId,
      name: "Team Hammer",
      shortName: "HAMMER",
      color: "#00e676",
      colorDim: "#00e67640",
    });
    expect(team.name).toBe("Team Hammer");
  });

  it("list — member can view teams", async () => {
    const caller = ctx.callerAs("member");
    const teams = await caller.teams.list({ tripId, eventId });
    expect(teams.length).toBeGreaterThanOrEqual(1);
  });
});
