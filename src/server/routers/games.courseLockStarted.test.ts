import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { callerFailingRead } from "../../__tests__/helpers/failingRead";

/**
 * #1474 — the course lock asks `game_started`, not `score_entries`.
 *
 * `games.applyCourse` / `games.clearCourse` refuse once a game has been scored,
 * because changing par and stroke index under recorded results rescores them.
 * They used to count `score_entries` alone, which is zero rows for an
 * outcome-mode match game and for skins however many holes are recorded
 * (CLAUDE.md #27). Both read as unscored and their course could change. The
 * lock now reads `game_started`, the one definition every other "has this been
 * played" question uses.
 *
 * Each case builds its own game, applies a course while unscored (the control:
 * the lock is not simply always shut), records ONE result through the app's own
 * procedure, then asserts both procedures refuse AND the game's course is
 * exactly what it was.
 *
 * Reachability, for the record: no screen calls these today. Every game view
 * renders the course row in its controlled (draft-then-save) mode, which goes
 * through `save_game_config` and its own three-table check. A direct API call
 * reaches them, and they are the procedures a future uncontrolled surface would
 * use.
 */

const LOCKED = "Scores are already entered — the course can't be changed now.";
const READ_FAILED = "Couldn't check the scores just now. This is temporary — try again in a moment.";

let ctx: TestContext;
let courseA: string;
let courseB: string;
const createdCourses: string[] = [];
const CREW: NonNullable<NonNullable<Parameters<TestContext["createCupTrip"]>[0]>["members"]> = [
  ["planner", "Organizer"],
  ["member", "Member"],
  ["outsider", "Member"],
];

async function make18(name: string) {
  const c = await ctx.caller().courses.create({
    name, holeCount: 18, par: Array(18).fill(4),
    handicapIndex: Array.from({ length: 18 }, (_, i) => i + 1), hasStrokeIndex: true,
    teeSets: [{ name: "White", yards: Array(18).fill(350) }], source: "manual",
  });
  createdCourses.push(c.id as string);
  return c.id as string;
}

beforeAll(async () => {
  ctx = await TestContext.create();
  courseA = await make18(`Lock A ${Date.now()}`);
  courseB = await make18(`Lock B ${Date.now()}`);
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
  if (createdCourses.length) await ctx.admin.from("courses").delete().in("id", createdCourses);
}, 60_000);

async function courseOf(gameId: string) {
  const { data } = await ctx.admin.from("games").select("course_id, scorecard_schema").eq("id", gameId).single();
  return data;
}

/** Both procedures refuse with `message`, and the course is untouched. */
async function expectLocked(tripId: string, gameId: string, message: string, caller = ctx.caller()) {
  const before = await courseOf(gameId);
  expect(before?.course_id, "precondition: a course is applied").toBe(courseA);
  await expect(caller.games.applyCourse({ tripId, gameId, courseId: courseB })).rejects.toThrow(message);
  await expect(caller.games.clearCourse({ tripId, gameId })).rejects.toThrow(message);
  expect(await courseOf(gameId)).toEqual(before);
}

async function twoTeams(competitionId: string, a: string[], b: string[]) {
  const ta = await ctx.createTeam(competitionId, "Alpha", { shortName: "ALP" });
  const tb = await ctx.createTeam(competitionId, "Bravo", { shortName: "BRV" });
  const ins = await ctx.admin.from("team_assignments").insert([
    ...a.map((user_id) => ({ competition_id: competitionId, user_id, team_id: ta })),
    ...b.map((user_id) => ({ competition_id: competitionId, user_id, team_id: tb })),
  ]);
  expect(ins.error).toBeNull();
}

