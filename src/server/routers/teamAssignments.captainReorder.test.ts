import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * Captain roster reorder (migration 094) — the permission boundary.
 *
 * `teamAssignments.reorder` moved from requireTripRole("Owner") to
 * requireTeamIdentityEdit() — owner OR the captain of THAT team — while
 * assign / remove / setCaptain stayed owner-only. RLS was widened to match.
 *
 * Server enforcement is the whole point: these call the procedures DIRECTLY,
 * bypassing the client, and the RLS case goes below tRPC entirely to a
 * JWT-scoped Supabase client. A client-side check proves nothing (the C3 gate
 * in #707 turned out to be client-only across every format).
 *
 * Cast — chosen deliberately: `member` (a PLAIN trip Member) is the captain of
 * team A. That matters. An earlier draft made `planner` the captain and every
 * RLS assertion silently passed for the wrong reason: `planner` is an
 * Organizer, and the policy independently grants Organizer write access (kept
 * on purpose — teamAssignments.assign is Organizer-gated and upserts). Only a
 * plain Member isolates the captain branch. `planner` now sits on team B and
 * doubles as proof that Organizer is NOT admitted by the tRPC gate.
 */

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let teamA: string;
let teamB: string;
let captainId: string;
let teamAOther: string;
let teamBMember: string;

/** Only the columns these assertions actually select. */
type RosterRowShape = { user_id: string; team_id: string; is_captain: boolean };

/** Team A's rows in canonical order, straight from the DB (admin, RLS-free). */
async function teamAOrder(): Promise<string[]> {
  const { data } = await ctx.admin
    .from("team_assignments")
    .select("user_id, sort_order")
    .eq("competition_id", competitionId)
    .eq("team_id", teamA)
    .order("sort_order", { ascending: true });
  return (data ?? []).map((r) => r.user_id as string);
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Captain reorder trip");
  // Sequential, never Promise.all (CLAUDE.md local-stack test conventions).
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");

  captainId = ctx.getUser("member").id;   // PLAIN trip Member — isolates the captain branch
  teamBMember = ctx.getUser("planner").id; // Organizer, on the OTHER team
  teamAOther = ctx.getUser("owner").id;

  competitionId = await ctx.createCompetition(tripId, "Captain Cup", {
    scoringModel: "points",
  });
  teamA = await ctx.createTeam(competitionId, "Alpha", { shortName: "ALP" });
  teamB = await ctx.createTeam(competitionId, "Bravo", { shortName: "BRV" });

  const owner = ctx.caller();
  await owner.teamAssignments.assign({ tripId, competitionId, userId: captainId, teamId: teamA });
  await owner.teamAssignments.assign({ tripId, competitionId, userId: teamAOther, teamId: teamA });
  await owner.teamAssignments.assign({ tripId, competitionId, userId: teamBMember, teamId: teamB });
  await owner.teamAssignments.setCaptain({
    tripId,
    competitionId,
    teamId: teamA,
    userId: captainId,
    isCaptain: true,
  });
});

afterAll(async () => {
  await ctx.cleanup();
});

describe("reorder — the captain grant", () => {
  it("1. captain reorders their OWN team → succeeds, and the DB reflects it", async () => {
    const before = await teamAOrder();
    expect(before).toHaveLength(2);
    const reversed = [...before].reverse();

    await ctx
      .callerAs("member")
      .teamAssignments.reorder({ tripId, competitionId, teamId: teamA, orderedUserIds: reversed });

    // Verified against the DB, not the procedure's return value.
    expect(await teamAOrder()).toEqual(reversed);
  });

  it("4. owner reorders any team → still succeeds (no regression)", async () => {
    const before = await teamAOrder();
    const reversed = [...before].reverse();
    await ctx
      .caller()
      .teamAssignments.reorder({ tripId, competitionId, teamId: teamA, orderedUserIds: reversed });
    expect(await teamAOrder()).toEqual(reversed);
  });
});

describe("reorder — the boundary (direct procedure calls, no client involved)", () => {
  it("2. captain of team A reorders team B → REFUSED", async () => {
    const { data } = await ctx.admin
      .from("team_assignments")
      .select("user_id")
      .eq("competition_id", competitionId)
      .eq("team_id", teamB);
    const teamBIds = (data ?? []).map((r) => r.user_id as string);

    // A valid permutation of team B's real roster — so ONLY the gate can refuse
    // it. This is the most important assertion in the file.
    await expect(
      ctx.callerAs("member").teamAssignments.reorder({
        tripId,
        competitionId,
        teamId: teamB,
        orderedUserIds: teamBIds,
      })
    ).rejects.toThrow();
  });

  it("3. a non-captain (Organizer, on another team) reorders team A → REFUSED", async () => {
    // Stronger than a plain member: proves the gate admits Owner and THIS team's
    // captain only. Organizer is trip staff and passes plenty of other gates
    // (assign, for one) — it does not pass this one.
    const order = await teamAOrder();
    await expect(
      ctx.callerAs("planner").teamAssignments.reorder({
        tripId,
        competitionId,
        teamId: teamA,
        orderedUserIds: [...order].reverse(),
      })
    ).rejects.toThrow();
  });

  it("a non-member of the trip reorders → REFUSED", async () => {
    const order = await teamAOrder();
    await expect(
      ctx.callerAs("outsider").teamAssignments.reorder({
        tripId,
        competitionId,
        teamId: teamA,
        orderedUserIds: [...order].reverse(),
      })
    ).rejects.toThrow();
  });
});

