import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TRPCError } from "@trpc/server";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * PR 8's permissions pass (ruled 2026-09-28, migration 199).
 *
 *  - Organizers add, remove and move, and now RENAME and REORDER: whoever can
 *    delete a team can rename it.
 *  - Captains, before the roster locks: add UNASSIGNED players to their own
 *    team and remove their own team's players. After the lock, nothing.
 *    Pulling someone off another team is a TRADE — Organizer-level, refused.
 *  - Delegation grants no roster rights.
 *
 * Every case builds its OWN trip: these are destructive roster writes, and a
 * guard that fails must not leak a changed roster into the next case (CLAUDE.md).
 * Each refusal is asserted with its code AND that the roster did not change —
 * a refusal that still wrote would pass a code-only check.
 */

let ctx: TestContext;
beforeAll(async () => { ctx = await TestContext.create(); });
afterAll(async () => { await ctx.cleanup(); });

/** A cup: Blue captained by `member`, Red empty; `planner` is an Organizer and
 *  `outsider` an unassigned trip Member. */
async function cup(label: string) {
  const { tripId, competitionId } = await ctx.createCupTrip({
    title: `perm ${label}`, name: `Perm ${label}`, scoringModel: "points",
    members: [["planner", "Organizer"], ["member", "Member"], ["outsider", "Member"]],
    teams: ["Blue", "Red"],
  });
  const { data: teams } = await ctx.admin.from("teams").select("id, name").eq("competition_id", competitionId);
  const id = (n: string) => (teams ?? []).find((t) => t.name === n)!.id as string;
  const blue = id("Blue"), red = id("Red");
  const member = ctx.getUser("member").id;
  const { error } = await ctx.admin.from("team_assignments").insert({
    competition_id: competitionId, team_id: blue, user_id: member, is_captain: true, sort_order: 0,
  });
  if (error) throw new Error(`seed captain: ${error.message}`);
  return { tripId, competitionId, blue, red, member, outsider: ctx.getUser("outsider").id, planner: ctx.getUser("planner").id };
}

async function teamOf(competitionId: string, userId: string): Promise<string | null> {
  const { data } = await ctx.admin.from("team_assignments").select("team_id")
    .eq("competition_id", competitionId).eq("user_id", userId).maybeSingle();
  return (data?.team_id as string | undefined) ?? null;
}

async function refused(p: Promise<unknown>): Promise<TRPCError> {
  try { await p; } catch (e) { if (e instanceof TRPCError) return e; throw e; }
  throw new Error("expected a refusal, and the call succeeded");
}

/** Lock the roster the way the app does: a score in a game of this cup. */
async function lock(tripId: string, competitionId: string, playerId: string) {
  const gameId = genId("game");
  const g = await ctx.admin.from("games").insert({
    id: gameId, trip_id: tripId, competition_id: competitionId, game_type_id: "gtt_stroke_play",
    name: "Locker", status: "active", scoring_enabled: true,
  });
  if (g.error) throw new Error(`seed game: ${g.error.message}`);
  const s = await ctx.admin.from("score_entries").insert({
    id: genId("se"), game_id: gameId, participant_id: playerId, participant_type: "user",
    unit_label: "1", value: 4, annotations: {}, submitted_at: new Date().toISOString(),
  });
  if (s.error) throw new Error(`seed score: ${s.error.message}`);
}

describe("Organizers rename and reorder (whoever can delete can rename)", () => {
  it("an Organizer renames a team", async () => {
    const c = await cup("org-rename");
    await ctx.callerAs("planner").teams.update({ tripId: c.tripId, teamId: c.red, name: "Crimson" });
    const { data } = await ctx.admin.from("teams").select("name").eq("id", c.red).single();
    expect(data!.name).toBe("Crimson");
  }, 60000);

  it("an Organizer reorders a team", async () => {
    const c = await cup("org-reorder");
    await ctx.caller().teamAssignments.assign({ tripId: c.tripId, competitionId: c.competitionId, userId: c.outsider, teamId: c.blue });
    await ctx.callerAs("planner").teamAssignments.reorder({
      tripId: c.tripId, competitionId: c.competitionId, teamId: c.blue, orderedUserIds: [c.outsider, c.member],
    });
    const { data } = await ctx.admin.from("team_assignments").select("user_id, sort_order")
      .eq("team_id", c.blue).order("sort_order");
    expect((data ?? []).map((r) => r.user_id)).toEqual([c.outsider, c.member]);
  }, 60000);
});

