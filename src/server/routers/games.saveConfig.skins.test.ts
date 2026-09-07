import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * MIGRATION 185 — `save_game_config` learns about skins.
 *
 * Three edits, three different classes of miss, and each case below is written
 * so it FAILS against the un-edited function rather than merely passing against
 * the edited one. That distinction matters here because the whole function is
 * replaced wholesale: a test that passes either way tells a reviewer nothing
 * about a 1100-line diff.
 *
 *   1 · `v_has_scores` had never heard of `skins_hole_outcomes`, so a fully
 *       played skins game read as scoreless to every locked-tier guard. The
 *       observable consequence for this format is COURSE_LOCKED, which is what
 *       the first case exercises.
 *
 *   2 · the groupings freeze, which is new behaviour and NOT covered by edit 1.
 *       The guard beneath it asks whether a SCORED PLAYER was dropped — over
 *       `score_entries`, which a skins game never writes — so it answers no for
 *       every skins payload however many holes are recorded.
 *
 *   3 · the go-live arm. Skins fell into the manual branch, which asks only for
 *       a point value, so a game with NO GROUPS AT ALL could be switched on.
 *       That is the case with no member who may write and no pot to write into.
 */

const SKINS = "gtt_skins";

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let owner: string, member: string;
let courseA: string, courseB: string;
const gameIds: string[] = [];

interface Scalars {
  name: string;
  rulesForToday: string | null;
  scoringEnabled: boolean;
  modifiers: Record<string, Record<string, unknown>>;
  pointsTotal: number | null;
  pointsDistribution: unknown;
  courseId: string | null;
  backCourseId: string | null;
  scorecardSchema: unknown;
  delegates: string[];
}

async function newSkinsGame(name: string, opts?: { courseId?: string }): Promise<string> {
  const g = (await ctx.caller().games.create({
    tripId, gameTypeId: SKINS, name, competitionId,
  })) as { id: string };
  gameIds.push(g.id);
  if (opts?.courseId) {
    await ctx.admin.from("games").update({ course_id: opts.courseId }).eq("id", g.id);
  }
  return g.id;
}

async function hashOf(gameId: string): Promise<string> {
  return (await ctx.caller().games.configHash({ tripId, gameId })).hash;
}

/** Echo the game's current scalars so a save changes ONLY the slice passed in —
 *  the RPC's scalar UPDATE writes the full set every time. Same helper shape as
 *  `games.saveConfig.p2.test.ts`. */
async function scalars(gameId: string): Promise<Scalars> {
  const g = (await ctx.caller().games.getById({ tripId, gameId })) as Record<string, unknown>;
  const orgs = (await ctx.caller().games.listOrganizers({ tripId, gameId })) as { user_id: string }[];
  return {
    name: (g.name as string) ?? "Game",
    rulesForToday: (g.rules_for_today as string | null) ?? null,
    scoringEnabled: (g.scoring_enabled as boolean) ?? false,
    modifiers: (g.modifiers as Record<string, Record<string, unknown>>) ?? {},
    pointsTotal: (g.points_total as number | null) ?? null,
    pointsDistribution: g.points_distribution ?? null,
    courseId: (g.course_id as string | null) ?? null,
    backCourseId: (g.back_course_id as string | null) ?? null,
    scorecardSchema: g.scorecard_schema ?? null,
    delegates: orgs.map((d) => d.user_id),
  };
}

type Group = { name?: string; teeTime?: string | null; userIds: string[] };

async function save(
  gameId: string,
  slice: {
    groups?: Group[];
    groupsStructureDirty?: boolean;
    scoringEnabled?: boolean;
    pointsTotal?: number;
    courseId?: string;
  }
) {
  const s = await scalars(gameId);
  const payload = {
    ...s,
    scoringEnabled: slice.scoringEnabled ?? s.scoringEnabled,
    ...(slice.pointsTotal !== undefined ? { pointsTotal: slice.pointsTotal } : {}),
    ...(slice.courseId !== undefined ? { courseId: slice.courseId } : {}),
    ...(slice.groups !== undefined
      ? { groups: slice.groups, groupsStructureDirty: slice.groupsStructureDirty ?? true }
      : {}),
  };
  await ctx.caller().games.saveConfig({ tripId, gameId, baseHash: await hashOf(gameId), payload });
}

