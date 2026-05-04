import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;
let competitionId: string;

describe("events router (scored activities)", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Events Test");
    await ctx.addTripMember(tripId, "member", "Member");
    competitionId = await ctx.createCompetition(tripId, "Events Test Cup");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("create — owner can create a GOLF event", async () => {
    const caller = ctx.caller();
    const event = await caller.events.create({
      tripId,
      competitionId,
      type: "GOLF",
      title: "Day 1 Scramble",
      scoringFormat: "scramble",
      day: 1,
      pointsAvailable: 4,
    });
    expect(event.type).toBe("GOLF");
    expect(event.title).toBe("Day 1 Scramble");
    expect(event.is_practice).toBe(false);
    ctx.trackEvent(event.id);
  });

  it("create — owner can create a GENERIC event without scoring_format", async () => {
    const caller = ctx.caller();
    const event = await caller.events.create({
      tripId,
      competitionId,
      type: "GENERIC",
      title: "Cornhole",
      pointsAvailable: 2,
    });
    expect(event.type).toBe("GENERIC");
    expect(event.scoring_format).toBeNull();
    ctx.trackEvent(event.id);
  });

  it("create — member cannot create", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.events.create({
        tripId,
        competitionId,
        type: "GOLF",
        title: "Nope",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("list — any member can view", async () => {
    const caller = ctx.callerAs("member");
    const events = await caller.events.list({ tripId, competitionId });
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  it("update — planner can update title + practice flag", async () => {
    const caller = ctx.caller();
    const events = await caller.events.list({ tripId, competitionId });
    const target = events[0];
    const updated = await caller.events.update({
      tripId,
      eventId: target.id,
      title: "Day 1 Scramble — moved",
      isPractice: true,
    });
    expect(updated.title).toBe("Day 1 Scramble — moved");
    expect(updated.is_practice).toBe(true);
  });

  it("setPointDistributions — replaces rows on each call", async () => {
    const caller = ctx.caller();
    const events = await caller.events.list({ tripId, competitionId });
    const target = events.find((e) => e.type === "GOLF")!;

    await caller.events.setPointDistributions({
      tripId,
      eventId: target.id,
      positions: [
        { position: 1, label: "1st Place", points: 3 },
        { position: 2, label: "2nd Place", points: 1 },
      ],
    });

    const refreshed = await caller.events.list({ tripId, competitionId });
    const matched = refreshed.find((e) => e.id === target.id);
    const dists = (matched as { point_distributions?: Array<{ points: number }> })
      .point_distributions;
    expect(dists).toBeDefined();
    expect(dists!.length).toBe(2);
  });

  it("delete — planner can delete", async () => {
    const caller = ctx.caller();
    const events = await caller.events.list({ tripId, competitionId });
    const target = events[0];
    const result = await caller.events.delete({ tripId, eventId: target.id });
    expect(result).toEqual({ success: true });
  });
});
