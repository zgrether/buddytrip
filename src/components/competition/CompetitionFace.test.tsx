import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * CompetitionFace — data-layer integration tests.
 *
 * The face + sibling panels are pure presentational React; React Testing
 * Library + jsdom aren't yet in this repo, so we cover the spec matrix through
 * the data layer that drives each render branch (competition metadata, the
 * teams/games/assignments the setup guide + leaderboard read).
 *
 * Matrix:
 *   - Header reads metadata                → "header reads name + tagline"
 *   - Delete reachable for the owner       → "delete gating"
 *   - Contests are `games` now             → "(Teams, Games) all resolve"
 */

let ctx: TestContext;

/**
 * EVERY CASE BUILDS ITS OWN TRIP (#1527). The cases shared one: "header reads
 * name + tagline" CREATED its cup, and the no-competition case asserted the
 * trip had none while the panel cases read the cup the header case made.
 * Shuffled, the no-competition case met that cup and the panel cases met none.
 */
async function faceTrip(label: string): Promise<string> {
  const tripId = await ctx.createTrip(`CompTab ${label}`);
  await ctx.addTripMember(tripId, "member", "Member");
  return tripId;
}

/** A trip with a cup made through the real create — which seeds Team A / Team B. */
async function createdCup(label: string, name = "Header Cup") {
  const tripId = await faceTrip(label);
  const created = await ctx.caller().competitions.create({ tripId, name, tagline: "First Past the Post" });
  ctx.trackCompetition(created.id);
  return { tripId, competitionId: created.id as string };
}

describe("CompetitionFace data layer", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("no competition state — getByTrip returns null", async () => {
    const tripId = await faceTrip("none");
    const competition = await ctx.caller().competitions.getByTrip({ tripId });
    expect(competition).toBeNull();
  });

  it("competition exists — header reads name + tagline", async () => {
    const { tripId, competitionId } = await createdCup("header");
    const fetched = await ctx.caller().competitions.getByTrip({ tripId });
    expect(fetched?.id).toBe(competitionId);
    expect(fetched?.name).toBe("Header Cup");
    expect(fetched?.tagline).toBe("First Past the Post");
  });

  it("competition exists — sibling panels (Teams, Games) all resolve", async () => {
    const { tripId, competitionId } = await createdCup("panels");
    const caller = ctx.caller();

    const [teams, allGames, assignments] = await Promise.all([
      caller.teams.list({ tripId, competitionId }),
      caller.games.listByTrip({ tripId }),
      caller.teamAssignments.list({ tripId, competitionId }),
    ]);
    // create seeds two placeholder teams (Team A / Team B) so the bones board's
    // team hero renders immediately — rosters (assignments) are still empty.
    expect((teams as Array<{ short_name: string }>).map((t) => t.short_name).sort()).toEqual(["A", "B"]);
    expect(
      (allGames as Array<{ competition_id: string | null }>).filter((g) => g.competition_id === competitionId)
    ).toEqual([]);
    expect(assignments).toEqual([]);
  });

  it("teams unassigned — members exist but no assignments yet", async () => {
    // No teams.create here: `competitions.create` already seeded this
    // head-to-head cup's two teams, and a third is refused since PR 4 (ruling 2).
    const { tripId, competitionId } = await createdCup("unassigned");
    const caller = ctx.caller();

    const [teams, assignments, members] = await Promise.all([
      caller.teams.list({ tripId, competitionId }),
      caller.teamAssignments.list({ tripId, competitionId }),
      caller.tripMembers.list({ tripId }),
    ]);
    expect(teams).toHaveLength(2);
    // The owner and the member this case added — exactly, so "every member is
    // unassigned" is about these two people and not about whoever happens to
    // be on a shared trip.
    expect(members.map((m: { user_id: string }) => m.user_id).sort()).toEqual(
      [ctx.user.id, ctx.getUser("member").id].sort()
    );
    // Assign Members surface renders dropdowns / drag cards for unassigned
    // members — at this stage every member is unassigned.
    expect(assignments).toEqual([]);
  });

  // (Removed: the event-form + event-agenda-status-line cases tested the retired
  // events-table EventsPanel/EventCard surface. Competition contests are now
  // `games` (CompetitionGamesPanel) — see games.d1.test.ts for that coverage,
  // and ScheduleTab for the game↔agenda link.)

  it("delete gating — owner can delete (reachable at any status)", async () => {
    const { tripId, competitionId } = await createdCup("delete", "Delete Cup");
    const result = await ctx.caller().competitions.delete({ tripId, competitionId });
    expect(result).toEqual({ success: true });
    expect(await ctx.caller().competitions.getByTrip({ tripId })).toBeNull();
  });
});
