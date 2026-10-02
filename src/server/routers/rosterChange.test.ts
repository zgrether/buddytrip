import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";
import { PREVIEW_REQUIRED_MESSAGE } from "../lib/rosterChange";
import { ROSTER_CHANGED_MESSAGE } from "../lib/rosterFingerprint";

/**
 * Staff roster changes after results (PR 8b) — what replaced the roster lock.
 *
 * This file used to be `rosterLock.test.ts` and asserted the opposite: every
 * move, removal and team delete REFUSED once a cup had a result. Ruling 16
 * allows trades after results, and 8a made that safe for finished games (they
 * credit through the roster they finalized with). What is refused now is
 * narrower, and every case names its reason:
 *
 *  - a move or removal with no reviewed preview, or one built on a roster that
 *    has since changed;
 *  - a change to someone in an UNFINISHED team-DEPENDENT game, naming the game;
 *  - deleting a team with banked points, or one that still has players.
 *
 * EVERY CASE BUILDS ITS OWN CUP (#1527, and CLAUDE.md on destructive writes):
 * these cases move and delete, and on a build whose guard failed open one case
 * would move a player another was counting on.
 */

let ctx: TestContext;
let ownerId: string;
let memberId: string;
let plannerId: string;

type Cup = { tripId: string; competitionId: string; teamA: string; teamB: string };

async function rosterCup(label: string): Promise<Cup> {
  const tripId = await ctx.createTrip(`Roster Change ${label}`);
  await ctx.addTripMember(tripId, "member", "Member");
  await ctx.addTripMember(tripId, "planner", "Member");
  // A POINTS cup: these cases delete teams, and a head-to-head cup refuses the
  // loss of either of its two before any roster rule is consulted (PR 4).
  const competitionId = await ctx.createCompetition(tripId, `Roster Change Cup ${label}`, { scoringModel: "points" });
  const teamA = await ctx.createTeam(competitionId, "Team A");
  const teamB = await ctx.createTeam(competitionId, "Team B");
  return { tripId, competitionId, teamA, teamB };
}

async function insertGame(cup: Cup, fields: Record<string, unknown>): Promise<string> {
  const id = genId("rc-game");
  const { error } = await ctx.admin.from("games").insert({
    id, trip_id: cup.tripId, competition_id: cup.competitionId, ...fields,
  });
  if (error) throw new Error(`games insert failed: ${error.message}`);
  return id;
}

/**
 * Member on A, owner on B, then RESULTS: an ACTIVE stroke game ("Locker") with
 * a score from the owner. Stroke is team-INDEPENDENT, so the owner being in it
 * does not block a change to the owner. Asserted to have results before return.
 */
async function cupWithResults(label: string): Promise<Cup> {
  const cup = await rosterCup(label);
  const { tripId, competitionId, teamA, teamB } = cup;
  await ctx.caller().teamAssignments.assign({ tripId, competitionId, userId: memberId, teamId: teamA });
  await ctx.caller().teamAssignments.assign({ tripId, competitionId, userId: ownerId, teamId: teamB });
  const gameId = await insertGame(cup, {
    game_type_id: "gtt_stroke_play", name: "Locker", status: "active",
    points_distribution: { type: "per_match", value: 2 },
  });
  await addParticipant(gameId, ownerId);
  const { error } = await ctx.admin.from("score_entries").insert({
    id: genId("se"), game_id: gameId, participant_id: ownerId,
    participant_type: "user", unit_label: "1", value: 4,
  });
  if (error) throw new Error(`score_entries insert failed: ${error.message}`);
  expect(await ctx.caller().teamAssignments.hasResults({ tripId, competitionId })).toBe(true);
  return cup;
}

/** Put a person in a game. CHECKED: `game_participants.id` has no default, and
 *  an unchecked insert that failed left this file's first draft with nobody in
 *  any game — so "not blocked" passed for a fixture that never put anyone in. */
async function addParticipant(gameId: string, userId: string): Promise<void> {
  const { error } = await ctx.admin.from("game_participants").insert({ id: genId("gp"), game_id: gameId, user_id: userId });
  if (error) throw new Error(`game_participants insert failed: ${error.message}`);
}

async function teamOf(competitionId: string, userId: string): Promise<string | null> {
  const { data, error } = await ctx.admin
    .from("team_assignments").select("team_id")
    .eq("competition_id", competitionId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`read assignment: ${error.message}`);
  return (data?.team_id as string | undefined) ?? null;
}

