import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * EVERY TEST BUILDS THE TILE IT USES (#1527). This file used to share one tile
 * created by the first case — update and remove acted on it — so a failure
 * early failed the rest as if behaviour broke. Shuffled order surfaced 2 such
 * dependencies.
 *
 * Quick Info lives in the trip-header dock and is curated by Owner+Organizer;
 * members are read-only.
 */

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});

afterAll(async () => {
  await ctx.cleanup();
});

async function crewTrip(label: string): Promise<string> {
  const tripId = await ctx.createTrip(`Tiles ${label}`);
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  return tripId;
}

/** A crew trip with one tile the owner created ("Door Code" / 4892 / lock). */
async function tileTrip(label: string) {
  const tripId = await crewTrip(label);
  const tile = await ctx.caller().quickInfoTiles.create({ tripId, id: genId("tile"), label: "Door Code", value: "4892", icon: "lock" });
  return { tripId, tileId: tile.id as string };
}

async function tiles(tripId: string) {
  return ctx.caller().quickInfoTiles.list({ tripId });
}

describe("quickInfoTiles router", () => {
  it("create — owner can create a tile (with explicit icon)", async () => {
    const tripId = await crewTrip("create-owner");
    const tile = await ctx.caller().quickInfoTiles.create({ tripId, id: genId("tile"), label: "Door Code", value: "4892", icon: "lock" });
    expect(tile.label).toBe("Door Code");
    expect(tile.value).toBe("4892");
    expect(tile.icon).toBe("lock");
  });

  it("create — planner can create (Owner/organizer permission)", async () => {
    const tripId = await crewTrip("create-organizer");
    const tile = await ctx.callerAs("planner").quickInfoTiles.create({ tripId, id: genId("tile"), label: "Wifi", value: "password123" });
    expect(tile.label).toBe("Wifi");
  });

  it("create — plain member cannot create, and nothing is added", async () => {
    const tripId = await crewTrip("create-member");
    await expect(
      ctx.callerAs("member").quickInfoTiles.create({ tripId, id: genId("tile"), label: "Address", value: "42 Oak" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await tiles(tripId)).toHaveLength(0);
  });

  it("list — any member can view tiles", async () => {
    const { tripId, tileId } = await tileTrip("list");
    const list = await ctx.callerAs("member").quickInfoTiles.list({ tripId });
    expect(list.some((t: { id: string }) => t.id === tileId)).toBe(true);
  });

  it("update — planner can update a tile (including icon)", async () => {
    const { tripId, tileId } = await tileTrip("update");
    const updated = await ctx.callerAs("planner").quickInfoTiles.update({ tripId, tileId, value: "9999", icon: "key" });
    expect(updated.value).toBe("9999");
    expect(updated.icon).toBe("key");
  });

  it("remove — owner can remove a tile, and it is gone", async () => {
    const { tripId, tileId } = await tileTrip("remove");
    expect((await tiles(tripId)).some((t: { id: string }) => t.id === tileId)).toBe(true); // premise
    const result = await ctx.caller().quickInfoTiles.remove({ tripId, tileId });
    expect(result.success).toBe(true);
    expect((await tiles(tripId)).some((t: { id: string }) => t.id === tileId)).toBe(false);
  });
});