describe("captains, before the roster locks", () => {
  it("add an UNASSIGNED trip member to their own team, at the end of its order", async () => {
    const c = await cup("cap-add");
    await ctx.callerAs("member").teamAssignments.assign({ tripId: c.tripId, competitionId: c.competitionId, userId: c.outsider, teamId: c.blue });
    const { data } = await ctx.admin.from("team_assignments").select("team_id, sort_order")
      .eq("competition_id", c.competitionId).eq("user_id", c.outsider).single();
    expect(data).toEqual({ team_id: c.blue, sort_order: 1 });
  }, 60000);

  it("REFUSE a trade: someone on another team is an organizer's call", async () => {
    const c = await cup("cap-trade");
    await ctx.caller().teamAssignments.assign({ tripId: c.tripId, competitionId: c.competitionId, userId: c.outsider, teamId: c.red });
    const e = await refused(ctx.callerAs("member").teamAssignments.assign({
      tripId: c.tripId, competitionId: c.competitionId, userId: c.outsider, teamId: c.blue,
    }));
    expect(e.code).toBe("PRECONDITION_FAILED");
    expect(e.message).toMatch(/trade, so ask an organizer/);
    expect(await teamOf(c.competitionId, c.outsider)).toBe(c.red);
  }, 60000);

  it("REFUSE adding to a team they don't captain", async () => {
    const c = await cup("cap-other-team");
    const e = await refused(ctx.callerAs("member").teamAssignments.assign({
      tripId: c.tripId, competitionId: c.competitionId, userId: c.outsider, teamId: c.red,
    }));
    expect(e.code).toBe("FORBIDDEN");
    expect(await teamOf(c.competitionId, c.outsider)).toBeNull();
  }, 60000);

  it("remove their own team's player", async () => {
    const c = await cup("cap-remove");
    await ctx.caller().teamAssignments.assign({ tripId: c.tripId, competitionId: c.competitionId, userId: c.outsider, teamId: c.blue });
    await ctx.callerAs("member").teamAssignments.remove({ tripId: c.tripId, competitionId: c.competitionId, userId: c.outsider, teamId: c.blue });
    expect(await teamOf(c.competitionId, c.outsider)).toBeNull();
  }, 60000);

  it("REFUSE removing a player on another team", async () => {
    const c = await cup("cap-remove-other");
    await ctx.caller().teamAssignments.assign({ tripId: c.tripId, competitionId: c.competitionId, userId: c.outsider, teamId: c.red });
    // Naming THEIR team for someone who isn't on it.
    const e = await refused(ctx.callerAs("member").teamAssignments.remove({
      tripId: c.tripId, competitionId: c.competitionId, userId: c.outsider, teamId: c.blue,
    }));
    expect(e.code).toBe("BAD_REQUEST");
    expect(await teamOf(c.competitionId, c.outsider)).toBe(c.red);
    // …and naming the other team, which they don't captain.
    const e2 = await refused(ctx.callerAs("member").teamAssignments.remove({
      tripId: c.tripId, competitionId: c.competitionId, userId: c.outsider, teamId: c.red,
    }));
    expect(e2.code).toBe("FORBIDDEN");
    expect(await teamOf(c.competitionId, c.outsider)).toBe(c.red);
  }, 60000);

  it("REFUSE removing themselves — that would leave the team with no captain", async () => {
    const c = await cup("cap-self");
    const e = await refused(ctx.callerAs("member").teamAssignments.remove({
      tripId: c.tripId, competitionId: c.competitionId, userId: c.member, teamId: c.blue,
    }));
    expect(e.code).toBe("PRECONDITION_FAILED");
    expect(await teamOf(c.competitionId, c.member)).toBe(c.blue);
  }, 60000);
});

describe("after the roster locks, captains have nothing; organizers still add", () => {
  it("a captain can neither add nor remove once a result is in", async () => {
    const c = await cup("cap-locked");
    await ctx.caller().teamAssignments.assign({ tripId: c.tripId, competitionId: c.competitionId, userId: c.planner, teamId: c.blue });
    await lock(c.tripId, c.competitionId, c.member);

    const add = await refused(ctx.callerAs("member").teamAssignments.assign({
      tripId: c.tripId, competitionId: c.competitionId, userId: c.outsider, teamId: c.blue,
    }));
    expect(add.code).toBe("PRECONDITION_FAILED");
    expect(add.message).toMatch(/Results are in/);
    expect(await teamOf(c.competitionId, c.outsider)).toBeNull();

    const rem = await refused(ctx.callerAs("member").teamAssignments.remove({
      tripId: c.tripId, competitionId: c.competitionId, userId: c.planner, teamId: c.blue,
    }));
    expect(rem.code).toBe("PRECONDITION_FAILED");
    expect(await teamOf(c.competitionId, c.planner)).toBe(c.blue);

    // CONTROL: an Organizer's ADD still goes through after the lock (adds stay allowed).
    await ctx.callerAs("planner").teamAssignments.assign({ tripId: c.tripId, competitionId: c.competitionId, userId: c.outsider, teamId: c.red });
    expect(await teamOf(c.competitionId, c.outsider)).toBe(c.red);
  }, 60000);
});

describe("no roster rights without the role", () => {
  it("delegation grants no roster rights: a game's delegate who isn't a captain cannot add", async () => {
    const c = await cup("delegate");
    const gameId = genId("game");
    const g = await ctx.admin.from("games").insert({
      id: gameId, trip_id: c.tripId, competition_id: c.competitionId, game_type_id: "gtt_stroke_play", name: "Delegated", status: "pending",
    });
    if (g.error) throw new Error(`seed game: ${g.error.message}`);
    const d = await ctx.admin.from("game_delegates").insert({ game_id: gameId, user_id: c.outsider });
    if (d.error) throw new Error(`seed delegate: ${d.error.message}`);

    const e = await refused(ctx.callerAs("outsider").teamAssignments.assign({
      tripId: c.tripId, competitionId: c.competitionId, userId: c.outsider, teamId: c.red,
    }));
    expect(e.code).toBe("FORBIDDEN");
    expect(await teamOf(c.competitionId, c.outsider)).toBeNull();
  }, 60000);

  it("a plain Member (no captaincy) cannot remove anyone", async () => {
    const c = await cup("plain-member");
    const e = await refused(ctx.callerAs("outsider").teamAssignments.remove({
      tripId: c.tripId, competitionId: c.competitionId, userId: c.member, teamId: c.blue,
    }));
    expect(e.code).toBe("FORBIDDEN");
    expect(await teamOf(c.competitionId, c.member)).toBe(c.blue);
  }, 60000);
});
