import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId, getAdminClient } from "../../__tests__/helpers/test-setup";
import { competitionHasResults } from "./rosterLock";

/**
 * #1018 — the roster lock could not see a pick'em.
 *
 * `competitionHasResults` decides when a cup's rosters lock. It counted
 * `score_entries` (+ `match_hole_outcomes`), and a pick'em writes ZERO rows in
 * both at every stage of its life — its outcomes live in
 * `pickem_slate_games.result`. So a cup whose only started game was a pick'em
 * never locked.
 *
 * This case used to sit at the end of `tripMembers.removalGuard.pickem.test.ts`,
 * beside six cases about the removal WARNING seeing a pick'em (#1151). PR 8d-3
 * retired that warning's game check (the sheets show only an expense count, and
 * the archive decides what is history), so those six went with it and this one
 * moved next to the code it tests.
 *
 * Every fixture is pick'em-only, with no score anywhere: a golf game with a
 * score re-tests the path that already worked, which is how the defect survived
 * two passes over these guards.
 */

const PICKEM = "gtt_pickem";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
}, 90_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

/** Insert a fixture row, failing LOUDLY — a silently-absent row makes a test
 *  pass by absence. */
async function seed(table: string, rows: Record<string, unknown> | Record<string, unknown>[]) {
  const { error } = await ctx.admin.from(table).insert(rows as never);
  if (error) throw new Error(`fixture insert into ${table} failed: ${error.message}`);
}

/** A locked pick'em with two slate games and one sheet, and no result yet. */
async function makePickem(opts: {
  name: string;
  sheetFor: string[];
  competitionId: string;
  tripId: string;
}): Promise<{ gameId: string; slateIds: string[] }> {
  const gameId = genId("pkgame");
  await seed("games", {
    id: gameId,
    trip_id: opts.tripId,
    competition_id: opts.competitionId,
    game_type_id: PICKEM,
    name: opts.name,
  });
  await seed("pickem_games", {
    game_id: gameId,
    use_confidence: false,
    // Opened an hour ago and hand-locked: picks are closed and revealed, which
    // is the state a game is in once results start landing.
    picks_opened_at: new Date(Date.now() - 3_600_000).toISOString(),
    picks_locked_at: new Date(Date.now() - 60_000).toISOString(),
  });
  const slateIds = [genId("sl"), genId("sl")];
  await seed(
    "pickem_slate_games",
    slateIds.map((id, i) => ({ id, game_id: gameId, display_order: i, away_team: `Away ${i}`, home_team: `Home ${i}` }))
  );
  for (const uid of opts.sheetFor) {
    await seed(
      "pickem_picks",
      slateIds.map((sid) => ({ id: genId("pk"), game_id: gameId, slate_game_id: sid, user_id: uid, pick: "home" }))
    );
  }
  return { gameId, slateIds };
}

async function dropPickem(gameId: string) {
  await ctx.admin.from("pickem_picks").delete().eq("game_id", gameId);
  await ctx.admin.from("pickem_slate_games").delete().eq("game_id", gameId);
  await ctx.admin.from("pickem_games").delete().eq("game_id", gameId);
  await ctx.admin.from("games").delete().eq("id", gameId);
}

describe("competitionHasResults — a pick'em result starts the cup (#1018)", () => {
  it("not before a result is recorded, and as soon as one is", async () => {
    const { tripId, competitionId } = await ctx.createCupTrip({
      title: "Roster Lock Pick'em Trip",
      name: "Roster Lock Cup",
      members: ["member", "outsider"],
    });

    const before = await competitionHasResults(getAdminClient(), competitionId);
    expect(before, "a cup with no games has not started").toBe(false);

    const { gameId, slateIds } = await makePickem({
      name: "Lock Slate",
      sheetFor: [ctx.getUser("member").id],
      competitionId,
      tripId,
    });

    // Non-vacuity: the pick'em exists and is NOT started, so a `true` below
    // cannot come from the mere presence of a game.
    expect(
      await competitionHasResults(getAdminClient(), competitionId),
      "picks submitted but no result is not started"
    ).toBe(false);

    await ctx.admin.from("pickem_slate_games").update({ result: "away" }).eq("id", slateIds[1]);

    expect(
      await competitionHasResults(getAdminClient(), competitionId),
      "a recorded slate result starts the cup — this is the #1018 fix"
    ).toBe(true);

    await dropPickem(gameId);
  }, 90_000);
});
