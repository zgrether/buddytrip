import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";
import { writeGameResults } from "./writeGameResults";

/**
 * Migration 194 — one `game_results` row per unit per game.
 *
 * Three claims, each with the control that shows it could fail:
 *
 *  1. CONCURRENT WRITES through `write_game_results` all SUCCEED and leave
 *     exactly one row per unit. That is the lock's job: without it, the
 *     constraint turns the race into a refusal (23505) for all but one caller,
 *     and before the constraint existed the race stored duplicates, which paid
 *     the cup twice on a double-tapped Finish.
 *  2. A DIRECT duplicate insert — the path `writeManualResults` takes, outside
 *     the RPC and its lock — is REFUSED. That is the constraint's job. Control:
 *     the same unit in a different game is admitted, so the rule is per game.
 *  3. The guest MERGE survives a collision: a placeholder and the real account
 *     both holding a result in one game used to be two rows, and after 194 the
 *     merge's repoint would raise 23505 inside the signup trigger. The real
 *     account's row wins.
 *
 * Writes go through the app's own `writeGameResults` with a signed-in owner's
 * client, the same path every engine takes.
 */

let ctx: TestContext;
let tripId: string;
let teamA: string, teamB: string;
let competitionId: string;
const gameIds: string[] = [];
const userIds: string[] = [];

async function newGame(name: string): Promise<string> {
  const id = genId("game");
  const { error } = await ctx.admin.from("games").insert({
    id, trip_id: tripId, competition_id: competitionId, game_type_id: "gtt_stroke_play", name, status: "active",
  });
  if (error) throw new Error(`seed game: ${error.message}`);
  gameIds.push(id);
  return id;
}

const teamRow = (teamId: string, score: number) => ({
  id: crypto.randomUUID(),
  entity_id: teamId,
  entity_type: "team" as const,
  raw_score: score,
  position: null,
  value_kind: "points" as const,
  competition_points_earned: null,
});

async function rowsOf(gameId: string) {
  const { data, error } = await ctx.admin
    .from("game_results")
    .select("entity_id, entity_type, raw_score")
    .eq("game_id", gameId)
    .order("entity_id");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ ...r, raw_score: Number(r.raw_score) }));
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("One row per unit");
  competitionId = await ctx.createCompetition(tripId, "Cup", { scoringModel: "points" });
  teamA = await ctx.createTeam(competitionId, "Alpha");
  teamB = await ctx.createTeam(competitionId, "Bravo");
}, 120_000);

afterAll(async () => {
  if (gameIds.length) await ctx.admin.from("games").delete().in("id", gameIds);
  if (userIds.length) await ctx.admin.from("users").delete().in("id", userIds);
  await ctx.cleanup();
}, 60_000);

describe("concurrent writes through write_game_results (the lock)", () => {
  it.each([
    ["all", { kind: "all" as const }],
    ["entity_type", { kind: "entity_type" as const, entityType: "team" as const }],
  ])("eight at once, scope %s: every call succeeds and one row per team remains", async (_label, scope) => {
    const gameId = await newGame(`Concurrent ${_label}`);
    const owner = ctx.authedClient("owner");

    const calls = Array.from({ length: 8 }, () =>
      writeGameResults(owner, { gameId, scope, rows: [teamRow(teamA, 3), teamRow(teamB, 1)], onFailure: "throw" })
    );
    // Every one resolves: a double-tap is not an error.
    await expect(Promise.all(calls)).resolves.toBeDefined();

    expect(await rowsOf(gameId)).toEqual(
      [
        { entity_id: teamA, entity_type: "team", raw_score: 3 },
        { entity_id: teamB, entity_type: "team", raw_score: 1 },
      ].sort((x, y) => x.entity_id.localeCompare(y.entity_id))
    );
  }, 120_000);
});

describe("a direct duplicate insert (the constraint)", () => {
  const direct = (gameId: string, entityId: string) =>
    ctx.admin.from("game_results").insert({
      id: genId("gr"), game_id: gameId, entity_id: entityId, entity_type: "team",
      raw_score: 1, position: null, value_kind: "points", credited_team_id: entityId,
    });

  it("CONTROL: the same team in a DIFFERENT game is admitted — the rule is per game", async () => {
    const g1 = await newGame("Direct control 1");
    const g2 = await newGame("Direct control 2");
    expect((await direct(g1, teamA)).error).toBeNull();
    expect((await direct(g2, teamA)).error).toBeNull();
  }, 60_000);

  it("a second row for the same team in the same game is refused", async () => {
    const g = await newGame("Direct duplicate");
    expect((await direct(g, teamA)).error).toBeNull();
    const second = await direct(g, teamA);
    expect(second.error?.code).toBe("23505");
    expect(second.error?.message).toContain("game_results_one_row_per_unit");
    expect(await rowsOf(g)).toHaveLength(1);
  }, 60_000);
});

describe("the guest merge, when placeholder and real account both have a result in one game", () => {
  it("succeeds, and the real account's row is the one that remains", async () => {
    const gameId = await newGame("Merge collision");
    const ghostId = genId("ghost");
    const realId = genId("real");
    userIds.push(ghostId, realId);
    const { error: uErr } = await ctx.admin.from("users").insert([
      { id: ghostId, name: "Placeholder", is_guest: true },
      { id: realId, name: "Account", is_guest: false },
    ]);
    if (uErr) throw new Error(`seed users: ${uErr.message}`);
    const userRow = (id: string, score: number) => ({
      id: genId("gr"), game_id: gameId, entity_id: id, entity_type: "user",
      raw_score: score, position: 1, value_kind: "rank",
    });
    const { error: rErr } = await ctx.admin.from("game_results").insert([userRow(ghostId, 90), userRow(realId, 72)]);
    if (rErr) throw new Error(`seed results: ${rErr.message}`);

    const { error } = await ctx.admin.rpc("merge_guest_to_real_user", { p_ghost_id: ghostId, p_real_id: realId });
    expect(error).toBeNull();
    expect(await rowsOf(gameId)).toEqual([{ entity_id: realId, entity_type: "user", raw_score: 72 }]);
  }, 60_000);

  it("CONTROL: with no collision, the placeholder's row is repointed, not dropped", async () => {
    const gameId = await newGame("Merge no collision");
    const ghostId = genId("ghost");
    const realId = genId("real");
    userIds.push(ghostId, realId);
    await ctx.admin.from("users").insert([
      { id: ghostId, name: "Placeholder", is_guest: true },
      { id: realId, name: "Account", is_guest: false },
    ]);
    await ctx.admin.from("game_results").insert({
      id: genId("gr"), game_id: gameId, entity_id: ghostId, entity_type: "user", raw_score: 90, position: 1, value_kind: "rank",
    });

    const { error } = await ctx.admin.rpc("merge_guest_to_real_user", { p_ghost_id: ghostId, p_real_id: realId });
    expect(error).toBeNull();
    expect(await rowsOf(gameId)).toEqual([{ entity_id: realId, entity_type: "user", raw_score: 90 }]);
  }, 60_000);
});
