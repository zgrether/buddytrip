import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;
let resId: string;

describe("reservations router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Reservations Test");
    await ctx.addTripMember(tripId, "member", "Member");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("create — owner can create a reservation", async () => {
    const caller = ctx.caller();
    const res = await caller.reservations.create({
      tripId,
      id: genId("res"),
      type: "tee-time",
      title: "Bandon Dunes Round 1",
      date: "2026-10-06",
      startTime: "8:00 AM",
      cost: 350,
    });
    expect(res.title).toBe("Bandon Dunes Round 1");
    resId = res.id;
  });

  it("create — member cannot create", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.reservations.create({
        tripId,
        id: genId("res"),
        type: "restaurant",
        title: "Nope",
        date: "2026-10-06",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("list — any member can view", async () => {
    const caller = ctx.callerAs("member");
    const list = await caller.reservations.list({ tripId });
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it("update — owner can update", async () => {
    const caller = ctx.caller();
    const updated = await caller.reservations.update({
      tripId,
      reservationId: resId,
      cost: 400,
    });
    expect(Number(updated.cost)).toBe(400);
  });

  it("remove — owner can remove", async () => {
    const caller = ctx.caller();
    const result = await caller.reservations.remove({ tripId, reservationId: resId });
    expect(result.success).toBe(true);
  });
});
