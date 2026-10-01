import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * delete_competition_cascade (migration 079) — Phase 1: delete a competition AND
 * its games (the new default), atomically and in the load-bearing order (games-by-
 * competition FIRST, then the competition). DB-integration tests against the test
 * DB: seed a full competition (teams + assignments + games of each type with all
 * seven child kinds), then delete and assert nothing is left behind — no detached
 * games, no dangling children. The RPC self-guards on the trip Owner, so it's
 * called through the authenticated owner client / tRPC caller (not the service role).
 */

const HOOK_TIMEOUT_MS = 30_000;

const CHILD_TABLES = [
  "game_participants",
  "score_entries",
  "game_results",
  "match_hole_outcomes",
  "game_matches",
  "play_groups",
  "game_delegates",
] as const;

describe("delete_competition_cascade (migration 079)", () => {
  /**
   * EVERY CASE BUILDS ITS OWN CUP (#1527). The non-owner refusal and the full
   * cascade used to share one, and the refusal asserted its cup and three games
   * were untouched — after the cascade case, shuffled ahead of it, had deleted
   * them. A refusal that held read as one that had deleted everything.
   */
  let ctx: TestContext;
  let ownerId: string;
  let memberId: string;
  const madeGames: string[] = [];

  type FullCup = { tripId: string; comp: string; games: string[] };

  /** A cup with a team, an assignment, and three games carrying all seven child kinds. */
  async function seedFullCup(label: string): Promise<FullCup> {
    const { tripId, competitionId: comp } = await ctx.createCupTrip({
      title: `Delete-Cascade ${label}`, name: `Cascade Comp ${label}`, members: ["member"],
    });

    // A team + an assignment (both CASCADE with the competition).
    const teamId = await ctx.createTeam(comp, "Reds");
    const { error: taErr } = await ctx.admin.from("team_assignments")
      .insert({ competition_id: comp, team_id: teamId, user_id: ownerId });
    if (taErr) throw new Error(`seed assignment: ${taErr.message}`);

    // Three games covering the child variety.
    const gStroke = genId("g-stroke");
    const gMatch = genId("g-match");
    const gRack = genId("g-rack");
    const mId = genId("match");
    const now = new Date().toISOString();
    const gErr = (await ctx.admin.from("games").insert([
      { id: gStroke, trip_id: tripId, competition_id: comp, game_type_id: "gtt_stroke_play", name: "Stroke", status: "active" },
      { id: gMatch, trip_id: tripId, competition_id: comp, game_type_id: "gtt_match_play", name: "Match", status: "active" },
      { id: gRack, trip_id: tripId, competition_id: comp, game_type_id: "gtt_rack_n_stack", name: "Rack", status: "active" },
    ])).error;
    if (gErr) throw new Error(`seed games: ${gErr.message}`);
    const games = [gStroke, gMatch, gRack];
    madeGames.push(...games);

    // All seven child kinds across the games. Seeded SEQUENTIALLY (not
    // Promise.all) — a concurrent burst against the shared test DB flaked under
    // full-suite load; one round-trip at a time is robust.
    const check = (table: string, r: { error: { message: string } | null }) => {
      if (r.error) throw new Error(`seed ${table}: ${r.error.message}`);
    };
    check("game_participants", await ctx.admin.from("game_participants").insert({ id: genId("gp"), game_id: gStroke, user_id: ownerId, created_at: now }));
    check("score_entries", await ctx.admin.from("score_entries").insert({ id: genId("se"), game_id: gStroke, participant_id: ownerId, participant_type: "user", unit_label: "1", value: 4, annotations: {}, submitted_by: ownerId, submitted_at: now }));
    check("game_results", await ctx.admin.from("game_results").insert({ id: genId("gr"), game_id: gStroke, entity_id: ownerId, entity_type: "user", value_kind: "rank", position: 1, computed_at: now }));
    check("game_delegates", await ctx.admin.from("game_delegates").insert({ game_id: gStroke, user_id: memberId }));
    check("game_matches", await ctx.admin.from("game_matches").insert({ id: mId, game_id: gMatch, match_number: 1 }));
    check("match_hole_outcomes", await ctx.admin.from("match_hole_outcomes").insert({ id: genId("mho"), game_id: gMatch, match_id: mId, hole_number: 1, result: "side_a", submitted_by: ownerId, submitted_at: now }));
    check("play_groups", await ctx.admin.from("play_groups").insert({ id: genId("pg"), game_id: gRack }));

    return { tripId, comp, games };
  }

  /** Row count, read so that a failed read can never pass for zero. */
  async function count(table: string, column: string, values: string[]): Promise<number> {
    const { count: n, error } = await ctx.admin
      .from(table).select("*", { count: "exact", head: true }).in(column, values);
    if (error) throw new Error(`count ${table}: ${error.message}`);
    return n ?? 0;
  }

  beforeAll(async () => {
    ctx = await TestContext.create();
    ownerId = ctx.user.id;
    memberId = ctx.getUser("member").id;
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    // Any surviving games (the detached keep-game) cascade when the trip goes.
    if (madeGames.length) await ctx.admin.from("games").delete().in("id", madeGames);
    await ctx.cleanup();
  }, HOOK_TIMEOUT_MS);

  it("blocks a non-owner and deletes nothing (guard aborts before any delete)", async () => {
    const { tripId, comp, games } = await seedFullCup("blocked");
    await expect(
      ctx.callerAs("member").competitions.delete({ tripId, competitionId: comp })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // The cup, its games and every child are untouched.
    expect(await count("competitions", "id", [comp])).toBe(1);
    expect(await count("games", "id", games)).toBe(3);
    for (const table of CHILD_TABLES) {
      expect(await count(table, "game_id", games), `${table} survives the refusal`).toBeGreaterThan(0);
    }
  }, HOOK_TIMEOUT_MS);

  it("keep-path (p_delete_games=false) removes the competition but DETACHES its games (dormant branch)", async () => {
    const { tripId: keepTripId, competitionId: comp2 } = await ctx.createCupTrip({
      title: "Delete-Cascade keep", name: "Keep Comp", members: ["member"],
    });
    const keepGame = genId("g-keep");
    const gErr = (await ctx.admin.from("games").insert({
      id: keepGame, trip_id: keepTripId, competition_id: comp2, game_type_id: "gtt_stroke_play", name: "Keep", status: "active",
    })).error;
    if (gErr) throw new Error(`seed keep game: ${gErr.message}`);
    madeGames.push(keepGame);

    const { error } = await ctx.authedClient("owner").rpc("delete_competition_cascade", {
      p_trip_id: keepTripId,
      p_competition_id: comp2,
      p_delete_games: false,
    });
    expect(error).toBeNull();
    expect(await count("competitions", "id", [comp2])).toBe(0); // competition gone
    const g = await ctx.admin.from("games").select("id, competition_id").eq("id", keepGame).single();
    if (g.error) throw new Error(`read keep game: ${g.error.message}`);
    expect(g.data?.competition_id).toBeNull(); // game survives, detached (SET NULL)
  }, HOOK_TIMEOUT_MS);

  it("N=0 — deleting a games-less competition just removes it", async () => {
    const { tripId: emptyTripId, competitionId: comp3 } = await ctx.createCupTrip({
      title: "Delete-Cascade empty", name: "Empty Comp", members: ["member"],
    });
    expect(await count("competitions", "id", [comp3])).toBe(1); // premise
    const res = await ctx.caller().competitions.delete({ tripId: emptyTripId, competitionId: comp3 });
    expect(res.success).toBe(true);
    expect(await count("competitions", "id", [comp3])).toBe(0);
  }, HOOK_TIMEOUT_MS);

  it("full cascade — deletes the competition, teams/assignments, all games + every child; no detached or dangling residue", async () => {
    const { tripId, comp, games } = await seedFullCup("full");
    // Premise: every kind is THERE before the delete, so each zero below is a
    // deletion and not a seed that silently wrote nothing.
    expect(await count("teams", "competition_id", [comp])).toBe(1);
    expect(await count("team_assignments", "competition_id", [comp])).toBe(1);
    for (const table of CHILD_TABLES) {
      expect(await count(table, "game_id", games), `${table} seeded`).toBeGreaterThan(0);
    }

    const res = await ctx.caller().competitions.delete({ tripId, competitionId: comp });
    expect(res.success).toBe(true);

    // Competition + team-level rows gone.
    expect(await count("competitions", "id", [comp])).toBe(0);
    expect(await count("teams", "competition_id", [comp])).toBe(0);
    expect(await count("team_assignments", "competition_id", [comp])).toBe(0);

    // The games are DELETED (ordering worked) — NOT SET NULL-detached: the exact
    // ids are gone, and nothing is left carrying competition_id = comp.
    expect(await count("games", "id", games)).toBe(0);
    expect(await count("games", "competition_id", [comp])).toBe(0);

    // Every child kind cascaded away for those games (no new dangling rows) —
    // score_entries and game_results are the leaderboard's banked-score sources.
    for (const table of CHILD_TABLES) {
      expect(await count(table, "game_id", games), `${table} cascaded`).toBe(0);
    }
  }, HOOK_TIMEOUT_MS);
});
