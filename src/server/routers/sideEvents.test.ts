import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;
let eventId: string;
let sideEventId: string;

describe("sideEvents router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Side Events Test");
    await ctx.addTripMember(tripId, "member", "Member");
    eventId = await ctx.createEvent(tripId);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("create — owner can create a side event", async () => {
    const caller = ctx.caller();
    const se = await caller.sideEvents.create({
      tripId,
      id: genId("se"),
      eventId,
      name: "Closest to Pin",
      icon: "🎯",
      pointsAvailable: 1,
    });
    sideEventId = se.id;
    expect(se.name).toBe("Closest to Pin");
  });

  it("create — member cannot create", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.sideEvents.create({
        tripId,
        id: genId("se"),
        eventId,
        name: "Nope",
        icon: "❌",
        pointsAvailable: 1,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("list — member can list side events", async () => {
    const caller = ctx.callerAs("member");
    const list = await caller.sideEvents.list({ tripId, eventId });
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it("submitResult — owner can submit result", async () => {
    const teamAId = await ctx.createTeam(eventId, "Team A");
    const teamBId = await ctx.createTeam(eventId, "Team B");
    const caller = ctx.caller();
    const result = await caller.sideEvents.submitResult({
      tripId,
      sideEventId,
      result: { [teamAId]: 1, [teamBId]: 0 },
    });
    expect(result.status).toBe("complete");
    expect(result.result).toEqual({ [teamAId]: 1, [teamBId]: 0 });
  });

  it("submitResult — member cannot submit", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.sideEvents.submitResult({
        tripId,
        sideEventId,
        result: {},
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
