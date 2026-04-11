import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;
let itemAId: string;
let itemBId: string;

describe("schedule router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Schedule Test");
    await ctx.addTripMember(tripId, "planner", "Planner");
    await ctx.addTripMember(tripId, "member", "Member");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // ── create ────────────────────────────────────────────────────────────

  it("create — planner can create a tentative item", async () => {
    const caller = ctx.callerAs("planner");
    const item = await caller.schedule.create({
      tripId,
      title: "Dinner at The Grill",
      detail: "Reservation for 8",
      scheduledDate: "2026-10-06",
      scheduledTime: "19:00",
    });
    itemAId = item.id;
    expect(item.title).toBe("Dinner at The Grill");
    expect(item.is_confirmed).toBe(false);
  });

  it("create — planner can create a confirmed item", async () => {
    const caller = ctx.callerAs("planner");
    const item = await caller.schedule.create({
      tripId,
      title: "Tee Time at Pebble Beach",
      isConfirmed: true,
      scheduledDate: "2026-10-07",
      scheduledTime: "08:30",
    });
    itemBId = item.id;
    expect(item.is_confirmed).toBe(true);
    expect(item.confirmed_by).toBeTruthy();
  });

  it("create — member cannot create", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.schedule.create({ tripId, title: "Sneaky item" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ── list ──────────────────────────────────────────────────────────────

  it("list — member can view all items", async () => {
    const caller = ctx.callerAs("member");
    const items = await caller.schedule.list({ tripId });
    expect(items.length).toBe(2);
  });

  // ── confirm ───────────────────────────────────────────────────────────

  it("confirm — planner can confirm a tentative item", async () => {
    const caller = ctx.callerAs("planner");
    const confirmed = await caller.schedule.confirm({ tripId, itemId: itemAId });
    expect(confirmed.is_confirmed).toBe(true);
    expect(confirmed.confirmed_at).toBeTruthy();
  });

  it("confirm — member cannot confirm", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.schedule.confirm({ tripId, itemId: itemAId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ── reorder ───────────────────────────────────────────────────────────

  it("reorder — planner can reorder items", async () => {
    const caller = ctx.callerAs("planner");
    // Reverse the order: B first, then A
    const result = await caller.schedule.reorder({
      tripId,
      itemIds: [itemBId, itemAId],
    });
    expect(result.success).toBe(true);

    // Verify order
    const items = await caller.schedule.list({ tripId });
    expect(items[0].id).toBe(itemBId);
    expect(items[0].sort_order).toBe(0);
    expect(items[1].id).toBe(itemAId);
    expect(items[1].sort_order).toBe(1);
  });

  it("reorder — member cannot reorder", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.schedule.reorder({ tripId, itemIds: [itemAId, itemBId] })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ── update ────────────────────────────────────────────────────────────

  it("update — planner can update an item", async () => {
    const caller = ctx.callerAs("planner");
    const updated = await caller.schedule.update({
      tripId,
      itemId: itemAId,
      title: "Dinner at The Grill — Updated",
    });
    expect(updated.title).toBe("Dinner at The Grill — Updated");
  });

  // ── remove ────────────────────────────────────────────────────────────

  it("remove — planner can remove an item", async () => {
    const caller = ctx.callerAs("planner");
    const result = await caller.schedule.remove({ tripId, itemId: itemBId });
    expect(result.success).toBe(true);

    const items = await caller.schedule.list({ tripId });
    expect(items.length).toBe(1);
  });

  it("remove — member cannot remove", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.schedule.remove({ tripId, itemId: itemAId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
