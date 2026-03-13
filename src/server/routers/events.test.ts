import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;
let eventId: string;

describe("events router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Events Test");
    await ctx.addTripMember(tripId, "member", "Member");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("upsert — owner can create an event", async () => {
    const caller = ctx.caller();
    const event = await caller.events.upsert({
      id: `test-evt-${Date.now()}`,
      tripId,
      title: "BBMI 2026",
      location: "Bandon Dunes, OR",
      dates: "Oct 5-8, 2026",
    });
    expect(event.title).toBe("BBMI 2026");
    eventId = event.id;
    ctx.trackEvent(eventId);
  });

  it("upsert — member cannot create", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.events.upsert({
        tripId,
        id: `test-evt-nope-${Date.now()}`,
        title: "Nope",
        location: "Nowhere",
        dates: "Never",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("getByTrip — any member can view", async () => {
    const caller = ctx.callerAs("member");
    const event = await caller.events.getByTrip({ tripId });
    expect(event?.title).toBe("BBMI 2026");
  });

  it("upsert — updates existing event", async () => {
    const caller = ctx.caller();
    const event = await caller.events.upsert({
      tripId,
      id: eventId,
      title: "BBMI 2026 Updated",
      location: "Bandon Dunes, OR",
      dates: "Oct 5-8, 2026",
      status: "active",
    });
    expect(event.title).toBe("BBMI 2026 Updated");
    expect(event.status).toBe("active");
  });
});
