import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * EVERY TEST BUILDS THE ITEMS IT USES (#1527). This file used to create three
 * items in its first three cases and run everything later against them — "list"
 * expected exactly those three — so a failure early failed the rest as if
 * behaviour broke, and the refusal cases could pass against items that were
 * never created. Shuffled order surfaced 5 such dependencies.
 *
 * `logisticsTrip()` builds a trip with the crew and one item of each type.
 */

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});

afterAll(async () => {
  await ctx.cleanup();
});

async function crewTrip(label: string): Promise<string> {
  const tripId = await ctx.createTrip(`Logistics ${label}`);
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  return tripId;
}

async function logisticsTrip(label: string) {
  const tripId = await crewTrip(label);
  const planner = ctx.callerAs("planner");
  const lodging = await planner.logistics.create({ tripId, type: "lodging", title: "Beach House", checkInTime: "15:00" });
  const transport = await planner.logistics.create({ tripId, type: "transport", title: "Airport Shuttle", transportType: "shuttle" });
  const general = await planner.logistics.create({ tripId, type: "general", title: "Grocery Run" });
  return { tripId, lodgingId: lodging.id as string, transportId: transport.id as string, generalId: general.id as string };
}

async function items(tripId: string) {
  return ctx.caller().logistics.list({ tripId });
}

describe("logistics router", () => {
  it("create — planner can create a lodging item", async () => {
    const tripId = await crewTrip("create-lodging");
    const item = await ctx.callerAs("planner").logistics.create({
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
    expect(item.type).toBe("lodging");
    expect(item.title).toBe("Beach House");
    expect(item.sleeps).toBe("8");
    // The date/time split: dates land in *_date, clock time in *_time.
    expect(item.check_in_date).toBe("2026-09-09");
    expect(item.check_in_time).toBe("15:00");
  });

  it("create — planner can create a transport item", async () => {
    const tripId = await crewTrip("create-transport");
    const item = await ctx.callerAs("planner").logistics.create({
      tripId,
      type: "transport",
      title: "Airport Shuttle",
      transportType: "shuttle",
      pickupLocation: "Terminal B",
      pickupTime: "2:30 PM",
    });
    expect(item.type).toBe("transport");
    expect(item.transport_type).toBe("shuttle");
  });

  it("create — planner can create a general item", async () => {
    const tripId = await crewTrip("create-general");
    const item = await ctx.callerAs("planner").logistics.create({
      tripId,
      type: "general",
      title: "Grocery Run",
      link: "Costco on Friday afternoon",
    });
    expect(item.type).toBe("general");
    expect(item.link).toBe("Costco on Friday afternoon");
  });

  it("create — member cannot create, and nothing is added", async () => {
    const tripId = await crewTrip("create-member");
    await expect(
      ctx.callerAs("member").logistics.create({ tripId, type: "general", title: "Sneaky item" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await items(tripId)).toHaveLength(0);
  });

  it("list — member can view all logistics items", async () => {
    const { tripId } = await logisticsTrip("list");
    const list = await ctx.callerAs("member").logistics.list({ tripId });
    expect(list.length).toBe(3);
    expect(list.map((i: { type: string }) => i.type).sort()).toEqual(["general", "lodging", "transport"]);
  });

  it("update — planner can update an item", async () => {
    const { tripId, lodgingId } = await logisticsTrip("update");
    const updated = await ctx.callerAs("planner").logistics.update({ tripId, itemId: lodgingId, checkInTime: "4:00 PM" });
    expect(updated.check_in_time).toBe("4:00 PM");
  });

  it("update — member cannot update, and the item is unchanged", async () => {
    const { tripId, lodgingId } = await logisticsTrip("update-member");
    await expect(
      ctx.callerAs("member").logistics.update({ tripId, itemId: lodgingId, title: "Hacked" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const lodging = (await items(tripId)).find((i: { id: string }) => i.id === lodgingId);
    expect(lodging?.title).toBe("Beach House");
  });

  it("remove — planner can remove an item, and only that one goes", async () => {
    const { tripId, lodgingId, transportId, generalId } = await logisticsTrip("remove");
    const result = await ctx.callerAs("planner").logistics.remove({ tripId, itemId: generalId });
    expect(result.success).toBe(true);
    expect((await items(tripId)).map((i: { id: string }) => i.id).sort()).toEqual([lodgingId, transportId].sort());
  });

  it("remove — member cannot remove, and the item stays", async () => {
    const { tripId, transportId } = await logisticsTrip("remove-member");
    await expect(
      ctx.callerAs("member").logistics.remove({ tripId, itemId: transportId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await items(tripId)).some((i: { id: string }) => i.id === transportId)).toBe(true);
  });
});
