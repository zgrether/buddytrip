import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * EVERY TEST BUILDS THE IDEA IT USES (#1527). This file used to share one idea
 * created by the first case — update, both vote toggles and remove all acted on
 * it — so a failure early failed the rest as if behaviour broke, and "toggle
 * off" only meant anything if "toggle on" had run first. Shuffled order surfaced
 * 5 such dependencies.
 */

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});

afterAll(async () => {
  await ctx.cleanup();
});

async function crewTrip(label: string): Promise<string> {
  const tripId = await ctx.createTrip(`Ideas ${label}`);
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  return tripId;
}

/** A crew trip with one idea the owner created. */
async function ideaTrip(label: string) {
  const tripId = await crewTrip(label);
  const idea = await ctx.caller().ideas.create({ tripId, id: genId("idea"), title: "Scottsdale", location: "Scottsdale, AZ" });
  return { tripId, ideaId: idea.id as string };
}

async function listed(tripId: string) {
  return ctx.caller().ideas.list({ tripId });
}

describe("ideas router", () => {
  it("create — owner can create an idea", async () => {
    const tripId = await crewTrip("create-owner");
    const idea = await ctx.callerAs("owner").ideas.create({ tripId, id: genId("idea"), title: "Scottsdale", location: "Scottsdale, AZ" });
    expect(idea.title).toBe("Scottsdale");
    expect((await listed(tripId)).some((i: { id: string }) => i.id === idea.id)).toBe(true);
  });

  // Reversed by #786: proposing where the trip might go is Organizer work.
  it("create — planner (Organizer) CAN create", async () => {
    const tripId = await crewTrip("create-organizer");
    const idea = await ctx.callerAs("planner").ideas.create({ tripId, id: genId("idea"), title: "Organizer's idea", location: "Somewhere" });
    expect(idea.title).toBe("Organizer's idea");
  });

  it("create — member cannot create, and nothing is added", async () => {
    const tripId = await crewTrip("create-member");
    await expect(
      ctx.callerAs("member").ideas.create({ tripId, id: genId("idea"), title: "Nope", location: "Nowhere" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await listed(tripId)).toHaveLength(0);
  });

  it("list — any member can list ideas with votes", async () => {
    const { tripId, ideaId } = await ideaTrip("list");
    const ideas = await ctx.callerAs("member").ideas.list({ tripId });
    const idea = ideas.find((i: { id: string }) => i.id === ideaId);
    expect(idea).toBeDefined();
    expect(idea!.votes).toBeDefined();
  });

  it("update — planner can edit idea", async () => {
    const { tripId, ideaId } = await ideaTrip("update");
    const updated = await ctx.callerAs("planner").ideas.update({ tripId, ideaId, description: "Great golf destination" });
    expect(updated.description).toBe("Great golf destination");
  });

  it("vote — member can vote (toggle on)", async () => {
    const { tripId, ideaId } = await ideaTrip("vote-on");
    const result = await ctx.callerAs("member").ideas.vote({ tripId, ideaId });
    expect(result.voted).toBe(true);
  });

  it("vote — member can vote again (toggle off)", async () => {
    const { tripId, ideaId } = await ideaTrip("vote-off");
    const member = ctx.callerAs("member");
    expect((await member.ideas.vote({ tripId, ideaId })).voted).toBe(true); // premise: ON first
    const result = await member.ideas.vote({ tripId, ideaId });
    expect(result.voted).toBe(false);
  });

  // Reversed by #786: an idea is one unit of work, not a container.
  it("remove — planner (Organizer) CAN remove", async () => {
    const { tripId, ideaId } = await ideaTrip("remove-organizer");
    const result = await ctx.callerAs("planner").ideas.remove({ tripId, ideaId });
    expect(result.success).toBe(true);
    expect((await listed(tripId)).some((i: { id: string }) => i.id === ideaId)).toBe(false);
  });

  it("remove — owner can remove", async () => {
    const { tripId, ideaId } = await ideaTrip("remove-owner");
    expect((await listed(tripId)).some((i: { id: string }) => i.id === ideaId)).toBe(true); // premise
    const result = await ctx.callerAs("owner").ideas.remove({ tripId, ideaId });
    expect(result.success).toBe(true);
    expect((await listed(tripId)).some((i: { id: string }) => i.id === ideaId)).toBe(false);
  });
});
