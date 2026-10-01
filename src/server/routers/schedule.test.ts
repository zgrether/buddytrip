import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * EVERY TEST BUILDS THE ITEMS IT USES (#1527). This file used to create two
 * items in its first two cases and run every later case against them, so a
 * failure early failed the rest as if behaviour broke, and the refusal cases
 * could pass against items that were never created. Shuffled order surfaced 6
 * such dependencies.
 *
 * `scheduleTrip()` builds a trip with the crew and two items: A (tentative,
 * Oct 6) and B (confirmed, Oct 7).
 */

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});

afterAll(async () => {
  await ctx.cleanup();
});

async function crewTrip(label: string): Promise<string> {
  const tripId = await ctx.createTrip(`Schedule ${label}`);
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  return tripId;
}

async function scheduleTrip(label: string) {
  const tripId = await crewTrip(label);
  const planner = ctx.callerAs("planner");
  const a = await planner.schedule.create({
    tripId,
    title: "Dinner at The Grill",
    detail: "Reservation for 8",
    scheduledDate: "2026-10-06",
    scheduledTime: "19:00",
  });
  const b = await planner.schedule.create({
    tripId,
    title: "Tee Time at Pebble Beach",
    isConfirmed: true,
    scheduledDate: "2026-10-07",
    scheduledTime: "08:30",
  });
  return { tripId, itemAId: a.id as string, itemBId: b.id as string };
}

async function items(tripId: string) {
  return ctx.caller().schedule.list({ tripId });
}

describe("schedule router", () => {
  it("create — planner can create a tentative item", async () => {
    const tripId = await crewTrip("create-tentative");
    const item = await ctx.callerAs("planner").schedule.create({
      tripId,
      title: "Dinner at The Grill",
      detail: "Reservation for 8",
      scheduledDate: "2026-10-06",
      scheduledTime: "19:00",
    });
    expect(item.title).toBe("Dinner at The Grill");
    expect(item.is_confirmed).toBe(false);
  });

  it("create — planner can create a confirmed item", async () => {
    const tripId = await crewTrip("create-confirmed");
    const item = await ctx.callerAs("planner").schedule.create({
      tripId,
      title: "Tee Time at Pebble Beach",
      isConfirmed: true,
      scheduledDate: "2026-10-07",
      scheduledTime: "08:30",
    });
    expect(item.is_confirmed).toBe(true);
    expect(item.confirmed_by).toBeTruthy();
  });

  it("create — member cannot create, and nothing is added", async () => {
    const tripId = await crewTrip("create-member");
    await expect(
      ctx.callerAs("member").schedule.create({ tripId, title: "Sneaky item" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await items(tripId)).toHaveLength(0);
  });

  it("list — member can view all items", async () => {
    const { tripId } = await scheduleTrip("list");
    const list = await ctx.callerAs("member").schedule.list({ tripId });
    expect(list.length).toBe(2);
  });

  it("reorder — planner can reorder items", async () => {
    const { tripId, itemAId, itemBId } = await scheduleTrip("reorder");
    const planner = ctx.callerAs("planner");
    const result = await planner.schedule.reorder({ tripId, itemIds: [itemBId, itemAId] });
    expect(result.success).toBe(true);

    const list = await planner.schedule.list({ tripId });
    expect(list[0].id).toBe(itemBId);
    expect(list[0].sort_order).toBe(0);
    expect(list[1].id).toBe(itemAId);
    expect(list[1].sort_order).toBe(1);
  });

  it("reorder — member cannot reorder, and the order is unchanged", async () => {
    const { tripId, itemAId, itemBId } = await scheduleTrip("reorder-member");
    const before = (await items(tripId)).map((i: { id: string }) => i.id);
    expect(before).toHaveLength(2); // premise
    await expect(
      ctx.callerAs("member").schedule.reorder({ tripId, itemIds: [itemBId, itemAId] })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await items(tripId)).map((i: { id: string }) => i.id)).toEqual(before);
  });

  it("update — planner can update an item", async () => {
    const { tripId, itemAId } = await scheduleTrip("update");
    const updated = await ctx.callerAs("planner").schedule.update({
      tripId,
      itemId: itemAId,
      title: "Dinner at The Grill — Updated",
    });
    expect(updated.title).toBe("Dinner at The Grill — Updated");
  });

  it("remove — planner can remove an item, and only that one goes", async () => {
    const { tripId, itemAId, itemBId } = await scheduleTrip("remove");
    const result = await ctx.callerAs("planner").schedule.remove({ tripId, itemId: itemBId });
    expect(result.success).toBe(true);
    expect((await items(tripId)).map((i: { id: string }) => i.id)).toEqual([itemAId]);
  });

  it("remove — member cannot remove, and the item stays", async () => {
    const { tripId, itemAId } = await scheduleTrip("remove-member");
    await expect(
      ctx.callerAs("member").schedule.remove({ tripId, itemId: itemAId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await items(tripId)).some((i: { id: string }) => i.id === itemAId)).toBe(true);
  });
});