async function isCaptain(competitionId: string, userId: string): Promise<boolean> {
  const { data, error } = await ctx.admin
    .from("team_assignments").select("is_captain")
    .eq("competition_id", competitionId).eq("user_id", userId).single();
  if (error) throw new Error(`read captaincy: ${error.message}`);
  return data.is_captain as boolean;
}

async function teamExists(teamId: string): Promise<boolean> {
  const { data, error } = await ctx.admin.from("teams").select("id").eq("id", teamId).maybeSingle();
  if (error) throw new Error(`read team: ${error.message}`);
  return data !== null;
}

const fingerprintFor = async (cup: Cup, userId: string) =>
  (await ctx.caller().teamAssignments.previewChange({ tripId: cup.tripId, competitionId: cup.competitionId, userId })).fingerprint;

beforeAll(async () => {
  ctx = await TestContext.create();
  ownerId = ctx.user.id;
  memberId = ctx.getUser("member").id;
  plannerId = ctx.getUser("planner").id;
});

afterAll(async () => {
  await ctx.cleanup();
});

describe("before results — the working flow, untouched", () => {
  it("add, move, remove and team-delete all go straight through, with no preview", async () => {
    const cup = await rosterCup("before");
    const { tripId, competitionId, teamA, teamB } = cup;
    const caller = ctx.caller();
    expect(await caller.teamAssignments.hasResults({ tripId, competitionId })).toBe(false);

    await caller.teamAssignments.assign({ tripId, competitionId, userId: memberId, teamId: teamA });
    expect(await teamOf(competitionId, memberId)).toBe(teamA);
    await caller.teamAssignments.assign({ tripId, competitionId, userId: memberId, teamId: teamB });
    expect(await teamOf(competitionId, memberId)).toBe(teamB);
    expect(await caller.teamAssignments.remove({ tripId, competitionId, userId: memberId })).toEqual({ success: true });
    expect(await teamOf(competitionId, memberId)).toBeNull();
    const tmp = await ctx.createTeam(competitionId, "Temp Team");
    expect(await caller.teams.delete({ tripId, teamId: tmp })).toEqual({ success: true });
    expect(await teamExists(tmp)).toBe(false);
  });

  it("a captain who moves is NOT the new team's captain — even into a team that has one", async () => {
    const cup = await rosterCup("captain");
    const { tripId, competitionId, teamA, teamB } = cup;
    const caller = ctx.caller();
    await caller.teamAssignments.assign({ tripId, competitionId, userId: memberId, teamId: teamA });
    await caller.teamAssignments.assign({ tripId, competitionId, userId: plannerId, teamId: teamB });
    await caller.teamAssignments.setCaptain({ tripId, competitionId, teamId: teamA, userId: memberId, isCaptain: true });
    await caller.teamAssignments.setCaptain({ tripId, competitionId, teamId: teamB, userId: plannerId, isCaptain: true });
    expect(await isCaptain(competitionId, memberId)).toBe(true); // premise

    // Into a team WITH a captain: this used to fail on the one-captain index.
    await caller.teamAssignments.assign({ tripId, competitionId, userId: memberId, teamId: teamB });
    expect(await teamOf(competitionId, memberId)).toBe(teamB);
    expect(await isCaptain(competitionId, memberId)).toBe(false);
    expect(await isCaptain(competitionId, plannerId)).toBe(true);
  });
});