describe("6. the gate did NOT widen past reorder — captain still refused", () => {
  it("assign → REFUSED for the captain", async () => {
    await expect(
      ctx.callerAs("member").teamAssignments.assign({
        tripId,
        competitionId,
        userId: teamBMember,
        teamId: teamA,
      })
    ).rejects.toThrow();
  });

  it("remove → REFUSED for the captain", async () => {
    await expect(
      ctx.callerAs("member").teamAssignments.remove({
        tripId,
        competitionId,
        userId: teamAOther,
      })
    ).rejects.toThrow();
  });

  it("setCaptain → REFUSED for the captain (no sub-appointing)", async () => {
    await expect(
      ctx.callerAs("member").teamAssignments.setCaptain({
        tripId,
        competitionId,
        teamId: teamA,
        userId: teamAOther,
        isCaptain: true,
      })
    ).rejects.toThrow();
  });

  it("the refusals above left the roster untouched", async () => {
    const { data } = await ctx.admin
      .from("team_assignments")
      .select("user_id, team_id, is_captain")
      .eq("competition_id", competitionId);
    const rows = (data ?? []) as RosterRowShape[];
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.team_id === teamA)).toHaveLength(2);
    // Captaincy is unchanged: still exactly the original captain.
    expect(rows.filter((r) => r.is_captain).map((c) => c.user_id)).toEqual([captainId]);
  });
});

describe("5. RLS enforces the same boundary BELOW tRPC", () => {
  // These bypass the procedure entirely — a JWT-scoped anon-key client hitting
  // PostgREST, which is what RLS actually guards. Migration 094 widened
  // team_assignments_update to owner/organizer OR that team's captain; this
  // proves the widening stopped where it was supposed to.

  it("captain CAN update sort_order on their own team", async () => {
    const db = ctx.authedClient("member");
    const { error } = await db
      .from("team_assignments")
      .update({ sort_order: 5 })
      .eq("competition_id", competitionId)
      .eq("user_id", captainId);
    expect(error).toBeNull();

    const { data } = await ctx.admin
      .from("team_assignments")
      .select("sort_order")
      .eq("competition_id", competitionId)
      .eq("user_id", captainId)
      .single();
    expect(data?.sort_order).toBe(5);
  });

  it("captain CANNOT update another team's rows — the boundary the migration establishes", async () => {
    const { data: before } = await ctx.admin
      .from("team_assignments")
      .select("sort_order")
      .eq("competition_id", competitionId)
      .eq("user_id", teamBMember)
      .single();

    const db = ctx.authedClient("member");
    await db
      .from("team_assignments")
      .update({ sort_order: 99 })
      .eq("competition_id", competitionId)
      .eq("user_id", teamBMember);

    // RLS filters the row out via USING, so this is a silent no-op rather than a
    // thrown error — assert on the DATA, which is what actually matters.
    const { data: after } = await ctx.admin
      .from("team_assignments")
      .select("sort_order")
      .eq("competition_id", competitionId)
      .eq("user_id", teamBMember)
      .single();
    expect(after?.sort_order).toBe(before?.sort_order);
    expect(after?.sort_order).not.toBe(99);
  });

  it("captain CANNOT move a row to another team (WITH CHECK on the post-image)", async () => {
    const db = ctx.authedClient("member");
    const { error } = await db
      .from("team_assignments")
      .update({ team_id: teamB })
      .eq("competition_id", competitionId)
      .eq("user_id", captainId);
    expect(error).not.toBeNull();

    const { data } = await ctx.admin
      .from("team_assignments")
      .select("team_id")
      .eq("competition_id", competitionId)
      .eq("user_id", captainId)
      .single();
    expect(data?.team_id).toBe(teamA);
  });

  it("a plain member CANNOT update roster rows at all", async () => {
    const { data: before } = await ctx.admin
      .from("team_assignments")
      .select("sort_order")
      .eq("competition_id", competitionId)
      .eq("user_id", teamAOther)
      .single();

    const db = ctx.authedClient("outsider");
    await db
      .from("team_assignments")
      .update({ sort_order: 77 })
      .eq("competition_id", competitionId)
      .eq("user_id", teamAOther);

    const { data: after } = await ctx.admin
      .from("team_assignments")
      .select("sort_order")
      .eq("competition_id", competitionId)
      .eq("user_id", teamAOther)
      .single();
    expect(after?.sort_order).toBe(before?.sort_order);
  });

  it("Organizer RETAINS RLS write — deliberately kept, or assign() breaks", async () => {
    // Documents why migration 094 kept Owner+Organizer in the policy instead of
    // narrowing to Owner+captain the way mig 065 did for `teams`:
    // teamAssignments.assign is requireTripRole("Organizer") and upserts, so a
    // co-admin moving a player performs an UPDATE. Dropping Organizer here would
    // have broken assignment for co-admins — a regression the captain work has
    // no business causing.
    const db = ctx.authedClient("planner");
    const { error } = await db
      .from("team_assignments")
      .update({ sort_order: 4 })
      .eq("competition_id", competitionId)
      .eq("user_id", teamBMember);
    expect(error).toBeNull();
  });
});
