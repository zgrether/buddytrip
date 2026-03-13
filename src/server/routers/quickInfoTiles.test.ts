import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;
let tileId: string;

describe("quickInfoTiles router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Tiles Test");
    await ctx.addTripMember(tripId, "planner", "Planner");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("create — owner can create a tile", async () => {
    const caller = ctx.caller();
    const tile = await caller.quickInfoTiles.create({
      tripId,
      id: genId("tile"),
      label: "Door Code",
      value: "4892",
    });
    expect(tile.label).toBe("Door Code");
    expect(tile.value).toBe("4892");
    tileId = tile.id;
  });

  it("create — planner cannot create (isOwner gate)", async () => {
    const caller = ctx.callerAs("planner");
    await expect(
      caller.quickInfoTiles.create({
        tripId,
        id: genId("tile"),
        label: "Wifi",
        value: "password123",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("list — any member can view tiles", async () => {
    const caller = ctx.callerAs("planner");
    const tiles = await caller.quickInfoTiles.list({ tripId });
    expect(tiles.length).toBeGreaterThanOrEqual(1);
  });

  it("update — owner can update a tile", async () => {
    const caller = ctx.caller();
    const updated = await caller.quickInfoTiles.update({
      tripId,
      tileId,
      value: "9999",
    });
    expect(updated.value).toBe("9999");
  });

  it("remove — owner can remove a tile", async () => {
    const caller = ctx.caller();
    const result = await caller.quickInfoTiles.remove({ tripId, tileId });
    expect(result.success).toBe(true);
  });
});
