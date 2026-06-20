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
 *   - Status badge                         → "status badge"
 *   - Delete gated on upcoming             → "delete gating"
 *   - Contests are `games` now             → "(Teams, Games) all resolve"
 */

let ctx: TestContext;
let tripId: string;

describe("CompetitionFace data layer", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("CompTab revision tests");
    await ctx.addTripMember(tripId, "member", "Member");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("no competition state — getByTrip returns null", async () => {
    const caller = ctx.caller();
    const competition = await caller.competitions.getByTrip({ tripId });
    expect(competition).toBeNull();
  });

  it("competition exists — header reads name + tagline + status", async () => {
    const caller = ctx.caller();
    const created = await caller.competitions.create({
      tripId,
      name: "Header Cup",
      tagline: "First Past the Post",
    });
    ctx.trackCompetition(created.id);

    const fetched = await caller.competitions.getByTrip({ tripId });
    expect(fetched?.name).toBe("Header Cup");
    expect(fetched?.tagline).toBe("First Past the Post");
    expect(fetched?.status).toBe("upcoming"); // status badge → "Setup"
  });

  it("competition exists — sibling panels (Teams, Games) all resolve", async () => {
    const caller = ctx.caller();
    const competition = await caller.competitions.getByTrip({ tripId });
    expect(competition).not.toBeNull();

    const [teams, allGames, assignments] = await Promise.all([
      caller.teams.list({ tripId, competitionId: competition!.id }),
      caller.games.listByTrip({ tripId }),
      caller.teamAssignments.list({ tripId, competitionId: competition!.id }),
    ]);
    // create seeds two placeholder teams (Team A / Team B) so the bones board's
    // team hero renders immediately — rosters (assignments) are still empty.
    expect((teams as Array<{ short_name: string }>).map((t) => t.short_name).sort()).toEqual(["A", "B"]);
    expect(
      (allGames as Array<{ competition_id: string | null }>).filter(
        (g) => g.competition_id === competition!.id
      )
    ).toEqual([]);
    expect(assignments).toEqual([]);
  });

  it("teams unassigned — members exist but no assignments yet", async () => {
    const caller = ctx.caller();
    const competition = await caller.competitions.getByTrip({ tripId });
    await caller.teams.create({
      tripId,
      competitionId: competition!.id,
      name: "Team A",
      shortName: "A",
      color: "#3b82f6",
      colorDim: "#0a1a2a",
    });

    const [teams, assignments, members] = await Promise.all([
      caller.teams.list({ tripId, competitionId: competition!.id }),
      caller.teamAssignments.list({ tripId, competitionId: competition!.id }),
      caller.tripMembers.list({ tripId }),
    ]);
    expect(teams.length).toBeGreaterThan(0);
    expect(members.length).toBeGreaterThan(0);
    // Assign Members surface renders dropdowns / drag cards for unassigned
    // members — at this stage every member is unassigned.
    expect(assignments.length).toBe(0);
  });

  // (Removed: the event-form + event-agenda-status-line cases tested the retired
  // events-table EventsPanel/EventCard surface. Competition contests are now
  // `games` (CompetitionGamesPanel) — see games.d1.test.ts for that coverage,
  // and ScheduleTab for the game↔agenda link.)

  it("delete gating — owner can delete while status is upcoming", async () => {
    // Fresh competition for this test so we don't break the others above.
    const ownerCaller = ctx.caller();
    const created = await ownerCaller.competitions.create({
      tripId: await ctx.createTrip("Delete-gating cup"),
      name: "Delete Cup",
    });
    ctx.trackCompetition(created.id);
    expect(created.status).toBe("upcoming"); // delete trash icon visible

    const result = await ownerCaller.competitions.delete({
      tripId: created.trip_id as string,
      competitionId: created.id,
    });
    expect(result).toEqual({ success: true });
  });
});
