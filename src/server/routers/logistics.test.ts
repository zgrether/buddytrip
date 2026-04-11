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
    await ctx.addTripMember(tripId, "planner", "Planner");
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
      label: "Beach House",
      propertyName: "Oceanfront Villa",
      address: "123 Beach Rd",
      checkInTime: "3:00 PM",
      checkOutTime: "11:00 AM",
    });
    lodgingId = item.id;
    expect(item.type).toBe("lodging");
    expect(item.property_name).toBe("Oceanfront Villa");
  });

  it("create — planner can create a transport item", async () => {
    const caller = ctx.callerAs("planner");
    const item = await caller.logistics.create({
      tripId,
      type: "transport",
      label: "Airport Shuttle",
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
      label: "Grocery Run",
      detail: "Costco on Friday afternoon",
    });
    generalId = item.id;
    expect(item.type).toBe("general");
    expect(item.detail).toBe("Costco on Friday afternoon");
  });

  it("create — member cannot create", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.logistics.create({
        tripId,
          type: "general",
        label: "Sneaky item",
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
        label: "Hacked",
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
