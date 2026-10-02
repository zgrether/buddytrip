import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * Migration 203's database contract for `games.credited_roster`, on its own —
 * no writer involved, so it holds whatever code calls the RPC (PR 8a lands the
 * migration ahead of the writers that use it).
 *
 *   - `write_game_results` records a roster only while the game has none, so a
 *     re-finalize can never replace the roster a game was credited through;
 *   - it refuses a roster that is not a map;
 *   - omitting it (every caller before 8a) records nothing;
 *   - a scoring reset clears it, so a replayed game is credited afresh;
 *   - the guest merge re-keys it, the real account winning a collision.
 *
 * Every case builds its own cup and game: these are destructive writes, and a
 * shared game would make each case depend on the one before (CLAUDE.md).
 */

let ctx: TestContext;
let owner: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  owner = ctx.getUser("owner").id;
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

async function freshGame(name: string) {
  const { tripId, competitionId } = await ctx.createCupTrip({ name, scoringModel: "points" });
  const alpha = await ctx.createTeam(competitionId, "Alpha", { shortName: "ALP" });
  const bravo = await ctx.createTeam(competitionId, "Bravo", { shortName: "BRV" });
  const game = (await ctx.caller().games.create({
    tripId, gameTypeId: "gtt_stroke_play", name: `${name} round`, competitionId,
  })) as { id: string };
  return { tripId, gameId: game.id, alpha, bravo };
}

async function creditedRoster(gameId: string): Promise<unknown> {
  const { data, error } = await ctx.admin.from("games").select("credited_roster").eq("id", gameId).single();
  if (error) throw error;
  return data.credited_roster;
}

/** Through the real wrapper, as the trip owner (it runs `assert_game_edit`). */
const write = (gameId: string, roster?: unknown) =>
  ctx.authedClient("owner").rpc("write_game_results", {
    p_game_id: gameId, p_rows: [], p_scope: "all",
    ...(roster === undefined ? {} : { p_credited_roster: roster }),
  });

describe("write_game_results and games.credited_roster", () => {
  it("records the FIRST roster and never replaces it", async () => {
    const g = await freshGame("First wins");
    expect(await creditedRoster(g.gameId)).toBeNull();

    expect((await write(g.gameId, { [owner]: g.alpha })).error).toBeNull();
    expect(await creditedRoster(g.gameId)).toEqual({ [owner]: g.alpha });

    // A second roster — what a re-finalize after a trade would pass — is ignored.
    expect((await write(g.gameId, { [owner]: g.bravo })).error).toBeNull();
    expect(await creditedRoster(g.gameId)).toEqual({ [owner]: g.alpha });
  });

  it("records an EMPTY roster as empty — credited with nobody on a team, not 'never credited'", async () => {
    const g = await freshGame("Empty roster");
    expect((await write(g.gameId, {})).error).toBeNull();
    expect(await creditedRoster(g.gameId)).toEqual({});
  });

  it("omitting the roster records nothing — every caller before 8a", async () => {
    const g = await freshGame("No roster passed");
    expect((await write(g.gameId)).error).toBeNull();
    expect(await creditedRoster(g.gameId)).toBeNull();
  });

  it("refuses a roster that is not a map, on a game where it would otherwise land", async () => {
    const g = await freshGame("Non-map refused");
    const { error } = await write(g.gameId, [owner]);
    expect(error?.message).toContain("CREDITED_ROSTER_NOT_OBJECT");
    expect(await creditedRoster(g.gameId)).toBeNull();
  });

  it("a scoring reset clears it, so the replayed game's next finalize records afresh", async () => {
    const g = await freshGame("Reset clears");
    await write(g.gameId, { [owner]: g.alpha });
    expect(await creditedRoster(g.gameId)).toEqual({ [owner]: g.alpha });

    await ctx.caller().games.resetScoring({ tripId: g.tripId, gameId: g.gameId });
    expect(await creditedRoster(g.gameId)).toBeNull();

    await write(g.gameId, { [owner]: g.bravo });
    expect(await creditedRoster(g.gameId)).toEqual({ [owner]: g.bravo });
  });
});

