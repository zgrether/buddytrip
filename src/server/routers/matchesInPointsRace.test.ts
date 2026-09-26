import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { MATCHES_COMPETITION_FORMAT } from "@/lib/resultStrategy";

/**
 * PR 5 — match formats in points races (rulings 5, 7, 10).
 *
 * One three-team points race — Blue, Red, Green — and the claims that must hold
 * in it:
 *
 *  - match play is ADMITTED in a points cup (`games.create` refused it before);
 *  - a head-to-head game credits only its two sides: Blue and Red get rows, and
 *    Green, in no match, gets NO row — never a scored 0 — through BOTH finalize
 *    paths (golf `matchPlay.ts` and non-golf Matches in `games.finish`), which
 *    share `writeTeamMatchPoints` but reach it separately;
 *  - a side spanning units is refused by BOTH pairing writers, naming who —
 *    temporary, until split payouts exist; teammates are admitted.
 *
 * Each case fails against a plausible wrong build: the old catalog (refused
 * create), the old all-teams row set (a Green row at 0), a writer without the
 * split check (the save lands).
 */

const MATCH_PLAY = "gtt_match_play";
const CARD = "gtt_generic_card";

let ctx: TestContext;
let tripId: string;
let race: string;
let blue: string, red: string, green: string;
let owner: string, planner: string, member: string, outsider: string;
let redGhost: string, greenGhost: string;
const guestIds: string[] = [];

async function guest(name: string): Promise<string> {
  const id = `ghost-${crypto.randomUUID()}`;
  await ctx.admin.from("users").insert({ id, name, is_guest: true });
  guestIds.push(id);
  await ctx.addTripMemberById(tripId, id, "Member");
  return id;
}

async function nameOf(id: string): Promise<string> {
  const { data } = await ctx.admin.from("users").select("name").eq("id", id).single();
  return (data as { name: string }).name;
}

async function teamRows(gameId: string): Promise<Record<string, number>> {
  const { data } = await ctx.admin
    .from("game_results")
    .select("entity_id, raw_score")
    .eq("game_id", gameId)
    .eq("entity_type", "team");
  return Object.fromEntries((data ?? []).map((r) => [r.entity_id as string, Number(r.raw_score)]));
}

/** Non-golf Matches save through the settings page's own RPC path. */
/** `live` takes the game live in the same save, as the settings page does —
 *  entering a result requires scoring to be on (`matches.setResult`). */
async function saveNonGolfMatches(gameId: string, matches: { a: string[]; b: string[] }[], live = false) {
  const { data: g } = await ctx.admin.from("games").select("*").eq("id", gameId).single();
  const { hash } = await ctx.caller().games.configHash({ tripId, gameId });
  return ctx.caller().games.saveConfig({
    tripId,
    gameId,
    baseHash: hash,
    payload: {
      name: (g!.name as string) ?? "Matches",
      rulesForToday: null,
      scoringEnabled: live,
      pointsTotal: (g!.points_total as number | null) ?? 4,
      pointsDistribution: g!.points_distribution ?? null,
      courseId: null,
      backCourseId: null,
      scorecardSchema: null,
      delegates: [],
      competitionFormat: MATCHES_COMPETITION_FORMAT,
      matches: matches.map((m, i) => ({
        matchNumber: i + 1,
        playersPerSide: m.a.length as 1 | 2,
        a: m.a,
        b: m.b,
        strokesA: 0,
        strokesB: 0,
        pointValue: null,
      })),
      matchesStructureDirty: true,
    },
  });
}

async function nonGolfMatchesGame(name: string): Promise<string> {
  const g = (await ctx.caller().games.create({ tripId, gameTypeId: CARD, name, competitionId: race })) as { id: string };
  await ctx.admin
    .from("games")
    .update({ competition_format: MATCHES_COMPETITION_FORMAT, points_total: 4, points_distribution: { type: "per_match", value: 4 } })
    .eq("id", g.id);
  return g.id;
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Points Race Matches");
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  await ctx.addTripMember(tripId, "outsider", "Member");
  owner = ctx.user.id;
  planner = ctx.getUser("planner").id;
  member = ctx.getUser("member").id;
  outsider = ctx.getUser("outsider").id; // on NO team
  redGhost = await guest("Red Ghost");
  greenGhost = await guest("Green Ghost");

  race = await ctx.createCompetition(tripId, "Three-Team Race", { scoringModel: "points" });
  blue = await ctx.createTeam(race, "Blue", { shortName: "BLU" });
  red = await ctx.createTeam(race, "Red", { shortName: "RED" });
  green = await ctx.createTeam(race, "Green", { shortName: "GRN" });
  await ctx.assignTeam(race, blue, [owner, planner]);
  await ctx.assignTeam(race, red, [member, redGhost]);
  await ctx.assignTeam(race, green, [greenGhost]);
}, 120_000);

