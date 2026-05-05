import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../../../__tests__/helpers/test-setup";

/**
 * CompTab — data-layer integration tests, post-revisions.
 *
 * The new CompTab + sibling panels are pure presentational React; React
 * Testing Library + jsdom aren't yet in this repo, so we cover the spec
 * matrix through the data layer that drives each render branch.
 *
 * Revisions matrix (CC_COMPETITION_REVISIONS):
 *   - GroupsPanel removed                  → no groups assertions
 *   - Status badge                         → "status badge"
 *   - Delete gated on upcoming             → "delete gating"
 *   - Event form: no day, no course        → "event form simplified"
 *   - VenuesPanel + venue → event linkage  → "venue linkage"
 *   - Event status line reflects venue     → "event venue status line"
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

  it("competition exists — sibling panels (Teams, Events, Venues) all resolve", async () => {
    const caller = ctx.caller();
    const competition = await caller.competitions.getByTrip({ tripId });
    expect(competition).not.toBeNull();

    const [teams, events, assignments, venues] = await Promise.all([
      caller.teams.list({ tripId, competitionId: competition!.id }),
      caller.events.list({ tripId, competitionId: competition!.id }),
      caller.teamAssignments.list({ tripId, competitionId: competition!.id }),
      caller.venues.list({ tripId, competitionId: competition!.id }),
    ]);
    expect(teams).toEqual([]);
    expect(events).toEqual([]);
    expect(assignments).toEqual([]);
    expect(venues).toEqual([]);
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

  it("event venue status line — non-practice event with no venue reads 'Not assigned'", async () => {
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

    const venues = await caller.venues.list({
      tripId,
      competitionId: competition!.id,
    });
    const linked = venues.find((a) => a.event_id === created.id);
    expect(linked).toBeUndefined(); // EventCard surfaces the warning state
  });

  it("venue linkage — manual venue + assignEvent flips an event into 'Anytime'", async () => {
    const caller = ctx.caller();
    const competition = await caller.competitions.getByTrip({ tripId });

    const event = await caller.events.create({
      tripId,
      competitionId: competition!.id,
      type: "GENERIC",
      title: "Cornhole Championship",
      pointsAvailable: 5,
    });

    const venue = await caller.venues.create({
      tripId,
      competitionId: competition!.id,
      name: "Cornhole Championship",
      isAnytime: true,
    });
    expect(venue.is_anytime).toBe(true);
    expect(venue.event_id).toBeNull();

    const linked = await caller.venues.assignEvent({
      tripId,
      venueId: venue.id,
      eventId: event.id,
    });
    expect(linked.event_id).toBe(event.id);
    expect(linked.is_anytime).toBe(true);
    // EventCard's status line now resolves to "Anytime" via this venue row.
  });

  it("venue linkage — assignEvent rejects an event already pinned to another venue", async () => {
    const caller = ctx.caller();
    const competition = await caller.competitions.getByTrip({ tripId });

    const event = await caller.events.create({
      tripId,
      competitionId: competition!.id,
      type: "GENERIC",
      title: "Putting Contest",
      pointsAvailable: 2,
    });

    const venueA = await caller.venues.create({
      tripId,
      competitionId: competition!.id,
      name: "Putting Contest A",
      isAnytime: true,
    });
    const venueB = await caller.venues.create({
      tripId,
      competitionId: competition!.id,
      name: "Putting Contest B",
      isAnytime: true,
    });

    await caller.venues.assignEvent({
      tripId,
      venueId: venueA.id,
      eventId: event.id,
    });

    await expect(
      caller.venues.assignEvent({
        tripId,
        venueId: venueB.id,
        eventId: event.id,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
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
