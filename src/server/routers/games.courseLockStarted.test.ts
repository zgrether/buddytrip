import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { configToDraft, configDraftToPayload, type ConfigDraft } from "../../lib/configDraft";
import { buildCourseSnapshot, type CourseSnapshotInput } from "../../lib/courseSnapshot";

/**
 * #1474 — a game's course is fixed once it has results, in every shape a result
 * takes.
 *
 * Changing par and stroke index under recorded results rescores them. #1474
 * found the lock in `games.applyCourse` counting `score_entries` alone, which is
 * zero rows for an outcome-mode match game however many holes are decided
 * (CLAUDE.md #27). `applyCourse` was fixed to ask `game_started`, then retired:
 * every course now saves through `save_game_config` (#1627 moved rack's setup
 * screen; the match create screen that was its last caller was unreachable).
 *
 * So the lock that matters is the RPC's, and this file pins it for the two
 * shapes applyCourse's `game_started` check covered that no other saveConfig
 * test does:
 *  - outcome-mode match play (`match_hole_outcomes`, no `score_entries`) →
 *    COURSE_LOCKED;
 *  - a finished game with no scores at all (`games.finish` has no live-ness
 *    check, so `complete` + scoreless is reachable) → FINAL_LOCKED.
 * Stroke (`score_entries`) and skins (`skins_hole_outcomes`) are pinned in
 * games.saveConfig.test.ts and games.saveConfig.skins.test.ts. The remaining
 * `game_started` arms (bracket winners, decided non-golf matches, pick'em
 * results) belong to formats with no course row.
 *
 * Each case builds its own game, saves a course while unscored (the control: the
 * lock is not simply always shut), records a result through the app's own
 * procedure, then asserts the course change is refused AND the stored course is
 * exactly what it was. The course payload is built with `buildCourseSnapshot`,
 * the function the settings page's course row uses.
 */

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
  const { data } = await ctx.admin.from("games").select("course_id, back_course_id, scorecard_schema").eq("id", gameId).single();
  return data;
}

/** The game's settings draft as the match view builds it: stored match included,
 *  so the save carries the matches the real page sends and none of them is dirty. */
async function draftOf(tripId: string, gameId: string, a: string, b: string): Promise<ConfigDraft> {
  const game = await ctx.caller().games.getById({ tripId, gameId });
  const delegates = (await ctx.caller().games.listOrganizers({ tripId, gameId })) as { user_id: string }[];
  return configToDraft(
    game as Parameters<typeof configToDraft>[0],
    [{ matchNumber: 1, playersPerSide: 1, a: [a], b: [b], handicap: 0, pointValue: null }],
    delegates.map((d) => d.user_id)
  );
}

/** Save `courseId` as the game's course through the settings save. */
async function saveCourse(tripId: string, gameId: string, courseId: string, a: string, b: string) {
  const base = await draftOf(tripId, gameId, a, b);
  const course = await ctx.caller().courses.getById({ courseId });
  const snap = buildCourseSnapshot(course as unknown as CourseSnapshotInput, base.gameTypeId as string);
  if (!snap.ok) throw new Error(`fixture course did not snapshot: ${snap.reason}`);
  const { hash } = await ctx.caller().games.configHash({ tripId, gameId });
  await ctx.caller().games.saveConfig({
    tripId,
    gameId,
    baseHash: hash,
    payload: configDraftToPayload({ ...base, course: { id: courseId, backId: null, scorecardSchema: snap.schema } }, base),
  });
}

/** An outcome-mode singles game whose course was saved while unscored. */
async function outcomeMatchGame(name: string) {
  const { tripId, competitionId } = await ctx.createCupTrip({ name, scoringModel: "match_play", members: CREW });
  const owner = ctx.user.id;
  const planner = ctx.getUser("planner").id;
  const ta = await ctx.createTeam(competitionId, "Alpha", { shortName: "ALP" });
  const tb = await ctx.createTeam(competitionId, "Bravo", { shortName: "BRV" });
  const ins = await ctx.admin.from("team_assignments").insert([
    { competition_id: competitionId, user_id: owner, team_id: ta },
    { competition_id: competitionId, user_id: planner, team_id: tb },
  ]);
  expect(ins.error).toBeNull();
  const game = (await ctx.caller().games.create({
    tripId, gameTypeId: "gtt_match_play", name: "Singles", competitionId,
    pointsDistribution: { type: "per_match", value: 1 },
  })) as { id: string };
  await ctx.admin.from("games").update({ entry_mode: "outcome" }).eq("id", game.id);
  const [m] = (await ctx.caller().matches.setPairings({
    tripId, gameId: game.id,
    matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [planner] }, matchNumber: 1 }],
  })) as { id: string }[];
  // The control: unscored, the course saves.
  await saveCourse(tripId, game.id, courseA, owner, planner);
  const saved = await courseOf(game.id);
  expect(saved?.course_id).toBe(courseA);
  expect(saved?.scorecard_schema, "the snapshot was written with the course").toBeTruthy();
  return { tripId, gameId: game.id, matchId: m.id, owner, planner };
}

/** The course change is refused with `message`, and the stored course is untouched. */
async function expectRefused(g: { tripId: string; gameId: string; owner: string; planner: string }, message: RegExp) {
  const before = await courseOf(g.gameId);
  expect(before?.course_id, "precondition: a course is saved").toBe(courseA);
  await expect(saveCourse(g.tripId, g.gameId, courseB, g.owner, g.planner)).rejects.toThrow(message);
  expect(await courseOf(g.gameId)).toEqual(before);
}

describe("a game's course is fixed once it has results (#1474, on the settings save)", () => {
  it("outcome-mode match play: one hole recorded (zero score_entries) → refused", async () => {
    const g = await outcomeMatchGame("Lock · outcome");
    await ctx.caller().games.enableScoring({ tripId: g.tripId, gameId: g.gameId });
    await ctx.caller().matchOutcomes.upsertOutcome({ tripId: g.tripId, gameId: g.gameId, matchId: g.matchId, holeNumber: 1, result: "side_a" });
    const { count } = await ctx.admin.from("score_entries").select("id", { count: "exact", head: true }).eq("game_id", g.gameId);
    expect(count, "precondition: a score_entries count would read this game as unscored").toBe(0);
    // COURSE_LOCKED's own sentence: other locked-tier guards also say "already has
    // scores", so only this one proves the course guard is what refused.
    await expectRefused(g, /before changing its course/);
  });

  it("finished with no scores at all → refused", async () => {
    const g = await outcomeMatchGame("Lock · finished");
    await ctx.caller().games.finish({ tripId: g.tripId, gameId: g.gameId });
    const { data } = await ctx.admin.from("games").select("status").eq("id", g.gameId).single();
    expect(data?.status, "precondition: finished").toBe("complete");
    const { count } = await ctx.admin.from("match_hole_outcomes").select("id", { count: "exact", head: true }).eq("game_id", g.gameId);
    expect(count, "precondition: nothing recorded, so only the finish can lock it").toBe(0);
    await expectRefused(g, /recorded against the current course/);
  });
});
