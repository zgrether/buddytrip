import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;
let lodgingId: string;
let transportId: string;
let generalId: string;

describe("logistics router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Logistics Test");
    await ctx.addTripMember(tripId, "planner", "Organizer");
    await ctx.addTripMember(tripId, "member", "Member");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // ── create ────────────────────────────────────────────────────────────

  it("create — planner can create a lodging item", async () => {
    const caller = ctx.callerAs("planner");
    const item = await caller.logistics.create({
      tripId,
      type: "lodging",
      title: "Beach House",
      sleeps: "8",
      address: "123 Beach Rd",
      checkInDate: "2026-09-09",
      checkOutDate: "2026-09-13",
      checkInTime: "15:00",
      checkOutTime: "11:00",
    });
    lodgingId = item.id;
    expect(item.type).toBe("lodging");
    expect(item.title).toBe("Beach House");
    expect(item.sleeps).toBe("8");
    // The date/time split: dates land in *_date, clock time in *_time.
    expect(item.check_in_date).toBe("2026-09-09");
    expect(item.check_in_time).toBe("15:00");
  });

  it("create — planner can create a transport item", async () => {
    const caller = ctx.callerAs("planner");
    const item = await caller.logistics.create({
      tripId,
      type: "transport",
      title: "Airport Shuttle",
      transportType: "shuttle",
      pickupLocation: "Terminal B",
      pickupTime: "2:30 PM",
    });
    transportId = item.id;
    expect(item.type).toBe("transport");
    expect(item.transport_type).toBe("shuttle");
  });

  it("create — planner can create a general item", async () => {
    const caller = ctx.callerAs("planner");
    const item = await caller.logistics.create({
      tripId,
      type: "general",
      title: "Grocery Run",
      link: "Costco on Friday afternoon",
    });
    generalId = item.id;
    expect(item.type).toBe("general");
    expect(item.link).toBe("Costco on Friday afternoon");
  });

  it("create — member cannot create", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.logistics.create({
        tripId,
          type: "general",
        title: "Sneaky item",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ── list ──────────────────────────────────────────────────────────────

  it("list — member can view all logistics items", async () => {
    const caller = ctx.callerAs("member");
    const items = await caller.logistics.list({ tripId });
    expect(items.length).toBe(3);
    const types = items.map((i: { type: string }) => i.type).sort();
    expect(types).toEqual(["general", "lodging", "transport"]);
  });

  // ── update ────────────────────────────────────────────────────────────

  it("update — planner can update an item", async () => {
    const caller = ctx.callerAs("planner");
    const updated = await caller.logistics.update({
      tripId,
      itemId: lodgingId,
      checkInTime: "4:00 PM",
    });
    expect(updated.check_in_time).toBe("4:00 PM");
  });

  it("update — member cannot update", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.logistics.update({
        tripId,
        itemId: lodgingId,
        title: "Hacked",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ── remove ────────────────────────────────────────────────────────────

  it("remove — planner can remove an item", async () => {
    const caller = ctx.callerAs("planner");
    const result = await caller.logistics.remove({ tripId, itemId: generalId });
    expect(result.success).toBe(true);

    const items = await caller.logistics.list({ tripId });
    expect(items.length).toBe(2);
  });

  it("remove — member cannot remove", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.logistics.remove({ tripId, itemId: transportId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