describe("the guest merge re-keys a credited roster", () => {
  it("moves a placeholder's team to the real account, and the real account wins a collision", async () => {
    const g = await freshGame("Merge re-key");
    const ghostA = `ghost-${crypto.randomUUID()}`;
    const ghostB = `ghost-${crypto.randomUUID()}`;
    const real = await ctx.createAccount("credited-roster-merge");
    for (const id of [ghostA, ghostB]) {
      const { error } = await ctx.admin.from("users").insert({ id, name: "Placeholder", is_guest: true });
      if (error) throw error;
    }

    // Plain move: only the placeholder was on the roster.
    await ctx.admin.from("games").update({ credited_roster: { [ghostA]: g.alpha, [owner]: g.bravo } }).eq("id", g.gameId);
    const moved = await ctx.admin.rpc("merge_guest_to_real_user", { p_ghost_id: ghostA, p_real_id: real.id });
    expect(moved.error).toBeNull();
    expect(await creditedRoster(g.gameId)).toEqual({ [real.id]: g.alpha, [owner]: g.bravo });

    // Collision: both were on the roster; the real account's entry stands.
    await ctx.admin.from("games").update({ credited_roster: { [ghostB]: g.alpha, [real.id]: g.bravo } }).eq("id", g.gameId);
    const collided = await ctx.admin.rpc("merge_guest_to_real_user", { p_ghost_id: ghostB, p_real_id: real.id });
    expect(collided.error).toBeNull();
    expect(await creditedRoster(g.gameId)).toEqual({ [real.id]: g.bravo });
  });
});

describe("_backfill_credited_rosters — games finished before 203", () => {
  /** A game row straight into the table: the backfill reads STORED state, so the
   *  fixture is the state, not a path that produces it. */
  async function seedGame(tripId: string, competitionId: string | null, status: "active" | "complete", credited?: unknown) {
    const id = crypto.randomUUID();
    const { error } = await ctx.admin.from("games").insert({
      id, trip_id: tripId, competition_id: competitionId, game_type_id: "gtt_manual",
      name: `backfill ${status}`, status, ...(credited === undefined ? {} : { credited_roster: credited }),
    });
    if (error) throw error;
    return id;
  }

  it("fills every finished cup game from its cup's roster, and nothing else", async () => {
    const { tripId, competitionId } = await ctx.createCupTrip({
      name: "Backfill cup", scoringModel: "points", members: [["member", "Member"]],
    });
    const alpha = await ctx.createTeam(competitionId, "Alpha", { shortName: "ALP" });
    const bravo = await ctx.createTeam(competitionId, "Bravo", { shortName: "BRV" });
    const member = ctx.getUser("member").id;
    await ctx.admin.from("team_assignments").insert([
      { competition_id: competitionId, user_id: owner, team_id: alpha },
      { competition_id: competitionId, user_id: member, team_id: bravo },
    ]);
    // A second cup with NOBODY on a team (a teamless race).
    const teamless = await ctx.createCupTrip({ name: "Backfill teamless", scoringModel: "points" });

    const finished = await seedGame(tripId, competitionId, "complete");
    const finishedTeamless = await seedGame(teamless.tripId, teamless.competitionId, "complete");
    const live = await seedGame(tripId, competitionId, "active");
    const side = await seedGame(tripId, null, "complete");
    const alreadyCredited = await seedGame(tripId, competitionId, "complete", { [owner]: bravo });
    const ids = [finished, finishedTeamless, live, side, alreadyCredited];

    const filled = await ctx.admin.rpc("_backfill_credited_rosters", { p_game_ids: ids });
    expect(filled.error).toBeNull();
    expect(filled.data).toBe(2);

    expect(await creditedRoster(finished)).toEqual({ [owner]: alpha, [member]: bravo });
    // Credited with nobody — `{}`, NOT NULL. A NULL here would read as "never
    // credited" and fall back to whatever the roster is on the day of a correction.
    expect(await creditedRoster(finishedTeamless)).toEqual({});
    // Not finished: its points are not earned yet (ruling 15), so nothing is anchored.
    expect(await creditedRoster(live)).toBeNull();
    // A side game has no cup and no roster to read.
    expect(await creditedRoster(side)).toBeNull();
    // First wins here too: an existing roster is never replaced.
    expect(await creditedRoster(alreadyCredited)).toEqual({ [owner]: bravo });

    // Re-runnable, and a re-run reports that it found nothing.
    const again = await ctx.admin.rpc("_backfill_credited_rosters", { p_game_ids: ids });
    expect(again.data).toBe(0);
  });

  it("is not callable by a signed-in user — a maintenance core", async () => {
    const { error } = await ctx.authedClient("owner").rpc("_backfill_credited_rosters", { p_game_ids: [] });
    // The GRANT refusal by its code — not "some error", which a typo in the
    // function name or a gateway 502 would satisfy just as well.
    expect(error?.code).toBe("42501");
    expect(error?.message).toContain("permission denied for function _backfill_credited_rosters");
  });
});
