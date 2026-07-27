import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * ghostCrew.update's AUTO-LINK branch must run the full guest→real merge.
 *
 * THE BUG THIS PINS (production, 2 trips / 123 rows / 93 real scores):
 * the auto-link branch repointed `trip_members.user_id` from the ghost to the
 * matched account and returned — it never called `merge_guest_to_real_user`.
 * So the ghost row survived, stopped being a trip member, and every
 * competition-side row (team_assignments, game_participants, score_entries,
 * game_results, game_matches side JSONB) kept pointing at it. The roster reads
 * `memberById.get(user_id) ?? "Unknown"` off `tripMembers.list`, so those slots
 * rendered "Unknown" while the real account showed as unassigned and available.
 *
 * Worse than cosmetic: `game_participants` still gated scoring for the ghost,
 * so the real person could not enter scores in a game they were rostered in.
 *
 * NOT the signup trigger, and NOT (primarily) the merge function's table
 * coverage — a third code path doing a merge-shaped thing without the merge.
 *
 * `outsider` stands in for "an account that already signed up": a real
 * auth-backed, non-guest user who is not yet on the trip.
 */

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let teamId: string;
let gameId: string;
let ghostId: string;
let realId: string;
let realEmail: string;

const MANUAL = "gtt_manual";

/** Stand up a trip whose competition rosters a GHOST, with real scoring data. */
async function seedGhostCompetition() {
  tripId = await ctx.createTrip("Ghost autolink trip");
  competitionId = await ctx.createCompetition(tripId, "Ghost Cup", { scoringModel: "points" });
  teamId = await ctx.createTeam(competitionId, "Alpha", { shortName: "ALP" });

  const ghost = (await ctx.caller().ghostCrew.create({
    tripId,
    name: "Brad",
    role: "Member",
  })) as { id: string };
  ghostId = ghost.id;

  await ctx.caller().teamAssignments.assign({
    tripId,
    competitionId,
    userId: ghostId,
    teamId,
  });

  // Competition-side rows that must travel with the identity.
  const g = (await ctx.caller().games.create({
    tripId,
    gameTypeId: MANUAL,
    name: "Ghost Game",
    competitionId,
    pointsTotal: 10,
  })) as { id: string };
  gameId = g.id;

  // `id` is NOT NULL with no default on these tables. Omitting it makes the
  // insert fail — and supabase-js returns the error rather than throwing, so an
  // unchecked seed silently writes nothing. Every seed below is error-checked
  // for that reason: a test that asserts against rows it never created proves
  // nothing.
  const rid = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const gp = await ctx.admin.from("game_participants").insert({
    id: rid("gp"),
    game_id: gameId,
    user_id: ghostId,
  });
  if (gp.error) throw new Error(`seed game_participants: ${gp.error.message}`);
  const se = await ctx.admin.from("score_entries").insert({
    id: rid("se"),
    game_id: gameId,
    participant_type: "user",
    participant_id: ghostId,
    unit_label: "1",
    value: 4,
  });
  if (se.error) throw new Error(`seed score_entries: ${se.error.message}`);
  const gr = await ctx.admin.from("game_results").insert({
    id: rid("gr"),
    game_id: gameId,
    entity_type: "user",
    entity_id: ghostId,
    raw_score: 4,
  });
  if (gr.error) throw new Error(`seed game_results: ${gr.error.message}`);
  // JSONB match side — unreachable by a plain `UPDATE ... SET col`.
  const gm = await ctx.admin.from("game_matches").insert({
    id: rid("gm"),
    game_id: gameId,
    match_number: 1,
    display_order: 0,
    side_a: { type: "user", id: ghostId },
    side_b: null,
    status: "pending",
  });
  if (gm.error) throw new Error(`seed game_matches: ${gm.error.message}`);
}

/** Count every competition-side row still pointing at the ghost. */
async function ghostRefs() {
  const q = async (t: string, col: string, extra?: Record<string, string>) => {
    let b = ctx.admin.from(t).select("*", { count: "exact", head: true }).eq(col, ghostId);
    for (const [k, v] of Object.entries(extra ?? {})) b = b.eq(k, v);
    const { count } = await b;
    return count ?? 0;
  };
  const { data: sides } = await ctx.admin
    .from("game_matches")
    .select("side_a")
    .eq("game_id", gameId);
  return {
    team_assignments: await q("team_assignments", "user_id"),
    game_participants: await q("game_participants", "user_id"),
    score_entries: await q("score_entries", "participant_id", { participant_type: "user" }),
    game_results: await q("game_results", "entity_id", { entity_type: "user" }),
    match_side_a: (sides ?? []).filter(
      (r) => (r.side_a as { id?: string } | null)?.id === ghostId
    ).length,
    ghostRowStillExists: !!(
      await ctx.admin.from("users").select("id").eq("id", ghostId).maybeSingle()
    ).data,
  };
}

