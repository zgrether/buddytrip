import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;
let ideaId: string;

describe("ideas router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Ideas Test Trip");
    await ctx.addTripMember(tripId, "planner", "Organizer");
    await ctx.addTripMember(tripId, "member", "Member");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("create — owner can create an idea", async () => {
    const caller = ctx.callerAs("owner");
    const idea = await caller.ideas.create({
      tripId,
      id: genId("idea"),
      title: "Scottsdale",
      location: "Scottsdale, AZ",
    });
    ideaId = idea.id;
    expect(idea.title).toBe("Scottsdale");
  });

  it("create — planner cannot create", async () => {
    const caller = ctx.callerAs("planner");
    await expect(
      caller.ideas.create({
        tripId,
        id: genId("idea"),
        title: "Nope",
        location: "Nowhere",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("create — member cannot create", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.ideas.create({
        tripId,
        id: genId("idea"),
        title: "Nope",
        location: "Nowhere",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("list — any member can list ideas with votes", async () => {
    const caller = ctx.callerAs("member");
    const ideas = await caller.ideas.list({ tripId });
    expect(ideas.length).toBeGreaterThanOrEqual(1);
    expect(ideas[0].votes).toBeDefined();
  });

  it("update — planner can edit idea", async () => {
    const caller = ctx.callerAs("planner");
    const updated = await caller.ideas.update({
      tripId,
      ideaId,
      description: "Great golf destination",
    });
    expect(updated.description).toBe("Great golf destination");
  });

  it("vote — member can vote (toggle on)", async () => {
    const caller = ctx.callerAs("member");
    const result = await caller.ideas.vote({ tripId, ideaId });
    expect(result.voted).toBe(true);
  });

  it("vote — member can vote again (toggle off)", async () => {
    const caller = ctx.callerAs("member");
    const result = await caller.ideas.vote({ tripId, ideaId });
    expect(result.voted).toBe(false);
  });

  it("remove — planner cannot remove", async () => {
    const caller = ctx.callerAs("planner");
    await expect(
      caller.ideas.remove({ tripId, ideaId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("remove — owner can remove", async () => {
    const caller = ctx.callerAs("owner");
    const result = await caller.ideas.remove({ tripId, ideaId });
    expect(result.success).toBe(true);
  });
});
