import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { MATCHES_COMPETITION_FORMAT } from "@/lib/resultStrategy";
import { RELOCK_BLOCKED_MATCHES } from "@/lib/gameLifecycle";
import { getGameTypeDefinition } from "@/lib/gameTypes";

/**
 * #1431 — a RELOCK (saving a correction) refuses any undecided match.
 *
 * The client shows "Save scoring changes" disabled in that state; this is the
 * server half, so a direct call or a stale screen can't record a half-round as
 * final. Each case goes through the app's own procedures: finalize, open a
 * correction, un-decide a match, relock (refused), re-decide, relock (saved).
 *
 * Every refusal is checked for its EFFECT as well as its message: the game is
 * still in correction and its results and match rows are exactly what they
 * were. The refusal sits before the first write, and a refusal that wrote
 * first would pass a message-only assertion.
 *
 * Each case builds its own trip and game, so a guard that fails open in one
 * can't leave state another case reads.
 */

let ctx: TestContext;
const CREW: NonNullable<NonNullable<Parameters<TestContext["createCupTrip"]>[0]>["members"]> = [
  ["planner", "Organizer"],
  ["member", "Member"],
  ["outsider", "Member"],
];

beforeAll(async () => {
  ctx = await TestContext.create();
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

/** What a refused relock must leave alone. */
async function snapshot(gameId: string) {
  const { data: game } = await ctx.admin.from("games").select("status, corrections_open").eq("id", gameId).single();
  const { data: results } = await ctx.admin
    .from("game_results")
    .select("entity_id, entity_type, position, raw_score")
    .eq("game_id", gameId)
    .order("entity_type")
    .order("entity_id");
  const { data: matches } = await ctx.admin
    .from("game_matches")
    .select("id, result, margin, status")
    .eq("game_id", gameId)
    .order("match_number");
  return { game, results, matches };
}

async function twoTeams(competitionId: string, a: string[], b: string[]) {
  const ta = await ctx.createTeam(competitionId, "Alpha", { shortName: "ALP" });
  const tb = await ctx.createTeam(competitionId, "Bravo", { shortName: "BRV" });
  const ins = await ctx.admin.from("team_assignments").insert([
    ...a.map((user_id) => ({ competition_id: competitionId, user_id, team_id: ta })),
    ...b.map((user_id) => ({ competition_id: competitionId, user_id, team_id: tb })),
  ]);
  expect(ins.error).toBeNull();
}

/** Relock refused, and nothing moved. */
async function expectRefusedUnchanged(tripId: string, gameId: string) {
  const before = await snapshot(gameId);
  expect(before.game, "precondition: in correction").toEqual({ status: "complete", corrections_open: true });
  await expect(ctx.caller().games.finish({ tripId, gameId })).rejects.toThrow(RELOCK_BLOCKED_MATCHES);
  expect(await snapshot(gameId)).toEqual(before);
}

/** Relock saved: the correction closes. */
async function expectRelocked(tripId: string, gameId: string) {
  await ctx.caller().games.finish({ tripId, gameId });
  const { game } = await snapshot(gameId);
  expect(game).toEqual({ status: "complete", corrections_open: false });
}

describe("relock refuses an undecided match (#1431)", () => {
  it("golf match play: a hole cleared in a correction un-decides the match → refused; re-entered → saved", async () => {
    const { tripId, competitionId } = await ctx.createCupTrip({ name: "Relock · match play", scoringModel: "match_play", members: CREW });
    const owner = ctx.user.id;
    const planner = ctx.getUser("planner").id;
    await twoTeams(competitionId, [owner], [planner]);
    const game = (await ctx.caller().games.create({
      tripId, gameTypeId: "gtt_match_play", name: "Singles", competitionId,
      pointsDistribution: { type: "per_match", value: 1 },
    })) as { id: string };
    await ctx.admin.from("games").update({ entry_mode: "outcome" }).eq("id", game.id);
    const [m] = (await ctx.caller().matches.setPairings({
      tripId, gameId: game.id,
      matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [planner] }, matchNumber: 1 }],
    })) as { id: string }[];
    await ctx.caller().games.enableScoring({ tripId, gameId: game.id });
    // A wins 1–3 and halves to 16 → 3&2, over.
    for (let h = 1; h <= 16; h++) {
      await ctx.caller().matchOutcomes.upsertOutcome({
        tripId, gameId: game.id, matchId: m.id, holeNumber: h, result: h <= 3 ? "side_a" : "halved",
      });
    }
    await ctx.caller().games.finish({ tripId, gameId: game.id });
    await ctx.caller().games.openCorrection({ tripId, gameId: game.id });

    // Clearing hole 16 leaves A 3 up with 3 to play: not over.
    await ctx.caller().matchOutcomes.deleteOutcome({ tripId, gameId: game.id, matchId: m.id, holeNumber: 16 });
    await expectRefusedUnchanged(tripId, game.id);

    await ctx.caller().matchOutcomes.upsertOutcome({ tripId, gameId: game.id, matchId: m.id, holeNumber: 16, result: "halved" });
    await expectRelocked(tripId, game.id);
  });

  it("non-golf Matches: a result cleared in a correction → refused; re-declared → saved", async () => {
    const { tripId, competitionId } = await ctx.createCupTrip({ name: "Relock · matches", scoringModel: "match_play", members: CREW });
    const owner = ctx.user.id;
    const member = ctx.getUser("member").id;
    await twoTeams(competitionId, [owner], [member]);
    const g = (await ctx.caller().games.create({ tripId, gameTypeId: "gtt_generic_card", name: "Cards", competitionId })) as { id: string };
    await ctx.admin
      .from("games")
      .update({ points_total: 2, points_distribution: { type: "per_match", value: 2 }, competition_format: MATCHES_COMPETITION_FORMAT })
      .eq("id", g.id);
    const { data: row } = await ctx.admin.from("games").select("*").eq("id", g.id).single();
    const { hash } = await ctx.caller().games.configHash({ tripId, gameId: g.id });
    await ctx.caller().games.saveConfig({
      tripId, gameId: g.id, baseHash: hash,
      payload: {
        name: row!.name as string,
        rulesForToday: null,
        scoringEnabled: true,
        pointsTotal: 2,
        pointsDistribution: row!.points_distribution,
        courseId: null,
        backCourseId: null,
        scorecardSchema: null,
        delegates: [],
        competitionFormat: MATCHES_COMPETITION_FORMAT,
        matches: [{ matchNumber: 1, playersPerSide: 1 as const, a: [owner], b: [member], strokesA: 0, strokesB: 0, pointValue: null }],
        matchesStructureDirty: true,
      },
    });
    const { data: ms } = await ctx.admin.from("game_matches").select("id").eq("game_id", g.id);
    const matchId = ms![0].id as string;
    await ctx.caller().matches.setResult({ tripId, gameId: g.id, matchId, result: "a_win" });
    await ctx.caller().games.finish({ tripId, gameId: g.id });
    await ctx.caller().games.openCorrection({ tripId, gameId: g.id });

    await ctx.caller().matches.setResult({ tripId, gameId: g.id, matchId, result: null });
    await expectRefusedUnchanged(tripId, g.id);

    await ctx.caller().matches.setResult({ tripId, gameId: g.id, matchId, result: "b_win" });
    await expectRelocked(tripId, g.id);
  });

  it("non-golf Matches: a FIRST finalize with an undecided match still warns rather than refusing", async () => {
    // The control for the case above: the refusal is the relock's, not a new
    // rule for every finalize. A never-played match on a first finalize stays
    // permitted, with its warning (Phase 0 §3).
    const { tripId, competitionId } = await ctx.createCupTrip({ name: "Relock · first finalize", scoringModel: "match_play", members: CREW });
    const owner = ctx.user.id;
    const member = ctx.getUser("member").id;
    await twoTeams(competitionId, [owner], [member]);
    const g = (await ctx.caller().games.create({ tripId, gameTypeId: "gtt_generic_card", name: "Cards", competitionId })) as { id: string };
    await ctx.admin
      .from("games")
      .update({ points_total: 2, points_distribution: { type: "per_match", value: 2 }, competition_format: MATCHES_COMPETITION_FORMAT })
      .eq("id", g.id);
    const { data: row } = await ctx.admin.from("games").select("*").eq("id", g.id).single();
    const { hash } = await ctx.caller().games.configHash({ tripId, gameId: g.id });
    await ctx.caller().games.saveConfig({
      tripId, gameId: g.id, baseHash: hash,
      payload: {
        name: row!.name as string,
        rulesForToday: null,
        scoringEnabled: true,
        pointsTotal: 2,
        pointsDistribution: row!.points_distribution,
        courseId: null,
        backCourseId: null,
        scorecardSchema: null,
        delegates: [],
        competitionFormat: MATCHES_COMPETITION_FORMAT,
        matches: [{ matchNumber: 1, playersPerSide: 1 as const, a: [owner], b: [member], strokesA: 0, strokesB: 0, pointValue: null }],
        matchesStructureDirty: true,
      },
    });
    const res = await ctx.caller().games.finish({ tripId, gameId: g.id });
    expect(res.warning).toMatch(/^1 of 1 match has no result yet/);
    expect((await snapshot(g.id)).game).toEqual({ status: "complete", corrections_open: false });
  });

  it("rack: a score cleared in a correction leaves a slot unplayed → refused; re-entered → saved", async () => {
    const { tripId, competitionId } = await ctx.createCupTrip({ name: "Relock · rack", scoringModel: "match_play", members: CREW });
    const owner = ctx.user.id;
    const planner = ctx.getUser("planner").id;
    const member = ctx.getUser("member").id;
    const outsider = ctx.getUser("outsider").id;
    await twoTeams(competitionId, [owner, planner], [member, outsider]);
    const game = (await ctx.caller().games.create({ tripId, gameTypeId: "gtt_rack_n_stack", name: "Rack", competitionId })) as { id: string };
    await ctx.callerAs("planner").playGroups.setFoursomes({
      tripId, gameId: game.id,
      groups: [
        { name: "G1", userIds: [owner, member] },
        { name: "G2", userIds: [planner, outsider] },
      ],
    });
    await ctx.caller().games.enableScoring({ tripId, gameId: game.id });
    // Every hole the game's scorecard has — the count is read, not assumed, and
    // resolved the way rack's compute resolves it: the game's own snapshot, else
    // the format's default.
    type Schema = { units?: { metadata?: { par?: number[] } } } | null;
    const { data: g } = await ctx.admin.from("games").select("scorecard_schema").eq("id", game.id).single();
    const par =
      (g!.scorecard_schema as Schema)?.units?.metadata?.par ??
      (getGameTypeDefinition("gtt_rack_n_stack")?.scorecardSchema as Schema)?.units?.metadata?.par ??
      [];
    expect(par.length, "precondition: a scorecard to play").toBeGreaterThan(0);
    for (const [userId, over] of [[owner, 0], [planner, 0], [member, 1], [outsider, 1]] as const) {
      for (let i = 0; i < par.length; i++) {
        await ctx.caller().scores.upsertEntry({ tripId, gameId: game.id, participantId: userId, unitLabel: String(i + 1), value: par[i] + over });
      }
    }
    await ctx.caller().games.finish({ tripId, gameId: game.id });
    await ctx.caller().games.openCorrection({ tripId, gameId: game.id });

    const last = String(par.length);
    await ctx.caller().scores.deleteEntry({ tripId, gameId: game.id, participantId: member, unitLabel: last });
    await expectRefusedUnchanged(tripId, game.id);

    await ctx.caller().scores.upsertEntry({ tripId, gameId: game.id, participantId: member, unitLabel: last, value: par[par.length - 1] + 1 });
    await expectRelocked(tripId, game.id);
  });
});
