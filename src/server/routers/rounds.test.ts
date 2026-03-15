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

  it("activate — owner can activate an upcoming round", async () => {
    // Create two rounds: one active, one upcoming
    const caller = ctx.caller();
    const r1 = await caller.rounds.create({
      tripId, id: genId("rnd"), eventId, day: 3,
      title: "Active Round", course: "Bandon", format: "scramble", pointsAvailable: 4,
    });
    await caller.rounds.update({ tripId, roundId: r1.id, status: "active" });

    const r2 = await caller.rounds.create({
      tripId, id: genId("rnd"), eventId, day: 4,
      title: "Next Round", course: "Bandon", format: "skins", pointsAvailable: 4,
    });

    const result = await caller.rounds.activate({ tripId, roundId: r2.id, eventId });
    expect(result.success).toBe(true);

    const rounds = await caller.rounds.list({ tripId, eventId });
    const updated1 = rounds.find((r) => r.id === r1.id);
    const updated2 = rounds.find((r) => r.id === r2.id);
    expect(updated1?.status).toBe("submitted");
    expect(updated2?.status).toBe("active");

    // Cleanup
    await caller.rounds.remove({ tripId, roundId: r1.id });
    await caller.rounds.remove({ tripId, roundId: r2.id });
  });

  it("activate — member cannot activate a round", async () => {
    const memberCaller = ctx.callerAs("member");
    await expect(
      memberCaller.rounds.activate({ tripId, roundId: genId("rnd"), eventId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("remove — owner can remove", async () => {
    const caller = ctx.caller();
    const result = await caller.rounds.remove({ tripId, roundId });
    expect(result.success).toBe(true);
  });
});
