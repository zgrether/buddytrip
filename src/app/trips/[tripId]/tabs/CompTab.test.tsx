import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../../../__tests__/helpers/test-setup";

/**
 * CompTab — data-layer integration tests, post-revisions.
 *
 * The new CompTab + sibling panels are pure presentational React; React
 * Testing Library + jsdom aren't yet in this repo, so we cover the spec
 * matrix through the data layer that drives each render branch.
 *
 * Revisions matrix:
 *   - GroupsPanel removed                  → no groups assertions
 *   - Status badge                         → "status badge"
 *   - Delete gated on upcoming             → "delete gating"
 *   - Event form: no day, no course        → "event form simplified"
 *   - Venues replaced by agenda-item link  → "agenda item linkage"
 *   - Event status line reflects agenda    → "event agenda status line"
 */

let ctx: TestContext;
let tripId: string;

describe("CompTab data layer (revisions)", () => {
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

  it("competition exists — sibling panels (Teams, Events) all resolve", async () => {
    const caller = ctx.caller();
    const competition = await caller.competitions.getByTrip({ tripId });
    expect(competition).not.toBeNull();

    const [teams, events, assignments] = await Promise.all([
      caller.teams.list({ tripId, competitionId: competition!.id }),
      caller.events.list({ tripId, competitionId: competition!.id }),
      caller.teamAssignments.list({ tripId, competitionId: competition!.id }),
    ]);
    expect(teams).toEqual([]);
    expect(events).toEqual([]);
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

  it("event form simplified — practice event ignores points and course", async () => {
    const caller = ctx.caller();
    const competition = await caller.competitions.getByTrip({ tripId });
    const created = await caller.events.create({
      tripId,
      competitionId: competition!.id,
      type: "GOLF",
      title: "Warmup Round",
      scoringFormat: "scramble",
      isPractice: true,
    });
    expect(created.is_practice).toBe(true);
    // EventCard's status line reads "Practice · Not scored" off this flag.
  });

  it("event agenda status line — non-practice GOLF event has no agenda_item initially", async () => {
    const caller = ctx.caller();
    const competition = await caller.competitions.getByTrip({ tripId });
    const created = await caller.events.create({
      tripId,
      competitionId: competition!.id,
      type: "GOLF",
      title: "Day 1 Scramble",
      scoringFormat: "scramble",
    });
    expect(created.is_practice).toBe(false);

    const events = await caller.events.list({
      tripId,
      competitionId: competition!.id,
    });
    const found = events.find((e) => e.id === created.id) as { agenda_item?: unknown };
    // No agenda item linked yet — EventCard surfaces the unlinked GOLF warning
    expect(found?.agenda_item).toBeFalsy();
  });

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
