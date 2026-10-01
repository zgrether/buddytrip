import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * EVERY TEST BUILDS THE ARCHIVE IT USES (#1527). This file used to archive one
 * idea in its first case and run list / remove against that copy, so a failure
 * early failed the rest as if behaviour broke. Shuffled order surfaced 3 such
 * dependencies.
 *
 * `archived_ideas` is USER-scoped (list returns the caller's own), so each case
 * gets its own trip + idea, and its own archived copy where it needs one.
 */

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});

afterAll(async () => {
  // Purge any archived ideas created during the test for the owner user.
  await ctx.admin.from("archived_ideas").delete().eq("user_id", ctx.user.id);
  await ctx.cleanup();
});

/** A crew trip with one idea, "Bandon Dunes", created by the owner. */
async function ideaTrip(label: string) {
  const title = `Archived Ideas ${label}`;
  const tripId = await ctx.createTrip(title);
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  const idea = await ctx.callerAs("owner").ideas.create({
    tripId,
    id: genId("idea"),
    title: "Bandon Dunes",
    location: "Bandon, OR",
    description: "Links golf on the Oregon coast",
    costTier: "$$$",
  });
  return { tripId, title, ideaId: idea.id as string };
}

/** The same, archived by the owner. */
async function ownerArchive(label: string) {
  const t = await ideaTrip(label);
  const archived = await ctx.callerAs("owner").archivedIdeas.archive({ tripId: t.tripId, ideaId: t.ideaId });
  return { ...t, archivedId: archived.id as string };
}

async function ownerHas(archivedId: string): Promise<boolean> {
  return (await ctx.callerAs("owner").archivedIdeas.list()).some((a) => a.id === archivedId);
}

describe("archivedIdeas router", () => {
  it("archive — owner can snapshot a trip idea into their archive", async () => {
    const { tripId, title, ideaId } = await ideaTrip("snapshot");
    const archived = await ctx.callerAs("owner").archivedIdeas.archive({ tripId, ideaId });
    expect(archived.title).toBe("Bandon Dunes");
    expect(archived.location).toBe("Bandon, OR");
    expect(archived.source_idea_id).toBe(ideaId);
    expect(archived.original_trip_id).toBe(tripId);
    expect(archived.original_trip_title).toBe(title);
  });

  // Reversed by #786, in lockstep with ideas.remove — archiving is the step
  // before removing, so the two must not sit on different tiers.
  it("archive — planner (Organizer) CAN archive", async () => {
    const { tripId, ideaId } = await ideaTrip("organizer");
    const archived = await ctx.callerAs("planner").archivedIdeas.archive({ tripId, ideaId });
    expect(archived.id).toBeTruthy();
    await ctx.admin.from("archived_ideas").delete().eq("id", archived.id);
  });

  it("archive — member cannot archive, and nothing is archived", async () => {
    const { tripId, ideaId } = await ideaTrip("member");
    const before = (await ctx.callerAs("member").archivedIdeas.list()).length;
    await expect(
      ctx.callerAs("member").archivedIdeas.archive({ tripId, ideaId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await ctx.callerAs("member").archivedIdeas.list()).length).toBe(before);
  });

  it("list — returns only the caller's archived ideas", async () => {
    const { archivedId } = await ownerArchive("list");
    expect(await ownerHas(archivedId)).toBe(true); // also the control for the absence below
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
    const { archivedId } = await ownerArchive("remove-other");
    expect(await ownerHas(archivedId)).toBe(true); // premise
    await expect(
      ctx.callerAs("member").archivedIdeas.remove({ archivedIdeaId: archivedId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await ownerHas(archivedId)).toBe(true);
  });

  it("remove — owner of the archive can delete it", async () => {
    const { archivedId } = await ownerArchive("remove-own");
    expect(await ownerHas(archivedId)).toBe(true); // premise
    const result = await ctx.callerAs("owner").archivedIdeas.remove({ archivedIdeaId: archivedId });
    expect(result.success).toBe(true);
    expect(await ownerHas(archivedId)).toBe(false);
  });
});
