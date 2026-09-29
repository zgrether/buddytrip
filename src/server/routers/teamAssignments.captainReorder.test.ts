import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * Captain roster reorder (migration 094) — the permission boundary.
 *
 * `teamAssignments.reorder` moved from requireTripRole("Owner") to
 * requireTeamIdentityEdit() — owner OR the captain of THAT team — while
 * assign / remove / setCaptain stayed owner-only. RLS was widened to match.
 * Migration 199 (PR 8 permissions pass) added Organizer to that gate and gave
 * captains a pre-results add/remove of their own; this file's cases 3 and 6
 * were rewritten for it.
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
 * is the Organizer case, which the tRPC gate admits since migration 199.
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

  it("3. an Organizer (non-captain, on another team) reorders team A → ADMITTED (migration 199)", async () => {
    // This case asserted REFUSED until the PR 8 permissions pass ruled that
    // whoever can delete a team can rename and reorder it. It stays as the
    // Organizer case, checked against the DB rather than the return value.
    const reversed = [...(await teamAOrder())].reverse();
    await ctx.callerAs("planner").teamAssignments.reorder({
      tripId,
      competitionId,
      teamId: teamA,
      orderedUserIds: reversed,
    });
    expect(await teamAOrder()).toEqual(reversed);
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

// Until migration 199 a captain had NO membership rights and these asserted a
// blanket refusal. A captain may now add unassigned players and remove their own
// before results (full coverage in rosterPermissions.test.ts), so each case
// names the specific line it still cannot cross, and pins the code that says so.
describe("6. the captain's roster grant stops where migration 199 draws it", () => {
  it("assign of a player on ANOTHER team → REFUSED as a trade", async () => {
    await expect(
      ctx.callerAs("member").teamAssignments.assign({
        tripId,
        competitionId,
        userId: teamBMember,
        teamId: teamA,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("remove without naming their team → REFUSED (the captain path is team-scoped)", async () => {
    await expect(
      ctx.callerAs("member").teamAssignments.remove({
        tripId,
        competitionId,
        userId: teamAOther,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
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
  // PostgREST, which is what RLS actually guards.
  //
  // THE BOUNDARY MOVED IN MIGRATION 140, and these were rewritten with it.
  // Migration 094 widened team_assignments_update to owner/organizer OR that
  // team's captain, and this block proved the widening stopped where intended.
  // The 2026-08-20 RLS audit (F8) found where it did NOT stop: a policy is
  // row-level, so admitting a captain to reorder also admitted them to rewrite
  // `user_id` and swap a teammate for anyone in the database — roster control
  // `requireTeamIdentityEdit` explicitly reserves to the Owner.
  //
  // So the captain arm is gone and the capability moved into
  // `reorder_team_roster`, a definer that validates a permutation and writes
  // `sort_order` alone. A captain has the same power and no longer needs write
  // access to the row to exercise it — which is what these now assert.

  it("captain CANNOT update the roster table directly any more (migration 140)", async () => {
    const { data: before } = await ctx.admin
      .from("team_assignments")
      .select("sort_order")
      .eq("competition_id", competitionId)
      .eq("user_id", captainId)
      .single();

    const db = ctx.authedClient("member");
    await db
      .from("team_assignments")
      .update({ sort_order: 5 })
      .eq("competition_id", competitionId)
      .eq("user_id", captainId);

    const { data: after } = await ctx.admin
      .from("team_assignments")
      .select("sort_order")
      .eq("competition_id", competitionId)
      .eq("user_id", captainId)
      .single();
    expect(after?.sort_order).toBe(before?.sort_order);
  });

  it("...but reorders through the definer, which is the point of removing the arm", async () => {
    // Nothing was taken away. If this fails, migration 140 removed a power
    // captains are supposed to have rather than relocating it.
    const db = ctx.authedClient("member");
    const { error } = await db.rpc("reorder_team_roster", {
      p_competition_id: competitionId,
      p_team_id: teamA,
      p_ordered_user_ids: [teamAOther, captainId],
    });
    expect(error).toBeNull();

    const { data } = await ctx.admin
      .from("team_assignments")
      .select("user_id, sort_order")
      .eq("competition_id", competitionId)
      .eq("team_id", teamA)
      .order("sort_order", { ascending: true });
    expect((data ?? []).map((r) => r.user_id)).toEqual([teamAOther, captainId]);
    // 0-based, matching the fan-out the RPC replaced (migration 139).
    expect((data ?? []).map((r) => r.sort_order)).toEqual([0, 1]);
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

  it("captain CANNOT move a row to another team", async () => {
    // Was a WITH CHECK rejection on the post-image (an error). Since migration
    // 140 the captain arm is gone from USING too, so the row is filtered out
    // before the check is ever reached and this is a silent no-op — the same
    // shape as the other-team case above. Asserting on the DATA rather than on
    // the error is what makes this survive that move: the guarantee is "the row
    // did not change", not "a particular error was raised".
    const db = ctx.authedClient("member");
    await db
      .from("team_assignments")
      .update({ team_id: teamB })
      .eq("competition_id", competitionId)
      .eq("user_id", captainId);

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
