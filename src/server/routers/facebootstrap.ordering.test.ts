import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * faceBootstrap ↔ teamAssignments.list ORDERING LOCKSTEP.
 *
 * `competitions.faceBootstrap` returns a `team_assignments` payload that
 * `LiveFaceClient` uses to SEED the `teamAssignments.list` cache via `setData`.
 * One query key, two independent writers — and a consumer that trusts array
 * position (`RackGameView`'s roster order + group-builder pool, which do NOT
 * re-sort) cannot tell which writer produced the rows it's holding.
 *
 * The bug this pins: the bootstrap query had no `.order()` at all while the
 * procedure ordered by (team_id, sort_order).
 *
 * ── WHAT THIS TEST DOES AND DOESN'T CATCH (read before trusting it) ──────────
 * It does NOT reliably fail against the missing-`.order()` code. That was
 * measured, not assumed: reverting the fix and running this file still passed.
 * The reason is that `team_assignments_team_sort_idx` is on
 * (competition_id, team_id, sort_order), so when the competition_id filter is
 * selective the planner serves the *unordered* query from that index and hands
 * back canonical order anyway. Confirmed with EXPLAIN on the local stack:
 * selective filter → `Index Scan using team_assignments_team_sort_idx`;
 * non-selective (400 rows, one competition) → `Seq Scan`, i.e. heap order, which
 * genuinely diverges from canonical after a single-row rewrite (verified in raw
 * SQL: reorder then setCaptain moves one tuple to the end of the heap).
 *
 * So the original defect was ordering-by-luck rather than a live scramble, and
 * no test at this layer can prove otherwise without controlling the planner.
 *
 * What this file DOES guard, and why it earns its place: the two paths must stay
 * IDENTICAL. If either one's ordering is changed or dropped in isolation, the
 * equality assertion fires. That's the realistic future regression — one of two
 * duplicated queries getting edited — and it's exactly how the original drift
 * happened.
 *
 * The seeding deliberately reorders (so canonical ≠ insertion order) and then
 * rewrites a single row via setCaptain (so canonical ≠ heap order), which is the
 * only state where the two can be told apart at all.
 */

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let teamA: string;
let teamB: string;
/** Team A's canonical roster, in the order persisted by the reorder below. */
let teamAOrder: string[];
let guestIds: string[] = [];

type Assignment = { user_id: string; team_id: string; sort_order: number };

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Bootstrap ordering trip");
  // Sequential, never Promise.all (CLAUDE.md local-stack test conventions).
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");

  // Two guests so team A can hold 4 and team B 2 — enough rows that a scrambled
  // read is unambiguous, and enough teams to exercise the (team_id, sort_order)
  // compound rather than sort_order alone.
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  guestIds = [`ghost-bo1-${stamp}`, `ghost-bo2-${stamp}`];
  for (const id of guestIds) {
    await ctx.admin.from("users").insert({
      id,
      name: `Bootstrap Ghost ${id.slice(-4)}`,
      email: null,
      is_guest: true,
      created_by: ctx.getUser("owner").id,
    });
    await ctx.addTripMemberById(tripId, id, "Member");
  }

  competitionId = await ctx.createCompetition(tripId, "Ordering Cup", {
    scoringModel: "points",
  });
  teamA = await ctx.createTeam(competitionId, "Alpha", { shortName: "ALP" });
  teamB = await ctx.createTeam(competitionId, "Bravo", { shortName: "BRV" });

  const caller = ctx.caller();
  const aMembers = [
    ctx.getUser("owner").id,
    ctx.getUser("planner").id,
    ctx.getUser("member").id,
    guestIds[0],
  ];
  for (const userId of aMembers) {
    await caller.teamAssignments.assign({ tripId, competitionId, userId, teamId: teamA });
  }
  await caller.teamAssignments.assign({
    tripId,
    competitionId,
    userId: guestIds[1],
    teamId: teamB,
  });

  // Reverse team A, so canonical order and INSERTION order disagree.
  teamAOrder = [...aMembers].reverse();
  await caller.teamAssignments.reorder({
    tripId,
    competitionId,
    teamId: teamA,
    orderedUserIds: teamAOrder,
  });

  // The step that actually creates the divergence (see the note above): rewrite
  // ONE row, which relocates it in the heap while its sort_order stays put.
  // Without this, physical order still matches canonical and the bug hides.
  await caller.teamAssignments.setCaptain({
    tripId,
    competitionId,
    teamId: teamA,
    userId: teamAOrder[0],
    isCaptain: true,
  });
});

afterAll(async () => {
  await ctx.cleanup();
  if (guestIds.length) await ctx.admin.from("users").delete().in("id", guestIds);
});

describe("faceBootstrap ↔ teamAssignments.list ordering lockstep", () => {
  it("both paths return team_assignments in identical order", async () => {
    const caller = ctx.caller();
    const listed = (await caller.teamAssignments.list({
      tripId,
      competitionId,
    })) as Assignment[];
    const boot = await caller.competitions.faceBootstrap({ tripId });
    const seeded = boot.assignments as Assignment[];

    // Same rows, in the same ORDER — the invariant that makes a seeded cache and
    // a fetched cache interchangeable for a position-trusting consumer.
    expect(seeded).toHaveLength(listed.length);
    expect(seeded.map((a) => `${a.team_id}:${a.user_id}`)).toEqual(
      listed.map((a) => `${a.team_id}:${a.user_id}`)
    );
  });

  it("the bootstrap's team A rows are in sort_order, not heap order", async () => {
    const caller = ctx.caller();
    const boot = await caller.competitions.faceBootstrap({ tripId });
    const seeded = (boot.assignments as Assignment[]).filter((a) => a.team_id === teamA);

    // Guards against BOTH paths losing their ordering together (which the
    // equality check above would happily accept).
    expect(seeded.map((a) => a.user_id)).toEqual(teamAOrder);
    expect(seeded.map((a) => a.sort_order)).toEqual([0, 1, 2, 3]);
  });

  it("rack's array-position assumption holds on the bootstrap payload", async () => {
    // RackGameView builds `rosterOrder` as an index map straight off this array
    // with no re-sort. Assert the property it depends on: within each team,
    // array position ascends with sort_order.
    const caller = ctx.caller();
    const boot = await caller.competitions.faceBootstrap({ tripId });
    const seeded = boot.assignments as Assignment[];

    for (const teamId of [teamA, teamB]) {
      const sortOrders = seeded.filter((a) => a.team_id === teamId).map((a) => a.sort_order);
      expect(sortOrders.length).toBeGreaterThan(0);
      expect(sortOrders).toEqual([...sortOrders].sort((x, y) => x - y));
    }
  });
});
