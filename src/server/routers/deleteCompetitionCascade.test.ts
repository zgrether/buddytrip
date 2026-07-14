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

describe("delete_competition_cascade (migration 079)", () => {
  let ctx: TestContext;
  let tripId: string;
  let ownerId: string;
  let memberId: string;

  // comp1 = full cascade (deleted via tRPC); comp2 = dormant keep-path (RPC false);
  // comp3 = N=0 (no games).
  let comp1: string, comp2: string, comp3: string;
  let teamId: string;
  // comp1's games (one of each shape) + comp2's single game.
  const gStroke = genId("g-stroke");
  const gMatch = genId("g-match");
  const gRack = genId("g-rack");
  const mId = genId("match");
  const keepGame = genId("g-keep");
  const comp1Games = [gStroke, gMatch, gRack];

  beforeAll(async () => {
    ctx = await TestContext.create();
    ownerId = ctx.user.id;
    memberId = ctx.getUser("member").id;
    tripId = await ctx.createTrip("Delete-Cascade Trip");
    await ctx.addTripMember(tripId, "member", "Member");

    comp1 = await ctx.createCompetition(tripId, "Cascade Comp");
    comp2 = await ctx.createCompetition(tripId, "Keep Comp");
    comp3 = await ctx.createCompetition(tripId, "Empty Comp");

    // comp1: a team + an assignment (both CASCADE with the competition).
    teamId = await ctx.createTeam(comp1, "Reds");
    const { error: taErr } = await ctx.admin.from("team_assignments")
      .insert({ competition_id: comp1, team_id: teamId, user_id: ownerId });
    if (taErr) throw new Error(`seed assignment: ${taErr.message}`);

    // comp1: three games covering the child variety.
    const now = new Date().toISOString();
    const gameRows = [
      { id: gStroke, trip_id: tripId, competition_id: comp1, game_type_id: "gtt_stroke_play", name: "Stroke", status: "active" },
      { id: gMatch, trip_id: tripId, competition_id: comp1, game_type_id: "gtt_match_play", name: "Match", status: "active" },
      { id: gRack, trip_id: tripId, competition_id: comp1, game_type_id: "gtt_rack_n_stack", name: "Rack", status: "active" },
      { id: keepGame, trip_id: tripId, competition_id: comp2, game_type_id: "gtt_stroke_play", name: "Keep", status: "active" },
    ];
    const gErr = (await ctx.admin.from("games").insert(gameRows)).error;
    if (gErr) throw new Error(`seed games: ${gErr.message}`);

    // All seven child kinds across comp1's games. Seeded SEQUENTIALLY (not
    // Promise.all) — a concurrent burst against the shared test DB flaked under
    // full-suite load; one round-trip at a time is robust and the beforeAll runs once.
    const check = (table: string, r: { error: { message: string } | null }) => {
      if (r.error) throw new Error(`seed ${table}: ${r.error.message}`);
    };
    check("game_participants", await ctx.admin.from("game_participants").insert({ id: genId("gp"), game_id: gStroke, user_id: ownerId, created_at: now }));
    check("score_entries", await ctx.admin.from("score_entries").insert({ id: genId("se"), game_id: gStroke, participant_id: ownerId, participant_type: "user", unit_label: "1", value: 4, annotations: {}, submitted_by: ownerId, submitted_at: now }));
    check("game_results", await ctx.admin.from("game_results").insert({ id: genId("gr"), game_id: gStroke, entity_id: ownerId, entity_type: "user", position: 1, computed_at: now }));
    check("game_delegates", await ctx.admin.from("game_delegates").insert({ game_id: gStroke, user_id: memberId }));
    check("game_matches", await ctx.admin.from("game_matches").insert({ id: mId, game_id: gMatch, match_number: 1 }));
    check("match_hole_outcomes", await ctx.admin.from("match_hole_outcomes").insert({ id: genId("mho"), game_id: gMatch, match_id: mId, hole_number: 1, result: "side_a", submitted_by: ownerId, submitted_at: now }));
    check("play_groups", await ctx.admin.from("play_groups").insert({ id: genId("pg"), game_id: gRack }));
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    // Any surviving games (comp2's detached keep-game) cascade when the trip goes.
    await ctx.admin.from("games").delete().in("id", [...comp1Games, keepGame]);
    await ctx.cleanup();
  }, HOOK_TIMEOUT_MS);

  it("blocks a non-owner and deletes nothing (guard aborts before any delete)", async () => {
    await expect(
      ctx.callerAs("member").competitions.delete({ tripId, competitionId: comp1 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // comp1 + its games untouched.
    const c = await ctx.admin.from("competitions").select("id").eq("id", comp1);
    expect(c.data?.length).toBe(1);
    const g = await ctx.admin.from("games").select("id").in("id", comp1Games);
    expect(g.data?.length).toBe(3);
  }, HOOK_TIMEOUT_MS);

  it("keep-path (p_delete_games=false) removes the competition but DETACHES its games (dormant branch)", async () => {
    const { error } = await ctx.authedClient("owner").rpc("delete_competition_cascade", {
      p_trip_id: tripId,
      p_competition_id: comp2,
      p_delete_games: false,
    });
    expect(error).toBeNull();
    const c = await ctx.admin.from("competitions").select("id").eq("id", comp2);
    expect(c.data?.length).toBe(0); // competition gone
    const g = await ctx.admin.from("games").select("id, competition_id").eq("id", keepGame).single();
    expect(g.data?.competition_id).toBeNull(); // game survives, detached (SET NULL)
  }, HOOK_TIMEOUT_MS);

  it("N=0 — deleting a games-less competition just removes it", async () => {
    const res = await ctx.caller().competitions.delete({ tripId, competitionId: comp3 });
    expect(res.success).toBe(true);
    const c = await ctx.admin.from("competitions").select("id").eq("id", comp3);
    expect(c.data?.length).toBe(0);
  }, HOOK_TIMEOUT_MS);

  it("full cascade — deletes the competition, teams/assignments, all games + every child; no detached or dangling residue", async () => {
    const res = await ctx.caller().competitions.delete({ tripId, competitionId: comp1 });
    expect(res.success).toBe(true);

    // Competition + team-level rows gone.
    expect((await ctx.admin.from("competitions").select("id").eq("id", comp1)).data?.length).toBe(0);
    expect((await ctx.admin.from("teams").select("id").eq("competition_id", comp1)).data?.length).toBe(0);
    expect((await ctx.admin.from("team_assignments").select("team_id").eq("competition_id", comp1)).data?.length).toBe(0);

    // The games are DELETED (ordering worked) — NOT SET NULL-detached: the exact
    // ids are gone, and nothing is left carrying competition_id = comp1.
    expect((await ctx.admin.from("games").select("id").in("id", comp1Games)).data?.length).toBe(0);
    expect((await ctx.admin.from("games").select("id").eq("competition_id", comp1)).data?.length).toBe(0);

    // Every child kind cascaded away for those games (no new dangling rows).
    const gone = async (table: string) =>
      (await ctx.admin.from(table).select("game_id").in("game_id", comp1Games)).data?.length ?? -1;
    expect(await gone("game_participants")).toBe(0);
    expect(await gone("score_entries")).toBe(0);     // leaderboard/banked-score source removed
    expect(await gone("game_results")).toBe(0);      // banked-score source removed
    expect(await gone("match_hole_outcomes")).toBe(0);
    expect(await gone("game_matches")).toBe(0);
    expect(await gone("play_groups")).toBe(0);
    expect(await gone("game_delegates")).toBe(0);
  }, HOOK_TIMEOUT_MS);
});
