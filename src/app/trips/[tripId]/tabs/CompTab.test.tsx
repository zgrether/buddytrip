import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../../../__tests__/helpers/test-setup";

/**
 * CompTab — data-layer integration tests.
 *
 * The new CompTab + sibling panels are pure presentational React; React
 * Testing Library + jsdom aren't yet in this repo, so we cover the full
 * spec matrix through the data layer that drives each render branch.
 * Phase B (when the live leaderboard returns and the CompTab gains
 * substantial interactive state) is the right time to add the RTL
 * harness; this file documents and verifies the data prerequisites
 * for every spec scenario in the meantime.
 *
 * Spec scenarios (from CC_COMPETITION_SETUP §Task 10) and where each
 * is exercised:
 *
 *   1. No competition + canEdit          → "no competition state"
 *   2. No competition + member           → same data path; UI branch
 *                                          differs only by canEdit flag
 *   3. Competition exists                → "competition exists"
 *   4. Competition exists → 4 panels     → asserted via competition +
 *                                          empty teams + empty events +
 *                                          empty groups all resolving
 *   5. GroupsPanel locked (no GOLF)      → "groups panel locked"
 *   6. GroupsPanel unlocked (GOLF exists)→ "groups panel unlocked"
 *   7. TeamsPanel unassigned members     → "teams unassigned"
 *   8. EventsPanel practice flag         → "practice event"
 *   9. EventsPanel missing course warn   → "non-practice event needs course"
 */

let ctx: TestContext;
let tripId: string;

describe("CompTab data layer", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("CompTab data tests");
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

  it("competition exists — header reads name + tagline", async () => {
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
  });

  it("competition exists — every sibling panel resolves an empty list", async () => {
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

  it("groups panel locked — no GOLF events means no per-event group view", async () => {
    const caller = ctx.caller();
    const competition = await caller.competitions.getByTrip({ tripId });
    const events = await caller.events.list({
      tripId,
      competitionId: competition!.id,
    });
    const golfEvents = events.filter((e) => e.type === "GOLF");
    expect(golfEvents.length).toBe(0); // GroupsPanel renders its locked state
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
    // The "Assign Members" UI section renders dropdowns for members not in
    // assignments — at this stage every member is unassigned.
    expect(assignments.length).toBe(0);
  });

  it("practice event — the is_practice flag drives the muted card + 'excluded' note", async () => {
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
  });

  it("non-practice event needs course — course_id remains null until a course is picked", async () => {
    const caller = ctx.caller();
    const competition = await caller.competitions.getByTrip({ tripId });
    const created = await caller.events.create({
      tripId,
      competitionId: competition!.id,
      type: "GOLF",
      title: "Day 1 Scramble",
      scoringFormat: "scramble",
      day: 1,
    });
    // EventCard reads course_id; when null + non-practice it surfaces the
    // "Course needed" warning badge.
    expect(created.course_id).toBeNull();
    expect(created.is_practice).toBe(false);
  });

  it("groups panel unlocked — once a GOLF event exists, per-event groups are list-able", async () => {
    const caller = ctx.caller();
    const competition = await caller.competitions.getByTrip({ tripId });
    const events = await caller.events.list({
      tripId,
      competitionId: competition!.id,
    });
    const golfEvent = events.find((e) => e.type === "GOLF");
    expect(golfEvent).toBeDefined();

    // The list is empty at this point but the query resolves — that's what
    // unlocks the per-event groups view in GroupsPanel.
    const groups = await caller.playGroups.list({
      tripId,
      eventId: golfEvent!.id,
    });
    expect(Array.isArray(groups)).toBe(true);
  });
});
