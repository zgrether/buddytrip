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
    await ctx.addTripMember(tripId, "planner", "Organizer");
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

  // Reversed by #786, in lockstep with ideas.remove — archiving is the step
  // before removing, so the two must not sit on different tiers.
  it("archive — planner (Organizer) CAN archive", async () => {
    const caller = ctx.callerAs("planner");
    const archived = await caller.archivedIdeas.archive({ tripId, ideaId });
    expect(archived.id).toBeTruthy();
    await ctx.admin.from("archived_ideas").delete().eq("id", archived.id);
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

  it("remove — another user cannot delete my archived idea, and is TOLD so", async () => {
    // Reversed by #781, and this test is the proof the change works. It used to
    // assert `result.success === true` with the comment "RLS silently no-ops the
    // delete" — i.e. it pinned the exact silence being removed: a foreign id
    // reported success. `archived_ideas` is USER-SCOPED, so there is no second
    // actor who could legitimately have removed the row first; zero rows can only
    // mean a stale or foreign id.
    //
    // Both halves still matter: the caller now gets NOT_FOUND (observable), AND
    // the row survives (nothing was destroyed). Asserting only the throw would
    // pass even if the delete had leaked.
    const outsider = ctx.callerAs("member");
    await expect(
      outsider.archivedIdeas.remove({ archivedIdeaId: archivedId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

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