/** Record one hole for a grouping, as the service role — this file is about the
 *  RPC's guards, not about who may write (that is `skinsHoleOutcomes.rls.test.ts`). */
async function recordHole(gameId: string, groupingId: string, hole: number) {
  const { error } = await ctx.admin.from("skins_hole_outcomes").insert({
    id: genId("sho"), game_id: gameId, grouping_id: groupingId,
    hole_number: hole, result: "tied", winner_user_id: null, submitted_by: owner,
  });
  expect(error, "fixture failed to record a hole").toBeNull();
}

/** The grouping the RPC just minted for this game. Ids are re-minted on every
 *  structural groups save, so this must be re-read rather than remembered. */
async function groupingOf(gameId: string): Promise<string> {
  const { data } = await ctx.admin.from("play_groups").select("id").eq("game_id", gameId);
  expect(data?.length, "expected exactly one grouping on the fixture").toBe(1);
  return data![0].id as string;
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("saveConfig skins Trip");
  await ctx.addTripMember(tripId, "member", "Member");
  owner = ctx.user.id;
  member = ctx.getUser("member").id;
  competitionId = await ctx.createCompetition(tripId, "Skins Cup");

  const par = [4, 5, 3, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 4, 5, 4];
  const idx = [7, 3, 15, 1, 11, 5, 17, 9, 13, 8, 4, 16, 2, 12, 6, 18, 10, 14];
  for (const [slot, name] of [["a", "Skins Course A"], ["b", "Skins Course B"]] as const) {
    const id = genId("course");
    await ctx.admin.from("courses").insert({ id, name, hole_count: 18, par, handicap_index: idx });
    if (slot === "a") courseA = id;
    else courseB = id;
  }
}, 60_000);

afterAll(async () => {
  if (gameIds.length > 0) {
    await ctx.admin.from("skins_hole_outcomes").delete().in("game_id", gameIds);
    await ctx.admin.from("game_participants").delete().in("game_id", gameIds);
    await ctx.admin.from("play_groups").delete().in("game_id", gameIds);
    await ctx.admin.from("game_delegates").delete().in("game_id", gameIds);
    await ctx.admin.from("games").delete().in("id", gameIds);
  }
  await ctx.admin.from("courses").delete().in("id", [courseA, courseB].filter(Boolean));
  await ctx.cleanup();
}, 60_000);

describe("185 · v_has_scores sees the seventh shape", () => {
  it("a recorded hole LOCKS the course — and an unplayed skins game does not", async () => {
    /**
     * The pair is the point. Without edit 1 the played game's course change is
     * ADMITTED, and this file goes red on the first expectation; with edit 1 but
     * a guard that refused unconditionally, the second expectation goes red.
     * Only the shipped version passes both.
     */
    const played = await newSkinsGame("Course lock — played", { courseId: courseA });
    await save(played, { groups: [{ name: "G1", userIds: [owner, member] }] });
    await recordHole(played, await groupingOf(played), 1);

    await expect(save(played, { courseId: courseB })).rejects.toThrow(/Reset scores/i);

    const clean = await newSkinsGame("Course lock — unplayed", { courseId: courseA });
    await save(clean, { groups: [{ name: "G1", userIds: [owner, member] }] });
    await expect(save(clean, { courseId: courseB })).resolves.toBeUndefined();
  }, 60_000);
});

