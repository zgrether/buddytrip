import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;
let seriesId: string;

describe("series router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Series Link Test");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("create — user can create a series", async () => {
    const caller = ctx.caller();
    const s = await caller.series.create({
      id: genId("series"),
      name: "BT",
      fullName: "Buddy Trip Series",
      years: "2024-2026",
    });
    seriesId = s.id;
    ctx.trackSeries(seriesId);
    expect(s.owner_id).toBe(ctx.user.id);
  });

  it("list — owner sees their series", async () => {
    const caller = ctx.caller();
    const list = await caller.series.list();
    expect(list.some((s: { id: string }) => s.id === seriesId)).toBe(true);
  });

  it("list — other user does not see it", async () => {
    const caller = ctx.callerAs("member");
    const list = await caller.series.list();
    expect(list.some((s: { id: string }) => s.id === seriesId)).toBe(false);
  });

  it("linkTrip — owner can link a trip", async () => {
    const caller = ctx.caller();
    const trip = await caller.series.linkTrip({ seriesId, tripId });
    expect(trip.series_id).toBe(seriesId);
  });

  it("linkTrip — non-owner cannot link", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.series.linkTrip({ seriesId, tripId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("transferOwnership — owner can transfer", async () => {
    const other = ctx.getUser("member");
    const caller = ctx.caller();
    const s = await caller.series.transferOwnership({
      seriesId,
      newOwnerId: other.id,
    });
    expect(s.owner_id).toBe(other.id);
  });

  it("transferOwnership — previous owner can no longer transfer", async () => {
    const caller = ctx.caller();
    await expect(
      caller.series.transferOwnership({
        seriesId,
        newOwnerId: ctx.user.id,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
