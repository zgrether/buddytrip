import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * Per-game reset primitives (config-checklist Phase A, migration 066) —
 * games.resetScoring / resetToSkeleton.
 *
 * These are the level-down siblings of the competition-level reset (#442 / mig
 * 063). The competition functions are now REFACTORED to loop the un-guarded
 * per-game core; that refactor's behavior-preservation is guarded by the
 * existing competitions.reset.test.ts (unchanged). This file covers the new
 * per-game surface:
 *  - resetScoring: clears ONE game's results, keeps its config + identity.
 *  - resetToSkeleton: also clears ONE game's config, keeps identity (incl. the
 *    per-match point VALUE — §E-1).
 *  - a sibling game in the same competition is NOT touched.
 *  - owner-only (co_admin + a game delegate are both rejected).
 *  - the un-guarded cores are not callable by the `authenticated` role directly.
 */

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let ownerId: string;
let memberId: string;
const gameIds: string[] = [];

/** A scored 1v1 MATCH game: pairing (config) + result (scoring) on the
 *  dual-bucket game_matches row; roster + handicaps (config); per-match point
 *  value (§E-1 identity). */
async function makeMatchGame(name: string): Promise<string> {
  const id = genId("pgreset-match");
  gameIds.push(id);
  await ctx.admin.from("games").insert({
    id, trip_id: tripId, competition_id: competitionId, game_type_id: "gtt_match_play",
    name, status: "complete", corrections_open: true, scoring_enabled: true,
    scorecard_schema: { units: { metadata: { par: [4, 4] } } },
    points_distribution: { type: "per_match", value: 2 }, points_total: null,
    modifiers: { glorious_holes: {} }, rules_for_today: "be nice", competition_format: "head_to_head",
    pairings_published_at: new Date(0).toISOString(),
  });
  await ctx.admin.from("game_participants").insert([
    { id: genId("p"), game_id: id, user_id: ownerId, handicap_strokes: 3 },
    { id: genId("p"), game_id: id, user_id: memberId, handicap_strokes: 0 },
  ]);
  await ctx.admin.from("score_entries").insert([
    { id: genId("se"), game_id: id, participant_id: ownerId, participant_type: "user", unit_label: "1", value: 4 },
    { id: genId("se"), game_id: id, participant_id: memberId, participant_type: "user", unit_label: "1", value: 5 },
  ]);
  const { error: gmErr } = await ctx.admin.from("game_matches").insert({
    id: genId("gm"), game_id: id, match_number: 1, display_order: 0,
    side_a: { type: "user", id: ownerId }, side_b: { type: "user", id: memberId },
    result: "a_win", margin: "2up", status: "complete",
  });
  if (gmErr) throw new Error(`game_matches insert failed: ${gmErr.message}`);
  await ctx.admin.from("game_results").insert({
    id: genId("gr"), game_id: id, entity_id: ownerId, entity_type: "user", position: 1, raw_score: 1,
  });
  return id;
}

async function gameRow(id: string) {
  const { data } = await ctx.admin.from("games").select("*").eq("id", id).single();
  return data as Record<string, unknown>;
}
async function count(table: string, gameId: string): Promise<number> {
  const { count: c } = await ctx.admin.from(table).select("id", { count: "exact", head: true }).eq("game_id", gameId);
  return c ?? 0;
}

beforeAll(async () => {
  ctx = await TestContext.create();
  ownerId = ctx.user.id;
  tripId = await ctx.createTrip("PG Reset Trip");
  await ctx.addTripMember(tripId, "planner", "Organizer"); // co_admin — NOT owner
  await ctx.addTripMember(tripId, "member", "Member");
  memberId = ctx.getUser("member").id;
  competitionId = await ctx.createCompetition(tripId, "PG Reset Cup", { scoringModel: "points" });
});

afterAll(async () => {
  if (gameIds.length) await ctx.admin.from("games").delete().in("id", gameIds);
  await ctx.cleanup();
}, 30000);

