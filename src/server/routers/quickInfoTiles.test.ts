import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;
let tileId: string;

describe("quickInfoTiles router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Tiles Test");
    await ctx.addTripMember(tripId, "planner", "Organizer");
    await ctx.addTripMember(tripId, "member", "Member");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // Quick Info now lives in the trip-header dock and is curated by
  // Owner+Organizer ("Owner/organizer" per the redesign spec). Members are
  // still read-only.

  it("create — owner can create a tile (with explicit icon)", async () => {
    const caller = ctx.caller();
    const tile = await caller.quickInfoTiles.create({
      tripId,
      id: genId("tile"),
      label: "Door Code",
      value: "4892",
      icon: "lock",
    });
    expect(tile.label).toBe("Door Code");
    expect(tile.value).toBe("4892");
    expect(tile.icon).toBe("lock");
    tileId = tile.id;
  });

  it("create — planner can create (Owner/organizer permission)", async () => {
    const caller = ctx.callerAs("planner");
    const tile = await caller.quickInfoTiles.create({
      tripId,
      id: genId("tile"),
      label: "Wifi",
      value: "password123",
    });
    expect(tile.label).toBe("Wifi");
  });

  it("create — plain member cannot create", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.quickInfoTiles.create({
        tripId,
        id: genId("tile"),
        label: "Address",
        value: "42 Oak",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("list — any member can view tiles", async () => {
    const caller = ctx.callerAs("member");
    const tiles = await caller.quickInfoTiles.list({ tripId });
    expect(tiles.length).toBeGreaterThanOrEqual(1);
  });

  it("update — planner can update a tile (including icon)", async () => {
    const caller = ctx.callerAs("planner");
    const updated = await caller.quickInfoTiles.update({
      tripId,
      tileId,
      value: "9999",
      icon: "key",
    });
    expect(updated.value).toBe("9999");
    expect(updated.icon).toBe("key");
  });

  it("remove — owner can remove a tile", async () => {
    const caller = ctx.caller();
    const result = await caller.quickInfoTiles.remove({ tripId, tileId });
    expect(result.success).toBe(true);
  });
});
