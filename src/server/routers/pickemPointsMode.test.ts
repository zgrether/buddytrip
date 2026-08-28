import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * Pick'em in a POINTS competition (Phase 7).
 *
 * ── What this is guarding ──────────────────────────────────────────────────
 *
 * Pick'em did not read `scoring_model` at all before this phase: the router
 * used `competition_id` for teams and assignments and never asked what kind of
 * cup it was. So the whole of points mode hangs off one new read, and if that
 * read regresses everything downstream silently falls back to match play —
 * which LOOKS like a working game, just the wrong one.
 *
 * `roll_up` is deliberately left at `individual_matches` in the points fixture.
 * A points cup makes that column inert, so a build that read the roll-up and
 * ignored the model would still produce matches and head-to-head copy here.
 * That is the "only runs match_play" wrong build, and this fixture is what
 * fails it.
 */

let ctx: TestContext;
let tripId: string;
let pointsCompId: string;
let matchCompId: string;
let pointsGameId: string;
let matchGameId: string;

describe("pick'em under a points competition", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Pick'em Points Trip");
    await ctx.addTripMember(tripId, "member", "Member");

    pointsCompId = await ctx.createCompetition(tripId, "Points Cup", {
      scoringModel: "points",
    });
    matchCompId = await ctx.createCompetition(tripId, "Match Cup");

    const mk = async (competitionId: string, name: string) => {
      const id = genId("p7game");
      const ins = await ctx.admin.from("games").insert({
        id,
        trip_id: tripId,
        competition_id: competitionId,
        game_type_id: "gtt_pickem",
        name,
        points_distribution: { type: "placement", values: [2, 1.5, 0.5, 0] },
      });
      expect(ins.error).toBeNull();
      const cfg = await ctx.admin.from("pickem_games").insert({
        game_id: id,
        use_confidence: true,
        // INERT in a points cup — see the file header. Set on purpose.
        roll_up: "individual_matches",
        picks_opened_at: new Date(Date.now() - 3_600_000).toISOString(),
      });
      expect(cfg.error).toBeNull();
      const slate = await ctx.admin.from("pickem_slate_games").insert({
        id: genId("sl"),
        game_id: id,
        display_order: 0,
        away_team: "Away",
        home_team: "Home",
        multiplier: 1,
      });
      expect(slate.error).toBeNull();
      return id;
    };

    pointsGameId = await mk(pointsCompId, "Points Pick'em");
    matchGameId = await mk(matchCompId, "Match Pick'em");
  }, 60_000);

  afterAll(async () => {
    await ctx.admin.from("games").delete().in("id", [pointsGameId, matchGameId]);
    await ctx.cleanup();
  }, 60_000);

  const get = (gameId: string) => ctx.caller().pickem.get({ tripId, gameId });

  it("returns scoringModel='points' from the COMPETITION", async () => {
    const data = (await get(pointsGameId)) as { scoringModel: string | null };
    expect(data.scoringModel).toBe("points");
  });

  it("returns 'match_play' for a match cup — the control", async () => {
    // Without this the case above passes against a build that hardcodes
    // "points", which is the cheapest possible wrong implementation.
    const data = (await get(matchGameId)) as { scoringModel: string | null };
    expect(data.scoringModel).toBe("match_play");
  });

  it("returns null for a STANDALONE game, rather than erroring", async () => {
    // No competition means no model. It falls through to the match-play shape,
    // which is right: a standalone pick'em has no teams either, so nothing
    // orders and nothing pays.
    const solo = genId("p7solo");
    await ctx.admin.from("games").insert({
      id: solo, trip_id: tripId, game_type_id: "gtt_pickem", name: "Solo",
    });
    await ctx.admin.from("pickem_games").insert({ game_id: solo });
    const data = (await ctx.caller().pickem.get({ tripId, gameId: solo })) as {
      scoringModel: string | null;
      teams: unknown[];
    };
    expect(data.scoringModel).toBeNull();
    expect(data.teams).toEqual([]);
    await ctx.admin.from("games").delete().eq("id", solo);
  });

  it("carries the placement schedule through unchanged", async () => {
    // The authored `values[]` path — no divisor, nothing derived (#1068).
    const data = (await get(pointsGameId)) as {
      game: { points_distribution: { type: string; values: number[] } };
    };
    expect(data.game.points_distribution).toEqual({
      type: "placement",
      values: [2, 1.5, 0.5, 0],
    });
  });

  it("does NOT reject a result when there are no matches", async () => {
    /**
     * Phase 5's completeness gate refuses a result while a match is missing a
     * side. Points mode has no matches at all, so there is nothing to complete
     * and the gate must not apply — an "every match needs both sides" refusal
     * on a game with zero matches would be unfixable, which is the shape of the
     * deadlock migration 162 undid.
     */
    const { data: slate } = await ctx.admin
      .from("pickem_slate_games").select("id").eq("game_id", pointsGameId).single();

    await expect(
      ctx.caller().pickem.setResult({
        tripId, gameId: pointsGameId, slateGameId: slate!.id, result: "home",
      })
    ).resolves.toBeTruthy();

    const { data: row } = await ctx.admin
      .from("pickem_slate_games").select("result").eq("id", slate!.id).single();
    expect(row?.result).toBe("home");
  });

  it("counts as STARTED once a result lands, regardless of model", async () => {
    // Migration 161's pick'em arm is `result IS NOT NULL` with no roll-up or
    // scoring_model condition, so points mode is covered by construction.
    // Asserted rather than assumed, since it is what puts the game On Tap.
    const { data } = await ctx.admin
      .from("game_started").select("game_id").eq("game_id", pointsGameId);
    expect((data ?? []).map((r) => r.game_id)).toEqual([pointsGameId]);
  });

  it("a game with no result is NOT started — the non-vacuity control", async () => {
    const { data } = await ctx.admin
      .from("game_started").select("game_id").eq("game_id", matchGameId);
    expect(data ?? []).toEqual([]);
  });
});