describe("after results — a move or removal is reviewed first", () => {
  it("a pure ADD still goes straight through", async () => {
    const { tripId, competitionId, teamA } = await cupWithResults("add");
    expect(await teamOf(competitionId, plannerId)).toBeNull(); // premise
    const added = await ctx.caller().teamAssignments.assign({ tripId, competitionId, userId: plannerId, teamId: teamA });
    expect(added.team_id).toBe(teamA);
  });

  it("a move WITHOUT the preview's fingerprint is refused, and nothing moves", async () => {
    const { tripId, competitionId, teamA, teamB } = await cupWithResults("move-unreviewed");
    await expect(
      ctx.caller().teamAssignments.assign({ tripId, competitionId, userId: memberId, teamId: teamB })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: PREVIEW_REQUIRED_MESSAGE });
    expect(await teamOf(competitionId, memberId)).toBe(teamA);
  });

  it("a move confirmed with the preview's fingerprint goes through (ruling 16)", async () => {
    const cup = await cupWithResults("move-reviewed");
    const fp = await fingerprintFor(cup, memberId);
    await ctx.caller().teamAssignments.assign({
      tripId: cup.tripId, competitionId: cup.competitionId, userId: memberId, teamId: cup.teamB, rosterFingerprint: fp,
    });
    expect(await teamOf(cup.competitionId, memberId)).toBe(cup.teamB);
  });

  it("a move confirmed against a roster that changed since the preview is refused", async () => {
    const cup = await cupWithResults("move-stale");
    const fp = await fingerprintFor(cup, memberId);
    // Another organizer changes the roster after the preview was built.
    await ctx.caller().teamAssignments.assign({ tripId: cup.tripId, competitionId: cup.competitionId, userId: plannerId, teamId: cup.teamA });
    await expect(
      ctx.caller().teamAssignments.assign({
        tripId: cup.tripId, competitionId: cup.competitionId, userId: memberId, teamId: cup.teamB, rosterFingerprint: fp,
      })
    ).rejects.toMatchObject({ code: "CONFLICT", message: ROSTER_CHANGED_MESSAGE });
    expect(await teamOf(cup.competitionId, memberId)).toBe(cup.teamA);
  });

  it("a removal from the team needs the preview too, and goes through with it", async () => {
    const cup = await cupWithResults("remove");
    await expect(
      ctx.caller().teamAssignments.remove({ tripId: cup.tripId, competitionId: cup.competitionId, userId: memberId })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: PREVIEW_REQUIRED_MESSAGE });
    expect(await teamOf(cup.competitionId, memberId)).toBe(cup.teamA);

    const fp = await fingerprintFor(cup, memberId);
    await ctx.caller().teamAssignments.remove({
      tripId: cup.tripId, competitionId: cup.competitionId, userId: memberId, rosterFingerprint: fp,
    });
    expect(await teamOf(cup.competitionId, memberId)).toBeNull();
  });
});

describe("after results — a change settles the clinch the way a finalize does", () => {
  /** `push_send_log` rows the clinch check wrote for this cup. */
  const clinchChecks = async (competitionId: string) => {
    const { count, error } = await ctx.admin
      .from("push_send_log").select("id", { count: "exact", head: true })
      .eq("trigger", "cup_clinched").eq("competition_id", competitionId);
    if (error) throw new Error(`read push_send_log: ${error.message}`);
    return count ?? 0;
  };

  it("a reviewed move after results runs the clinch check; a move before results does not", async () => {
    // CONTROL first: before results there is no target to move.
    const before = await rosterCup("clinch-before");
    await ctx.caller().teamAssignments.assign({ tripId: before.tripId, competitionId: before.competitionId, userId: memberId, teamId: before.teamA });
    await ctx.caller().teamAssignments.assign({ tripId: before.tripId, competitionId: before.competitionId, userId: memberId, teamId: before.teamB });
    expect(await clinchChecks(before.competitionId)).toBe(0);

    // After results: the check runs (it records every outcome, including "no
    // clincher"), so a clinch a trade created would be announced, and one it
    // undid released — not left for a later finalize to find.
    const cup = await cupWithResults("clinch-after");
    const fp = await fingerprintFor(cup, memberId);
    await ctx.caller().teamAssignments.assign({
      tripId: cup.tripId, competitionId: cup.competitionId, userId: memberId, teamId: cup.teamB, rosterFingerprint: fp,
    });
    expect(await clinchChecks(cup.competitionId)).toBe(1);
  });
});

