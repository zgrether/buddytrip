import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * EVERY TEST BUILDS THE LODGING OPTION IT USES (#1527). This file used to share
 * one option created by the "create" case — update and remove acted on it — so a
 * failure there failed the rest as if behaviour broke, and the outsider's
 * update/remove refusals could pass against an id that was never created.
 * "Trip member can list" also asserted only `Array.isArray`, which an empty list
 * satisfies; it now requires the option it seeded.
 *
 * `lodgingTrip()` builds a trip with the member, two ideas, and one option on
 * the first idea.
 */

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});

afterAll(async () => {
  // ctx.cleanup() handles ideas + lodging options via cascade (ideas DELETE cascade)
  await ctx.cleanup();
});

async function ideasTrip(label: string) {
  const tripId = await ctx.createTrip(`Idea Lodging ${label}`);
  await ctx.addTripMember(tripId, "member", "Member");
  const owner = ctx.caller();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const idea1 = await owner.ideas.create({ tripId, id: `test-idea-${stamp}-a`, title: "Test Destination", location: "Test City", source: "manual" });
  const idea2 = await owner.ideas.create({ tripId, id: `test-idea-${stamp}-b`, title: "Other Destination", location: "Other City", source: "manual" });
  return { tripId, ideaId: idea1.id as string, ideaId2: idea2.id as string };
}

/** The same, with one "Beach House" option on the first idea, created by the owner. */
async function lodgingTrip(label: string) {
  const t = await ideasTrip(label);
  const item = await ctx.caller().ideaLodging.create({ ideaId: t.ideaId, tripId: t.tripId, name: "Beach House", sleeps: 8 });
  return { ...t, lodgingId: item.id as string };
}

async function options(ideaId: string) {
  return ctx.caller().ideaLodging.list({ ideaId });
}

describe("ideaLodging router", () => {
  it("list — trip member can list lodging options for an idea", async () => {
    const { ideaId, lodgingId } = await lodgingTrip("list");
    const items = await ctx.callerAs("member").ideaLodging.list({ ideaId });
    expect(items.some((i: { id: string }) => i.id === lodgingId)).toBe(true);
  });

  it("list — non-trip-member cannot list (idea hidden or forbidden)", async () => {
    const { ideaId } = await lodgingTrip("list-outsider");
    // Outsider either gets NOT_FOUND (RLS hides the idea) or FORBIDDEN (member check).
    // Both are acceptable security outcomes.
    await expect(
      ctx.callerAs("outsider").ideaLodging.list({ ideaId })
    ).rejects.toSatisfy((e: { code: string }) => e.code === "FORBIDDEN" || e.code === "NOT_FOUND");
  });

  it("create — trip member can create a lodging option", async () => {
    const { tripId, ideaId } = await ideasTrip("create");
    const item = await ctx.callerAs("member").ideaLodging.create({
      ideaId,
      tripId,
      name: "Beach House",
      source: "vrbo",
      sleeps: 8,
      priceNote: "~$2,000 total",
      url: "https://vrbo.com/123",
    });
    expect(item.name).toBe("Beach House");
    expect(item.source).toBe("vrbo");
    expect(item.sleeps).toBe(8);
    expect(item.price_note).toBe("~$2,000 total");
    expect(item.url).toBe("https://vrbo.com/123");
    expect(item.idea_id).toBe(ideaId);
  });

  it("create — non-trip-member cannot create, and nothing is added", async () => {
    const { tripId, ideaId } = await ideasTrip("create-outsider");
    await expect(
      ctx.callerAs("outsider").ideaLodging.create({ ideaId, tripId, name: "Sneaky House" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await options(ideaId)).toHaveLength(0);
  });

  it("update — trip member can update a lodging option", async () => {
    const { tripId, lodgingId } = await lodgingTrip("update");
    const updated = await ctx.callerAs("member").ideaLodging.update({ id: lodgingId, tripId, name: "Beach House Updated", sleeps: 10 });
    expect(updated.name).toBe("Beach House Updated");
    expect(updated.sleeps).toBe(10);
  });

  it("update — non-trip-member cannot update, and the option is unchanged", async () => {
    const { tripId, ideaId, lodgingId } = await lodgingTrip("update-outsider");
    await expect(
      ctx.callerAs("outsider").ideaLodging.update({ id: lodgingId, tripId, name: "Hacked" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await options(ideaId)).find((i: { id: string }) => i.id === lodgingId)?.name).toBe("Beach House");
  });

  it("list — returns only options for the queried idea", async () => {
    const { tripId, ideaId, ideaId2 } = await lodgingTrip("isolation");
    await ctx.caller().ideaLodging.create({ ideaId: ideaId2, tripId, name: "Mountain Cabin" });

    const items1 = await options(ideaId);
    const items2 = await options(ideaId2);
    // Premise: BOTH ideas have an option, so the isolation is between two
    // non-empty lists rather than trivially true of an empty one.
    expect(items1.length).toBeGreaterThan(0);
    expect(items2.length).toBeGreaterThan(0);
    expect(items1.every((i: { idea_id: string }) => i.idea_id === ideaId)).toBe(true);
    expect(items2.every((i: { idea_id: string }) => i.idea_id === ideaId2)).toBe(true);
    expect(items1.some((i: { name: string }) => i.name === "Mountain Cabin")).toBe(false);
    expect(items2.some((i: { name: string }) => i.name === "Mountain Cabin")).toBe(true);
  });

  it("remove — trip member can remove a lodging option", async () => {
    const { tripId, ideaId, lodgingId } = await lodgingTrip("remove");
    expect((await options(ideaId)).some((i: { id: string }) => i.id === lodgingId)).toBe(true); // premise
    const result = await ctx.callerAs("member").ideaLodging.remove({ id: lodgingId, tripId });
    expect(result.success).toBe(true);
    expect((await options(ideaId)).some((i: { id: string }) => i.id === lodgingId)).toBe(false);
  });

  it("remove — non-trip-member cannot remove, and the option stays", async () => {
    const { tripId, ideaId, lodgingId } = await lodgingTrip("remove-outsider");
    await expect(
      ctx.callerAs("outsider").ideaLodging.remove({ id: lodgingId, tripId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await options(ideaId)).some((i: { id: string }) => i.id === lodgingId)).toBe(true);
  });
});
