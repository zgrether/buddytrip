import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;
let ideaId: string;
let archivedId: string;

describe("archivedIdeas router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Archived Ideas Test Trip");
    await ctx.addTripMember(tripId, "planner", "Planner");
    await ctx.addTripMember(tripId, "member", "Member");

    // Seed an idea on the trip to be archived.
    const owner = ctx.callerAs("owner");
    const idea = await owner.ideas.create({
      tripId,
      id: genId("idea"),
      title: "Bandon Dunes",
      location: "Bandon, OR",
      description: "Links golf on the Oregon coast",
      costTier: "$$$",
    });
    ideaId = idea.id;
  });

  afterAll(async () => {
    // Purge any archived ideas created during the test for the owner user.
    await ctx.admin
      .from("archived_ideas")
      .delete()
      .eq("user_id", ctx.user.id);
    await ctx.cleanup();
  });

  it("archive — owner can snapshot a trip idea into their archive", async () => {
    const caller = ctx.callerAs("owner");
    const archived = await caller.archivedIdeas.archive({ tripId, ideaId });
    expect(archived.title).toBe("Bandon Dunes");
    expect(archived.location).toBe("Bandon, OR");
    expect(archived.source_idea_id).toBe(ideaId);
    expect(archived.original_trip_id).toBe(tripId);
    expect(archived.original_trip_title).toBe("Archived Ideas Test Trip");
    archivedId = archived.id;
  });

  it("archive — planner cannot archive", async () => {
    const caller = ctx.callerAs("planner");
    await expect(
      caller.archivedIdeas.archive({ tripId, ideaId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("archive — member cannot archive", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.archivedIdeas.archive({ tripId, ideaId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("list — returns only the caller's archived ideas", async () => {
    const ownerResults = await ctx.callerAs("owner").archivedIdeas.list();
    expect(ownerResults.some((a) => a.id === archivedId)).toBe(true);

    const memberResults = await ctx.callerAs("member").archivedIdeas.list();
    expect(memberResults.some((a) => a.id === archivedId)).toBe(false);
  });

  it("remove — another user cannot delete my archived idea", async () => {
    const outsider = ctx.callerAs("member");
    const result = await outsider.archivedIdeas.remove({ archivedIdeaId: archivedId });
    // RLS silently no-ops the delete; verify the row still exists.
    expect(result.success).toBe(true);
    const still = await ctx.callerAs("owner").archivedIdeas.list();
    expect(still.some((a) => a.id === archivedId)).toBe(true);
  });

  it("remove — owner of the archive can delete it", async () => {
    const caller = ctx.callerAs("owner");
    const result = await caller.archivedIdeas.remove({ archivedIdeaId: archivedId });
    expect(result.success).toBe(true);
    const remaining = await caller.archivedIdeas.list();
    expect(remaining.some((a) => a.id === archivedId)).toBe(false);
  });
});