beforeEach(async () => {
  ctx = await TestContext.create();
  realId = ctx.getUser("outsider").id;
  realEmail = ctx.getUser("outsider").email;
  await seedGhostCompetition();
});

afterAll(async () => {
  await ctx?.cleanup();
});

describe("ghostCrew.update auto-link → full merge", () => {
  it("moves EVERY competition reference to the real account and retires the ghost", async () => {
    const before = await ghostRefs();
    expect(before.team_assignments).toBe(1);
    expect(before.game_participants).toBe(1);
    expect(before.score_entries).toBe(1);
    expect(before.game_results).toBe(1);
    expect(before.match_side_a).toBe(1);

    // The exact flow from the report: edit the ghost, give it the email of an
    // account that already signed up.
    const res = (await ctx.caller().ghostCrew.update({
      tripId,
      guestUserId: ghostId,
      email: realEmail,
    })) as { linked?: boolean };
    expect(res.linked).toBe(true);

    // Nothing may still point at the ghost — this is what failed before.
    const after = await ghostRefs();
    expect(after).toMatchObject({
      team_assignments: 0,
      game_participants: 0,
      score_entries: 0,
      game_results: 0,
      match_side_a: 0,
      ghostRowStillExists: false,
    });

    // ...and the real account owns them.
    const { data: ta } = await ctx.admin
      .from("team_assignments")
      .select("user_id")
      .eq("competition_id", competitionId);
    expect((ta ?? []).map((r) => r.user_id)).toEqual([realId]);

    const { data: gm } = await ctx.admin
      .from("game_matches")
      .select("side_a")
      .eq("game_id", gameId)
      .single();
    expect((gm?.side_a as { id: string }).id).toBe(realId);
  });

  it("the roster can name everyone afterwards — no 'Unknown' slot", async () => {
    await ctx.caller().ghostCrew.update({ tripId, guestUserId: ghostId, email: realEmail });

    // Reproduces the render contract at TeamsPanel.tsx:1982 —
    // memberById.get(assignment.user_id) must resolve for every row.
    const members = (await ctx.caller().tripMembers.list({ tripId })) as Array<{
      user_id: string | null;
      memberId: string;
    }>;
    const assignments = (await ctx
      .caller()
      .teamAssignments.list({ tripId, competitionId })) as Array<{ user_id: string }>;
    const known = new Set(members.map((m) => m.user_id ?? m.memberId));
    const unresolved = assignments.filter((a) => !known.has(a.user_id));
    expect(unresolved).toEqual([]);
  });

  it("survives a ghost+real COLLISION on a unique key instead of raising 23505", async () => {
    // Six tables already in the merge have a UNIQUE/PK including user_id
    // (trip_members, team_assignments, game_participants, idea_votes,
    // date_poll_votes, expense_splits). If BOTH identities hold the same key,
    // a naive `UPDATE ... SET user_id` raises 23505 — and because the merge runs
    // inside the signup trigger, that aborts the INSERT and SIGNUP FAILS. That
    // is the migration-023 failure class. Migration 095 deletes the ghost's
    // losing row first; the real account's row wins.
    //
    // Called through the service-role client because the core is (correctly)
    // not executable by `authenticated`.
    await ctx.admin.from("trip_members").insert({
      id: `tm-collide-${Date.now()}`,
      trip_id: tripId,
      user_id: realId,
      role: "Member",
      status: "in",
    });
    await ctx.admin.from("game_participants").insert({
      id: `gp-collide-${Date.now()}`,
      game_id: gameId,
      user_id: realId,
    });

    const { error } = await ctx.admin.rpc("merge_guest_to_real_user", {
      p_ghost_id: ghostId,
      p_real_id: realId,
    });
    expect(error).toBeNull();

    // One membership and one participant row survive — the real account's.
    const { data: tm } = await ctx.admin
      .from("trip_members")
      .select("user_id")
      .eq("trip_id", tripId)
      .eq("user_id", realId);
    expect(tm ?? []).toHaveLength(1);
    const { data: gp } = await ctx.admin
      .from("game_participants")
      .select("user_id")
      .eq("game_id", gameId);
    expect((gp ?? []).map((r) => r.user_id)).toEqual([realId]);
  });

  it("the real account is a trip member exactly once (no duplicate membership)", async () => {
    await ctx.caller().ghostCrew.update({ tripId, guestUserId: ghostId, email: realEmail });
    const { data } = await ctx.admin
      .from("trip_members")
      .select("user_id")
      .eq("trip_id", tripId)
      .eq("user_id", realId);
    expect(data ?? []).toHaveLength(1);
  });
});