afterAll(async () => {
  await ctx.cleanup();
  if (guestIds.length > 0) await ctx.admin.from("users").delete().in("id", guestIds);
}, 60_000);

describe("PR 5 — a head-to-head game in a three-team points race credits only its two sides", () => {
  it("golf match play: admitted, and Blue v Red writes Blue and Red — Green has NO row", async () => {
    const game = (await ctx.caller().games.create({
      tripId,
      gameTypeId: MATCH_PLAY,
      name: "Blue v Red",
      competitionId: race,
      pointsTotal: 3,
      pointsDistribution: { type: "per_match", value: 3 },
    })) as { id: string };
    const gameId = game.id;
    await ctx.admin.from("games").update({ entry_mode: "outcome" }).eq("id", gameId);
    const matches = (await ctx.caller().matches.setPairings({
      tripId,
      gameId,
      matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 }],
    })) as { id: string }[];
    await ctx.caller().games.enableScoring({ tripId, gameId });
    for (let h = 1; h <= 10; h++) {
      await ctx.caller().matchOutcomes.upsertOutcome({ tripId, gameId, matchId: matches[0].id, holeNumber: h, result: "side_a" });
    }
    await ctx.caller().games.finish({ tripId, gameId });

    expect(await teamRows(gameId)).toEqual({ [blue]: 3, [red]: 0 });
  }, 120_000);

  it("non-golf Matches: the same, through the other finalize path", async () => {
    const gameId = await nonGolfMatchesGame("Cards Blue v Red");
    await saveNonGolfMatches(gameId, [{ a: [owner], b: [member] }], true);
    const { data: m } = await ctx.admin.from("game_matches").select("id").eq("game_id", gameId).single();
    await ctx.caller().matches.setResult({ tripId, gameId, matchId: (m as { id: string }).id, result: "b_win" });
    await ctx.caller().games.finish({ tripId, gameId });

    expect(await teamRows(gameId)).toEqual({ [blue]: 0, [red]: 4 });
  }, 120_000);
});

describe("PR 5 — a side must resolve to one unit, until split payouts exist", () => {
  const TAIL =
    " aren't on the same team. Until split payouts are supported, each side of a match has to be one team's players — pair teammates, or play them as singles.";

  it("matches.setPairings refuses a pair from two teams, naming them", async () => {
    const game = (await ctx.caller().games.create({ tripId, gameTypeId: MATCH_PLAY, name: "Split via setPairings", competitionId: race })) as { id: string };
    await expect(
      ctx.caller().matches.setPairings({
        tripId,
        gameId: game.id,
        matches: [{ playersPerSide: 2, sideA: { members: [owner, member] }, sideB: { members: [planner, redGhost] }, matchNumber: 1 }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: `${await nameOf(owner)} and ${await nameOf(member)}${TAIL}` });
    const { count } = await ctx.admin.from("game_matches").select("id", { count: "exact", head: true }).eq("game_id", game.id);
    expect(count).toBe(0);
  }, 60_000);

  it("games.saveConfig refuses a teamed + unteamed pair — the writer the settings page uses", async () => {
    const gameId = await nonGolfMatchesGame("Split via saveConfig");
    await expect(
      saveNonGolfMatches(gameId, [{ a: [owner, outsider], b: [member, redGhost] }]),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: `${await nameOf(owner)} and ${await nameOf(outsider)}${TAIL}` });
    const { count } = await ctx.admin.from("game_matches").select("id", { count: "exact", head: true }).eq("game_id", gameId);
    expect(count).toBe(0);
  }, 60_000);

  it("admits teammates on each side", async () => {
    const gameId = await nonGolfMatchesGame("Teammates");
    await expect(saveNonGolfMatches(gameId, [{ a: [owner, planner], b: [member, redGhost] }])).resolves.toBeTruthy();
    const { count } = await ctx.admin.from("game_matches").select("id", { count: "exact", head: true }).eq("game_id", gameId);
    expect(count).toBe(1);
  }, 60_000);
});
