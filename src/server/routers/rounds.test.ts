import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;
let eventId: string;
let roundId: string;

describe("rounds router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Rounds Test");
    await ctx.addTripMember(tripId, "member", "Member");
    eventId = await ctx.createEvent(tripId);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("create — owner can create a round", async () => {
    const caller = ctx.caller();
    const round = await caller.rounds.create({
      tripId,
      id: genId("rnd"),
      eventId,
      day: 1,
      title: "Day 1 — Scramble",
      course: "Bandon Dunes",
      format: "scramble",
      pointsAvailable: 4,
    });
    expect(round.title).toBe("Day 1 — Scramble");
    roundId = round.id;
  });

  it("list — member can view rounds", async () => {
    const caller = ctx.callerAs("member");
    const rounds = await caller.rounds.list({ tripId, eventId });
    expect(rounds.length).toBeGreaterThanOrEqual(1);
  });

  it("update — owner can update round status", async () => {
    const caller = ctx.caller();
    const updated = await caller.rounds.update({
      tripId,
      roundId,
      status: "active",
    });
    expect(updated.status).toBe("active");
  });

  it("create — member cannot create", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.rounds.create({
        tripId,
        id: genId("rnd"),
        eventId,
        day: 2,
        title: "Nope",
        course: "Nope",
        format: "skins",
        pointsAvailable: 4,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("remove — owner can remove", async () => {
    const caller = ctx.caller();
    const result = await caller.rounds.remove({ tripId, roundId });
    expect(result.success).toBe(true);
  });
});