describe("after results — refused while the person is in an unfinished team-dependent game", () => {
  it("a move is refused, NAMING the game; an unfinished stroke round does not block", async () => {
    const cup = await cupWithResults("blocked");
    const match = await insertGame(cup, { game_type_id: "gtt_match_play", name: "Hole 7 Match", status: "active" });
    await addParticipant(match, memberId);

    const preview = await ctx.caller().teamAssignments.previewChange({ tripId: cup.tripId, competitionId: cup.competitionId, userId: memberId });
    expect(preview.blocking).toEqual([{ gameId: match, name: "Hole 7 Match" }]);
    await expect(
      ctx.caller().teamAssignments.assign({
        tripId: cup.tripId, competitionId: cup.competitionId, userId: memberId, teamId: cup.teamB, rosterFingerprint: preview.fingerprint,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("Hole 7 Match") });
    expect(await teamOf(cup.competitionId, memberId)).toBe(cup.teamA);

    // CONTROL: the owner is in "Locker", an unfinished STROKE round — team-
    // independent, so the trade goes through and the round will count for the
    // new team at finalize.
    const ownerPreview = await ctx.caller().teamAssignments.previewChange({ tripId: cup.tripId, competitionId: cup.competitionId, userId: ownerId });
    expect(ownerPreview.blocking).toEqual([]);
    expect(ownerPreview.moving.map((g) => g.name)).toEqual(["Locker"]);
    await ctx.caller().teamAssignments.assign({
      tripId: cup.tripId, competitionId: cup.competitionId, userId: ownerId, teamId: cup.teamA, rosterFingerprint: ownerPreview.fingerprint,
    });
    expect(await teamOf(cup.competitionId, ownerId)).toBe(cup.teamA);
  });

  it("a FINISHED team-dependent game does not block — it is credited through its stored roster", async () => {
    const cup = await cupWithResults("finished-match");
    const match = await insertGame(cup, { game_type_id: "gtt_match_play", name: "Done Match", status: "complete" });
    await addParticipant(match, memberId);
    const fp = await fingerprintFor(cup, memberId);
    await ctx.caller().teamAssignments.assign({
      tripId: cup.tripId, competitionId: cup.competitionId, userId: memberId, teamId: cup.teamB, rosterFingerprint: fp,
    });
    expect(await teamOf(cup.competitionId, memberId)).toBe(cup.teamB);
  });

  it("an ADD is refused the same way for someone in an unfinished team-dependent game", async () => {
    const cup = await cupWithResults("add-blocked");
    const match = await insertGame(cup, { game_type_id: "gtt_match_play", name: "Unpaired Match", status: "active" });
    await addParticipant(match, plannerId);
    await expect(
      ctx.caller().teamAssignments.assign({ tripId: cup.tripId, competitionId: cup.competitionId, userId: plannerId, teamId: cup.teamA })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("Unpaired Match") });
    expect(await teamOf(cup.competitionId, plannerId)).toBeNull();
  });
});

describe("after results — deleting a team", () => {
  it("a team with banked points cannot be deleted, and says so", async () => {
    const cup = await cupWithResults("delete-banked");
    const done = await insertGame(cup, { game_type_id: "gtt_manual", name: "Cornhole", status: "complete" });
    const { error } = await ctx.admin.from("game_results").insert({
      id: genId("gr"), game_id: done, entity_type: "team", entity_id: cup.teamB,
      credited_team_id: cup.teamB, position: 1, value_kind: "rank",
    });
    if (error) throw new Error(`game_results insert failed: ${error.message}`);
    // Empty it first, so the refusal can only be the banked points.
    await ctx.admin.from("team_assignments").delete().eq("competition_id", cup.competitionId).eq("team_id", cup.teamB);

    await expect(ctx.caller().teams.delete({ tripId: cup.tripId, teamId: cup.teamB })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED", message: expect.stringContaining("Team B has results banked"),
    });
    expect(await teamExists(cup.teamB)).toBe(true);
  });

  it("a team named only in a finished game's credited roster counts as banked too", async () => {
    // Rack and pick'em build their team list from `teams`: deleting this team
    // would leave its members crediting nowhere on a correction.
    const cup = await cupWithResults("delete-roster-only");
    await insertGame(cup, {
      game_type_id: "gtt_rack_n_stack", name: "Rack", status: "complete", credited_roster: { [plannerId]: cup.teamB },
    });
    await ctx.admin.from("team_assignments").delete().eq("competition_id", cup.competitionId).eq("team_id", cup.teamB);
    await expect(ctx.caller().teams.delete({ tripId: cup.tripId, teamId: cup.teamB })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED", message: expect.stringContaining("has results banked"),
    });
    expect(await teamExists(cup.teamB)).toBe(true);
  });

  it("a team with players must be emptied first; an empty team with nothing banked goes", async () => {
    const cup = await cupWithResults("delete-players");
    await expect(ctx.caller().teams.delete({ tripId: cup.tripId, teamId: cup.teamA })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED", message: expect.stringContaining("move or remove Team A's players first"),
    });
    expect(await teamExists(cup.teamA)).toBe(true);

    const spare = await ctx.createTeam(cup.competitionId, "Spare");
    expect(await ctx.caller().teams.delete({ tripId: cup.tripId, teamId: spare })).toEqual({ success: true });
    expect(await teamExists(spare)).toBe(false);
  });
});
