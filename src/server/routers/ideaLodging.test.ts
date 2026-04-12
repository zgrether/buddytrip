import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;
let ideaId: string;
let ideaId2: string;
let lodgingId: string;

describe("ideaLodging router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Idea Lodging Test");
    await ctx.addTripMember(tripId, "member", "Member");

    // Create a test idea via owner tRPC caller (correct way, populates all fields)
    const ownerCaller = ctx.caller();
    const id1 = `test-idea-${Date.now()}-a`;
    const created = await ownerCaller.ideas.create({
      tripId,
      id: id1,
      title: "Test Destination",
      location: "Test City",
      source: "manual",
    });
    ideaId = created.id;

    // Create a second idea in the same trip (for isolation test)
    const id2 = `test-idea-${Date.now()}-b`;
    const created2 = await ownerCaller.ideas.create({
      tripId,
      id: id2,
      title: "Other Destination",
      location: "Other City",
      source: "manual",
    });
    ideaId2 = created2.id;
  });

  afterAll(async () => {
    // ctx.cleanup() handles ideas + lodging options via cascade (ideas DELETE cascade)
    await ctx.cleanup();
  });

  // ── list ──────────────────────────────────────────────────────────────

  it("list — trip member can list lodging options for an idea", async () => {
    const caller = ctx.callerAs("member");
    const items = await caller.ideaLodging.list({ ideaId });
    expect(Array.isArray(items)).toBe(true);
  });

  it("list — non-trip-member cannot list (idea hidden or forbidden)", async () => {
    const caller = ctx.callerAs("outsider");
    // Outsider either gets NOT_FOUND (RLS hides the idea) or FORBIDDEN (member check).
    // Both are acceptable security outcomes.
    await expect(
      caller.ideaLodging.list({ ideaId })
    ).rejects.toSatisfy((e: { code: string }) =>
      e.code === "FORBIDDEN" || e.code === "NOT_FOUND"
    );
  });

  // ── create ────────────────────────────────────────────────────────────

  it("create — trip member can create a lodging option", async () => {
    const caller = ctx.callerAs("member");
    const item = await caller.ideaLodging.create({
      ideaId,
      tripId,
      name: "Beach House",
      source: "vrbo",
      sleeps: 8,
      priceNote: "~$2,000 total",
      url: "https://vrbo.com/123",
    });
    lodgingId = item.id;
    expect(item.name).toBe("Beach House");
    expect(item.source).toBe("vrbo");
    expect(item.sleeps).toBe(8);
    expect(item.price_note).toBe("~$2,000 total");
    expect(item.url).toBe("https://vrbo.com/123");
    expect(item.idea_id).toBe(ideaId);
  });

  it("create — non-trip-member cannot create", async () => {
    const caller = ctx.callerAs("outsider");
    await expect(
      caller.ideaLodging.create({
        ideaId,
        tripId,
        name: "Sneaky House",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ── update ────────────────────────────────────────────────────────────

  it("update — trip member can update a lodging option", async () => {
    const caller = ctx.callerAs("member");
    const updated = await caller.ideaLodging.update({
      id: lodgingId,
      tripId,
      name: "Beach House Updated",
      sleeps: 10,
    });
    expect(updated.name).toBe("Beach House Updated");
    expect(updated.sleeps).toBe(10);
  });

  it("update — non-trip-member cannot update", async () => {
    const caller = ctx.callerAs("outsider");
    await expect(
      caller.ideaLodging.update({
        id: lodgingId,
        tripId,
        name: "Hacked",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ── list isolation ────────────────────────────────────────────────────

  it("list — returns only options for the queried idea", async () => {
    const caller = ctx.caller();

    // Add a lodging option to idea2 as well
    await caller.ideaLodging.create({
      ideaId: ideaId2,
      tripId,
      name: "Mountain Cabin",
    });

    const items1 = await caller.ideaLodging.list({ ideaId });
    const items2 = await caller.ideaLodging.list({ ideaId: ideaId2 });

    expect(items1.every((i: { idea_id: string }) => i.idea_id === ideaId)).toBe(true);
    expect(items2.every((i: { idea_id: string }) => i.idea_id === ideaId2)).toBe(true);
    expect(items1.some((i: { name: string }) => i.name === "Mountain Cabin")).toBe(false);
    expect(items2.some((i: { name: string }) => i.name === "Mountain Cabin")).toBe(true);
  });

  // ── remove ────────────────────────────────────────────────────────────

  it("remove — trip member can remove a lodging option", async () => {
    const caller = ctx.callerAs("member");
    const result = await caller.ideaLodging.remove({ id: lodgingId, tripId });
    expect(result.success).toBe(true);

    const items = await caller.ideaLodging.list({ ideaId });
    expect(items.some((i: { id: string }) => i.id === lodgingId)).toBe(false);
  });

  it("remove — non-trip-member cannot remove", async () => {
    // Create a fresh option to attempt removing
    const owner = ctx.caller();
    const item = await owner.ideaLodging.create({
      ideaId,
      tripId,
      name: "To Be Kept",
    });

    const caller = ctx.callerAs("outsider");
    await expect(
      caller.ideaLodging.remove({ id: item.id, tripId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