describe("games.resetScoring — one game's results cleared, config + identity kept, siblings untouched", () => {
  it("clears the target's scoring; leaves config/identity; a sibling is untouched", async () => {
    const target = await makeMatchGame("Target");
    const sibling = await makeMatchGame("Sibling");

    await ctx.caller().games.resetScoring({ tripId, gameId: target });

    // TARGET scoring cleared.
    expect(await count("game_results", target)).toBe(0);
    expect(await count("score_entries", target)).toBe(0);
    const { data: tgm } = await ctx.admin.from("game_matches").select("*").eq("game_id", target).single();
    const tm = tgm as Record<string, unknown>;
    expect(tm.side_a).toMatchObject({ type: "user", id: ownerId }); // pairing (config) kept
    expect(tm.result).toBeNull();
    expect(tm.margin).toBeNull();
    expect(tm.status).toBe("pending");
    // TARGET config + identity intact, still armed.
    expect(await count("game_participants", target)).toBe(2);
    const tg = await gameRow(target);
    expect(tg.scorecard_schema).not.toBeNull();
    expect(tg.competition_format).toBe("head_to_head");
    expect(tg.points_distribution).toMatchObject({ type: "per_match", value: 2 });
    expect(tg.status).toBe("pending");
    expect(tg.corrections_open).toBe(false);
    expect(tg.scoring_enabled).toBe(true); // stays armed

    // SIBLING fully untouched — results + result columns survive.
    expect(await count("game_results", sibling)).toBe(1);
    expect(await count("score_entries", sibling)).toBe(2);
    const { data: sgm } = await ctx.admin.from("game_matches").select("*").eq("game_id", sibling).single();
    const sm = sgm as Record<string, unknown>;
    expect(sm.result).toBe("a_win");
    expect(sm.status).toBe("complete");
    const sg = await gameRow(sibling);
    expect(sg.status).toBe("complete");
  });

  it("a co-admin (Organizer) and a game delegate are both rejected — owner only", async () => {
    const target = await makeMatchGame("OwnerOnly");
    // Make the member a DELEGATE of this game (can edit/score) — still not reset.
    await ctx.admin.from("game_delegates").insert({ game_id: target, user_id: memberId, granted_by: ownerId });

    await expect(
      ctx.callerAs("planner").games.resetScoring({ tripId, gameId: target })
    ).rejects.toThrow();
    await expect(
      ctx.callerAs("member").games.resetScoring({ tripId, gameId: target })
    ).rejects.toThrow();
    // Neither write landed — scoring intact.
    expect(await count("game_results", target)).toBe(1);
  });
});

describe("games.resetToSkeleton — one game's config cleared, identity kept (incl. §E-1 value)", () => {
  it("clears the target's config to a shell; keeps the per-match point value; sibling untouched", async () => {
    const target = await makeMatchGame("SkelTarget");
    const sibling = await makeMatchGame("SkelSibling");

    await ctx.caller().games.resetToSkeleton({ tripId, gameId: target });

    // TARGET config cleared: roster, pairings rows, columns.
    expect(await count("game_participants", target)).toBe(0);
    expect(await count("game_matches", target)).toBe(0);
    const tg = await gameRow(target);
    expect(tg.scorecard_schema).toBeNull();
    expect(tg.modifiers).toMatchObject({});
    expect(tg.rules_for_today).toBeNull();
    expect(tg.competition_format).toBeNull();
    expect(tg.pairings_published_at).toBeNull();
    expect(tg.scoring_enabled).toBe(false); // un-armed
    // IDENTITY kept: shell + the per-match point VALUE survives (§E-1).
    expect(tg.name).toBe("SkelTarget");
    expect(tg.game_type_id).toBe("gtt_match_play");
    expect(tg.points_distribution).toMatchObject({ type: "per_match", value: 2 });

    // SIBLING untouched: config + scoring all survive.
    expect(await count("game_participants", sibling)).toBe(2);
    expect(await count("game_matches", sibling)).toBe(1);
    expect(await count("game_results", sibling)).toBe(1);
    const sg = await gameRow(sibling);
    expect(sg.scoring_enabled).toBe(true);
    expect(sg.scorecard_schema).not.toBeNull();
  });

  it("a plain member cannot reset a game to skeleton", async () => {
    const target = await makeMatchGame("SkelOwnerOnly");
    await expect(
      ctx.callerAs("member").games.resetToSkeleton({ tripId, gameId: target })
    ).rejects.toThrow();
    expect(await count("game_participants", target)).toBe(2); // unchanged
  });
});

describe("the un-guarded cores are not callable by the authenticated role", () => {
  it("a direct rpc() to _reset_game_scoring / _reset_game_to_skeleton is denied", async () => {
    const target = await makeMatchGame("CoreGuard");
    const owner = ctx.authedClient("owner"); // the trip OWNER — yet the CORE is off-limits

    const r1 = await owner.rpc("_reset_game_scoring", { p_game_id: target });
    expect(r1.error).not.toBeNull(); // no EXECUTE grant → PostgREST refuses
    const r2 = await owner.rpc("_reset_game_to_skeleton", { p_game_id: target });
    expect(r2.error).not.toBeNull();

    // The core calls were refused, so the game is still fully scored.
    expect(await count("game_results", target)).toBe(1);
    expect(await count("game_participants", target)).toBe(2);
  });
});
