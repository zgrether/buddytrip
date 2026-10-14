import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { MATCHES_COMPETITION_FORMAT } from "@/lib/resultStrategy";

/**
 * #1430 — a match's `pending` has ONE meaning: not live yet.
 *
 * Go-live moves a game's matches pending → active. Two writers then moved a
 * match on a LIVE game back to pending, each reading `pending` as something
 * else:
 * - the golf match-play recompute (every setup path runs it) derived it from
 *   "no hole played", so a hole-less match went back a second after go-live;
 * - `matches.setResult(null)` wrote it when a non-golf result was un-declared.
 *
 * Each case below goes through the app's procedures and asserts the PRECONDITION
 * (the match really was `active`) before the write, so a case can't pass on a
 * match that was never live. The control shows the recompute still leaves a
 * match on a NOT-live game `pending`: the fix keeps the lifecycle half, it
 * doesn't force `active`.
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

async function statusOf(matchId: string) {
  const { data } = await ctx.admin.from("game_matches").select("status").eq("id", matchId).single();
  return data?.status as string;
}

/** A golf match-play game (score entry) with two paired matches. */
async function golfMatchGame(name: string) {
  const { tripId, competitionId } = await ctx.createCupTrip({ name, scoringModel: "match_play", members: CREW });
  const owner = ctx.user.id;
  const planner = ctx.getUser("planner").id;
  const member = ctx.getUser("member").id;
  const outsider = ctx.getUser("outsider").id;
  const ta = await ctx.createTeam(competitionId, "Alpha", { shortName: "ALP" });
  const tb = await ctx.createTeam(competitionId, "Bravo", { shortName: "BRV" });
  const ins = await ctx.admin.from("team_assignments").insert([
    { competition_id: competitionId, user_id: owner, team_id: ta },
    { competition_id: competitionId, user_id: member, team_id: ta },
    { competition_id: competitionId, user_id: planner, team_id: tb },
    { competition_id: competitionId, user_id: outsider, team_id: tb },
  ]);
  expect(ins.error).toBeNull();
  const game = (await ctx.caller().games.create({
    tripId, gameTypeId: "gtt_match_play", name: "Singles", competitionId,
    pointsDistribution: { type: "per_match", value: 1 },
  })) as { id: string };
  const [m1, m2] = (await ctx.caller().matches.setPairings({
    tripId, gameId: game.id,
    matches: [
      { playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [planner] }, matchNumber: 1 },
      { playersPerSide: 1, sideA: { members: [member] }, sideB: { members: [outsider] }, matchNumber: 2 },
    ],
  })) as { id: string }[];
  return { tripId, gameId: game.id, m1: m1.id, m2: m2.id, owner, planner, member };
}

describe("a live match stays live (#1430)", () => {
  it("golf: a setup-path recompute leaves a hole-less match on a live game ACTIVE", async () => {
    const { tripId, gameId, m1, m2, owner, planner, member } = await golfMatchGame("Live · golf");
    // The match-play go-live writer: it flips the game's matches pending → active,
    // as save_game_config's go-live does. (games.enableScoring writes the game row
    // only and never touches match rows; no screen calls either today.)
    await ctx.caller().matches.enableScoring({ tripId, gameId });
    // Match 1 has holes, match 2 has none — the practice-round shape.
    await ctx.caller().scores.upsertEntry({ tripId, gameId, participantId: owner, unitLabel: "1", value: 4 });
    await ctx.caller().scores.upsertEntry({ tripId, gameId, participantId: planner, unitLabel: "1", value: 5 });
    expect(await statusOf(m2), "precondition: go-live made the hole-less match active").toBe("active");

    // A handicap edit is one of the six setup paths that run the recompute.
    await ctx.caller().matches.setHandicap({ tripId, gameId, matchId: m2, recipientId: member, strokes: 1 });

    expect(await statusOf(m2)).toBe("active");
    expect(await statusOf(m1)).toBe("active");
  });

  it("control: on a game that is NOT live, the same recompute leaves the match pending", async () => {
    const { tripId, gameId, m2, member } = await golfMatchGame("Not live · golf");
    expect(await statusOf(m2), "precondition: never published").toBe("pending");
    await ctx.caller().matches.setHandicap({ tripId, gameId, matchId: m2, recipientId: member, strokes: 1 });
    expect(await statusOf(m2)).toBe("pending");
  });

  it("non-golf Matches: un-declaring a result leaves the match ACTIVE, not pending", async () => {
    const { tripId, competitionId } = await ctx.createCupTrip({ name: "Live · matches", scoringModel: "match_play", members: CREW });
    const owner = ctx.user.id;
    const member = ctx.getUser("member").id;
    const ta = await ctx.createTeam(competitionId, "Alpha", { shortName: "ALP" });
    const tb = await ctx.createTeam(competitionId, "Bravo", { shortName: "BRV" });
    await ctx.admin.from("team_assignments").insert([
      { competition_id: competitionId, user_id: owner, team_id: ta },
      { competition_id: competitionId, user_id: member, team_id: tb },
    ]);
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
    expect(await statusOf(matchId), "precondition: the save went live").toBe("active");

    await ctx.caller().matches.setResult({ tripId, gameId: g.id, matchId, result: "a_win" });
    expect(await statusOf(matchId)).toBe("complete");
    await ctx.caller().matches.setResult({ tripId, gameId: g.id, matchId, result: null });
    expect(await statusOf(matchId)).toBe("active");
  });
});