/** An outcome-mode match game with a course applied while unscored. */
async function outcomeMatchGame(name: string) {
  const { tripId, competitionId } = await ctx.createCupTrip({ name, scoringModel: "match_play", members: CREW });
  const owner = ctx.user.id;
  const planner = ctx.getUser("planner").id;
  await twoTeams(competitionId, [owner], [planner]);
  const game = (await ctx.caller().games.create({
    tripId, gameTypeId: "gtt_match_play", name: "Singles", competitionId,
    pointsDistribution: { type: "per_match", value: 1 },
  })) as { id: string };
  await ctx.admin.from("games").update({ entry_mode: "outcome" }).eq("id", game.id);
  const [m] = (await ctx.caller().matches.setPairings({
    tripId, gameId: game.id,
    matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [planner] }, matchNumber: 1 }],
  })) as { id: string }[];
  // The control: unscored, the course applies.
  await ctx.caller().games.applyCourse({ tripId, gameId: game.id, courseId: courseA });
  expect((await courseOf(game.id))?.course_id).toBe(courseA);
  await ctx.caller().games.enableScoring({ tripId, gameId: game.id });
  return { tripId, gameId: game.id, matchId: m.id };
}

describe("the course lock reads game_started (#1474)", () => {
  it("outcome-mode match play: one hole recorded (zero score_entries) → locked", async () => {
    const { tripId, gameId, matchId } = await outcomeMatchGame("Lock · outcome");
    await ctx.caller().matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: 1, result: "side_a" });
    const { count } = await ctx.admin.from("score_entries").select("id", { count: "exact", head: true }).eq("game_id", gameId);
    expect(count, "precondition: the old count would have read this game as unscored").toBe(0);
    await expectLocked(tripId, gameId, LOCKED);
  });

  it("skins: one hole recorded (zero score_entries) → locked", async () => {
    const { tripId, competitionId } = await ctx.createCupTrip({ name: "Lock · skins", scoringModel: "points", members: CREW });
    const owner = ctx.user.id;
    const planner = ctx.getUser("planner").id;
    const game = (await ctx.caller().games.create({
      tripId, gameTypeId: "gtt_skins", name: "Skins", competitionId,
      pointsDistribution: { type: "placement", values: [6, 2] },
    })) as { id: string };
    await ctx.caller().games.addParticipants({ tripId, gameId: game.id, userIds: [owner, planner] });
    const g1 = await ctx.groupStrokeParticipants(game.id, [owner, planner]);
    await ctx.caller().games.applyCourse({ tripId, gameId: game.id, courseId: courseA });
    expect((await courseOf(game.id))?.course_id).toBe(courseA);
    await ctx.caller().games.enableScoring({ tripId, gameId: game.id });
    await ctx.caller().skinsOutcomes.upsertHole({ tripId, gameId: game.id, groupingId: g1, holeNumber: 1, result: "won", winnerId: owner });
    const { count } = await ctx.admin.from("score_entries").select("id", { count: "exact", head: true }).eq("game_id", game.id);
    expect(count, "precondition: the old count would have read this game as unscored").toBe(0);
    await expectLocked(tripId, game.id, LOCKED);
  });

  it("stroke play: a score entry still locks it (the arm the old count had)", async () => {
    const tripId = await ctx.createTrip("Lock · stroke");
    const owner = ctx.user.id;
    await ctx.addTripMember(tripId, "member", "Member");
    const member = ctx.getUser("member").id;
    const game = (await ctx.caller().games.create({ tripId, gameTypeId: "gtt_stroke_play", name: "Stroke" })) as { id: string };
    await ctx.caller().games.addParticipants({ tripId, gameId: game.id, userIds: [owner, member] });
    await ctx.groupStrokeParticipants(game.id, [owner, member]);
    await ctx.caller().games.applyCourse({ tripId, gameId: game.id, courseId: courseA });
    await ctx.caller().games.enableScoring({ tripId, gameId: game.id });
    await ctx.caller().scores.upsertEntry({ tripId, gameId: game.id, participantId: owner, unitLabel: "1", value: 4 });
    await expectLocked(tripId, game.id, LOCKED);
  });

  it("a failed game_started read refuses (fails closed) and changes nothing", async () => {
    // Unscored, so only the failure can be what refuses. The sentence is the
    // rowsOrThrow family's, which no other door produces.
    const { tripId, gameId } = await outcomeMatchGame("Lock · read fails");
    const failing = callerFailingRead(ctx, "owner", { table: "game_started", columns: "game_id" });
    await expectLocked(tripId, gameId, READ_FAILED, failing);
  });
});