describe("185 · the groupings freeze", () => {
  it("a RENAME with the same people is refused once a hole is recorded", async () => {
    /**
     * The case that separates this guard from edit 1 and from the guard beneath
     * it. Nobody is dropped, nobody is added — and the RPC would still DELETE
     * every `play_groups` row and re-insert with fresh ids, taking the recorded
     * hole with them through the FK cascade.
     *
     * Written as a rename deliberately: the obvious guard ("don't drop a scored
     * player") passes this and destroys the data anyway.
     */
    const gameId = await newSkinsGame("Groupings freeze");
    await save(gameId, { groups: [{ name: "G1", userIds: [owner, member] }] });
    const groupingId = await groupingOf(gameId);
    await recordHole(gameId, groupingId, 1);

    await expect(
      save(gameId, { groups: [{ name: "Renamed", userIds: [owner, member] }] })
    ).rejects.toThrow(/Reset scores/i);

    // …and the hole is still there. A refusal that had let the delete through
    // first would satisfy the throw above and lose the row anyway.
    const { count } = await ctx.admin
      .from("skins_hole_outcomes")
      .select("id", { count: "exact", head: true })
      .eq("game_id", gameId);
    expect(count).toBe(1);
    expect(await groupingOf(gameId)).toBe(groupingId);
  }, 60_000);

  it("RESET clears the freeze — the refusal names an action that works", async () => {
    /**
     * CLAUDE.md's refusal rule, as a test. The message sends the reader to Reset
     * scores in the Danger zone; if `_reset_game_scoring` did not reach this
     * table (migration 184's addition) the groupings would be frozen forever and
     * the instruction would be a lie.
     */
    const gameId = await newSkinsGame("Groupings freeze — reset");
    await save(gameId, { groups: [{ name: "G1", userIds: [owner, member] }] });
    await recordHole(gameId, await groupingOf(gameId), 1);
    await expect(
      save(gameId, { groups: [{ name: "Renamed", userIds: [owner, member] }] })
    ).rejects.toThrow(/Reset scores/i);

    await ctx.admin.rpc("_reset_game_scoring", { p_game_id: gameId });

    await expect(
      save(gameId, { groups: [{ name: "Renamed", userIds: [owner, member] }] })
    ).resolves.toBeUndefined();
  }, 60_000);

  it("an unplayed skins game re-groups freely", async () => {
    // The guard is a freeze, not a ban. Without this the file would pass against
    // a build that refused every groups save on every skins game.
    const gameId = await newSkinsGame("Groupings open");
    await save(gameId, { groups: [{ name: "G1", userIds: [owner] }] });
    await expect(
      save(gameId, { groups: [{ name: "G1", userIds: [owner] }, { name: "G2", userIds: [member] }] })
    ).resolves.toBeUndefined();
  }, 60_000);
});

describe("185 · the go-live arm", () => {
  it("a GROUPLESS skins game cannot be switched on, even with a point value", async () => {
    /**
     * The separating case, and the reason edit 3 is a correctness fix rather
     * than a convenience.
     *
     * Before it, skins fell to the manual arm, which asks only for a point
     * value — so this exact call SUCCEEDED. A groupless skins game has no
     * grouping for `can_score_skins_grouping` to admit anybody through and no
     * carryover boundary to record into: the board could not be filled in by
     * anyone.
     */
    const gameId = await newSkinsGame("Go live — no groups");
    await expect(
      save(gameId, { pointsTotal: 4, scoringEnabled: true })
    ).rejects.toThrow(/finish setting up/i);
  }, 60_000);

  it("…and a grouped one can", async () => {
    const gameId = await newSkinsGame("Go live — grouped");
    await save(gameId, { groups: [{ name: "G1", userIds: [owner, member] }] });
    await expect(
      save(gameId, { pointsTotal: 4, scoringEnabled: true })
    ).resolves.toBeUndefined();

    const g = (await ctx.caller().games.getById({ tripId, gameId })) as Record<string, unknown>;
    expect(g.scoring_enabled).toBe(true);
  }, 60_000);
});
