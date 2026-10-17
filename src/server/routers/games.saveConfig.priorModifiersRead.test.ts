import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { callerFailingRead } from "../../__tests__/helpers/failingRead";

/**
 * #1657 — saveConfig's read of the game's CURRENT modifiers must fail closed.
 *
 * That read decides `gloriousChanged`, and only a glorious change recomputes
 * FINISHED matches (`skipComplete: false`, CLAUDE.md #11). A failed read used to
 * come back as `data: null`, i.e. "glorious was already off", so a save turning
 * it off skipped that recompute.
 *
 * The case where that leaves a FALSE result on screen, worked through:
 *  - with 3 glorious holes, side A winning every hole closes out at hole 11,
 *    "11&7": 11 up, with 7 holes left whose swing is 10 (three count double).
 *    After 10 it is 10 up against a swing of 11, so still live;
 *  - without glorious it closes at hole 10, "10&8": 10 up with 8 left;
 *  - turning glorious off is PERMITTED (migration 178): nothing in the 16-18
 *    window was ever played;
 *  - so the stored margin must move to "10&8", and a skipped recompute leaves
 *    "11&7", a margin that is no longer true.
 *
 * The CONTROL is that save through a working read, moving the margin to
 * "10&8". It shows the fixture can express the recompute the failed read used
 * to skip.
 */

let ctx: TestContext;
const gameIds: string[] = [];

interface Fixture {
  tripId: string;
  gameId: string;
  matchId: string;
}

/** A live outcome-mode match-play game with one match, glorious on at N=3.
 *  Outcome mode is required: glorious only applies to hole-outcome entry. */
async function fixture(name: string): Promise<Fixture> {
  const owner = ctx.getUser("owner").id;
  const member = ctx.getUser("member").id;
  const { tripId, competitionId } = await ctx.createCupTrip({
    title: "Prior Modifiers Read Trip",
    name: `${name} cup`,
    members: ["member"],
  });
  const teamA = await ctx.createTeam(competitionId, "Alpha", { shortName: "ALP" });
  const teamB = await ctx.createTeam(competitionId, "Bravo", { shortName: "BRV" });
  await ctx.admin.from("team_assignments").insert([
    { competition_id: competitionId, user_id: owner, team_id: teamA },
    { competition_id: competitionId, user_id: member, team_id: teamB },
  ]);
  const g = (await ctx.caller().games.create({
    tripId, gameTypeId: "gtt_match_play", name, competitionId,
  })) as { id: string };
  gameIds.push(g.id);
  await ctx.admin.from("games").update({
    status: "active", scoring_enabled: true, entry_mode: "outcome",
    points_total: 10, points_distribution: { type: "per_match", value: 10 },
    scorecard_schema: { units: { count: 18, label: "hole" } },
    modifiers: { glorious_holes: { holes: 3 } },
  }).eq("id", g.id);
  const matchId = crypto.randomUUID();
  await ctx.admin.from("game_matches").insert({
    id: matchId, game_id: g.id, match_number: 1, display_order: 1,
    side_a: { type: "user", id: owner }, side_b: { type: "user", id: member },
  });
  // Side A wins holes 1-11. Nothing in the 16-18 window is played.
  const rows = Array.from({ length: 11 }, (_, i) => ({
    id: crypto.randomUUID(), game_id: g.id, match_id: matchId, hole_number: i + 1, result: "side_a", submitted_by: owner,
  }));
  const { error } = await ctx.admin.from("match_hole_outcomes").insert(rows);
  if (error) throw new Error(`fixture outcomes rejected: ${error.message}`);
  await ctx.caller().games.finish({ tripId, gameId: g.id });
  await ctx.caller().games.openCorrection({ tripId, gameId: g.id });
  return { tripId, gameId: g.id, matchId };
}

/** The real saveConfig payload with glorious turned OFF, structure unchanged. */
async function turnOffInput(f: Fixture) {
  const { data: g } = await ctx.admin.from("games").select("*").eq("id", f.gameId).single();
  const baseHash = (await ctx.caller().games.configHash({ tripId: f.tripId, gameId: f.gameId })).hash;
  return {
    tripId: f.tripId, gameId: f.gameId, baseHash,
    payload: {
      name: g!.name as string,
      rulesForToday: (g!.rules_for_today as string | null) ?? null,
      scoringEnabled: true,
      pointsTotal: (g!.points_total as number | null) ?? 10,
      pointsDistribution: g!.points_distribution ?? null,
      courseId: null, backCourseId: null,
      scorecardSchema: g!.scorecard_schema ?? null,
      delegates: [],
      modifiers: {},
      matchesStructureDirty: false,
      groupsStructureDirty: false,
    },
  };
}

const matchRow = async (f: Fixture) =>
  (await ctx.admin.from("game_matches").select("status, result, margin").eq("id", f.matchId).single()).data;
const modifiersOf = async (f: Fixture) =>
  (await ctx.admin.from("games").select("modifiers").eq("id", f.gameId).single()).data?.modifiers;

beforeAll(async () => {
  ctx = await TestContext.create();
}, 60_000);

afterAll(async () => {
  if (gameIds.length > 0) {
    await ctx.admin.from("match_hole_outcomes").delete().in("game_id", gameIds);
    await ctx.admin.from("game_matches").delete().in("game_id", gameIds);
    await ctx.admin.from("games").delete().in("id", gameIds);
  }
  await ctx.cleanup();
}, 60_000);

describe("saveConfig's read of the current modifiers fails closed (#1657)", () => {
  it("a failed read refuses the save, before anything is written", async () => {
    const f = await fixture("failed read");
    expect(await matchRow(f)).toMatchObject({ status: "complete", result: "a_win", margin: "11&7" });

    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      callerFailingRead(ctx, "owner", { table: "games", columns: "modifiers" }).games.saveConfig(await turnOffInput(f))
    ).rejects.toThrow("Couldn't check the game's current modifiers just now");
    vi.restoreAllMocks();

    // Nothing moved: glorious is still on, and the match still reads 11&7.
    expect(await modifiersOf(f)).toEqual({ glorious_holes: { holes: 3 } });
    expect(await matchRow(f)).toMatchObject({ margin: "11&7" });
  }, 120_000);

  it("CONTROL: through a working read, turning glorious off re-derives the finished match to 10&8", async () => {
    const f = await fixture("working read");
    expect(await matchRow(f)).toMatchObject({ status: "complete", result: "a_win", margin: "11&7" });

    await ctx.caller().games.saveConfig(await turnOffInput(f));

    expect(await modifiersOf(f)).toEqual({});
    expect(await matchRow(f)).toMatchObject({ status: "complete", result: "a_win", margin: "10&8" });
  }, 120_000);
});
