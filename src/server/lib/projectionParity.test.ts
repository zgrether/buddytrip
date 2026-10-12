import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * PROJECTION PARITY, FOR EVERY FORMAT THAT PROJECTS.
 *
 * What the board projects just before a game finishes must equal what it banks
 * just after. That is the whole definition of a correct projection, and it is
 * ruling 14 — projection and finalize share one award function — turned into an
 * assertion (Zach, on #1595). If any projection arm drifts from its finalize, the
 * projection before the end stops matching the result after it, and this says so.
 *
 * One case per format and unit kind, through the REAL write paths and the REAL
 * board (`competitions.leaderboard`): the projection is read from the payload
 * the screen reads, the game is finished by `games.finish`, and the banked
 * points are the board's own `unitTotals` delta. Skins has its own file
 * (`skinsProjectionParity.test.ts`).
 *
 * Each case also pins the EXACT projection, so a parity that holds only because
 * both sides went to zero together cannot pass.
 */

let ctx: TestContext;
let owner: string, planner: string, member: string, outsider: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  owner = ctx.user.id;
  planner = ctx.getUser("planner").id;
  member = ctx.getUser("member").id;
  outsider = ctx.getUser("outsider").id;
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

const CREW: NonNullable<NonNullable<Parameters<TestContext["createCupTrip"]>[0]>["members"]> = [
  ["planner", "Organizer"],
  ["member", "Member"],
  ["outsider", "Member"],
];

/**
 * The parity itself. Reads the live board, checks the game projects something,
 * finishes it, reads the board again, and asserts the banked delta per unit is
 * the projection. Returns the projection so a case can pin its exact values.
 */
async function projectThenFinish(p: {
  tripId: string;
  competitionId: string;
  gameId: string;
  units: string[];
}): Promise<Record<string, number>> {
  const live = await ctx.caller().competitions.leaderboard({ tripId: p.tripId, competitionId: p.competitionId });
  expect(live.cannotProject[p.gameId], "the game projects rather than declining").toBeUndefined();
  const projected = live.projections[p.gameId];
  expect(projected, "the board admits the game as live").toBeDefined();
  expect(
    Object.values(projected).some((v) => v > 0),
    "a projection of nothing proves nothing — parity would hold at 0 = 0"
  ).toBe(true);

  await ctx.caller().games.finish({ tripId: p.tripId, gameId: p.gameId });

  const banked = await ctx.caller().competitions.leaderboard({ tripId: p.tripId, competitionId: p.competitionId });
  const before = live.unitTotals as Record<string, number>;
  const after = banked.unitTotals as Record<string, number>;
  const added = Object.fromEntries(p.units.map((id) => [id, (after[id] ?? 0) - (before[id] ?? 0)]));
  const expected = Object.fromEntries(p.units.map((id) => [id, projected[id] ?? 0]));
  expect(added, "what finishing banked is what was projected").toEqual(expected);
  return projected;
}

async function twoTeams(competitionId: string, rosters: { a: string[]; b: string[] }) {
  const a = await ctx.createTeam(competitionId, "Alpha", { shortName: "ALP" });
  const b = await ctx.createTeam(competitionId, "Bravo", { shortName: "BRV" });
  const ins = await ctx.admin.from("team_assignments").insert([
    ...rosters.a.map((user_id) => ({ competition_id: competitionId, user_id, team_id: a })),
    ...rosters.b.map((user_id) => ({ competition_id: competitionId, user_id, team_id: b })),
  ]);
  expect(ins.error).toBeNull();
  return { a, b };
}

/**
 * Golf match play, outcome entry, two singles matches played to their end:
 *   match 1 — side A wins holes 1–3, halves the rest to 16 → A by 3&2;
 *   match 2 — all square through 18 → halved.
 * Played through the real outcome mutation, so the game's lifecycle is the app's.
 */
async function golfMatchPlay(tripId: string, competitionId: string, value: number) {
  const game = (await ctx.caller().games.create({
    tripId, gameTypeId: "gtt_match_play", name: "Singles", competitionId,
    pointsDistribution: { type: "per_match", value },
  })) as { id: string };
  await ctx.admin.from("games").update({ entry_mode: "outcome" }).eq("id", game.id);
  const matches = (await ctx.caller().matches.setPairings({
    tripId, gameId: game.id,
    matches: [
      { playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [planner] }, matchNumber: 1 },
      { playersPerSide: 1, sideA: { members: [member] }, sideB: { members: [outsider] }, matchNumber: 2 },
    ],
  })) as { id: string }[];
  await ctx.caller().games.enableScoring({ tripId, gameId: game.id });
  const [m1, m2] = matches.map((m) => m.id);
  for (let h = 1; h <= 16; h++) {
    await ctx.caller().matchOutcomes.upsertOutcome({
      tripId, gameId: game.id, matchId: m1, holeNumber: h, result: h <= 3 ? "side_a" : "halved",
    });
  }
  for (let h = 1; h <= 18; h++) {
    await ctx.caller().matchOutcomes.upsertOutcome({
      tripId, gameId: game.id, matchId: m2, holeNumber: h, result: h % 2 ? "side_a" : "side_b",
    });
  }
  return game.id;
}

describe("projection parity — golf match play", () => {
  it("in a head-to-head cup, by team", async () => {
    const { tripId, competitionId } = await ctx.createCupTrip({ name: "Parity · golf h2h", scoringModel: "match_play", members: CREW });
    const { a, b } = await twoTeams(competitionId, { a: [owner, member], b: [planner, outsider] });
    const gameId = await golfMatchPlay(tripId, competitionId, 2);
    const projected = await projectThenFinish({ tripId, competitionId, gameId, units: [a, b] });
    // Match 1 to Alpha (2); match 2 halved (1 each).
    expect(projected).toEqual({ [a]: 3, [b]: 1 });
  });

  it("in a points tournament with teams, by team", async () => {
    const { tripId, competitionId } = await ctx.createCupTrip({ name: "Parity · golf points", scoringModel: "points", members: CREW });
    const { a, b } = await twoTeams(competitionId, { a: [owner, member], b: [planner, outsider] });
    const gameId = await golfMatchPlay(tripId, competitionId, 2);
    const projected = await projectThenFinish({ tripId, competitionId, gameId, units: [a, b] });
    expect(projected).toEqual({ [a]: 3, [b]: 1 });
  });

  it("in a tournament of individuals, by PERSON", async () => {
    const { tripId, competitionId } = await ctx.createCupTrip({ name: "Parity · golf teamless", scoringModel: "points", members: CREW });
    const gameId = await golfMatchPlay(tripId, competitionId, 2);
    const projected = await projectThenFinish({ tripId, competitionId, gameId, units: [owner, planner, member, outsider] });
    expect(projected).toEqual({ [owner]: 2, [planner]: 0, [member]: 1, [outsider]: 1 });
  });
});

describe("projection parity — non-golf Matches", () => {
  it("in a head-to-head cup, by team", async () => {
    const { tripId, competitionId } = await ctx.createCupTrip({ name: "Parity · Matches", scoringModel: "match_play", members: CREW });
    const { a, b } = await twoTeams(competitionId, { a: [owner, member], b: [planner, outsider] });
    const game = (await ctx.caller().games.create({
      tripId, gameTypeId: "gtt_generic_yard", name: "Cornhole", competitionId, pointsTotal: 4,
      pointsDistribution: { type: "per_match", value: 2 },
    })) as { id: string };
    // The Matches format is the one column its setting writes (migration 170);
    // set here directly rather than through a whole settings-page payload.
    const fmt = await ctx.admin.from("games").update({ competition_format: "matches" }).eq("id", game.id);
    expect(fmt.error).toBeNull();
    const matches = (await ctx.caller().matches.setPairings({
      tripId, gameId: game.id,
      matches: [
        { playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [planner] }, matchNumber: 1 },
        { playersPerSide: 1, sideA: { members: [member] }, sideB: { members: [outsider] }, matchNumber: 2 },
      ],
    })) as { id: string }[];
    await ctx.caller().games.enableScoring({ tripId, gameId: game.id });
    await ctx.caller().matches.setResult({ tripId, gameId: game.id, matchId: matches[0].id, result: "a_win" });
    await ctx.caller().matches.setResult({ tripId, gameId: game.id, matchId: matches[1].id, result: "halve" });

    const projected = await projectThenFinish({ tripId, competitionId, gameId: game.id, units: [a, b] });
    // 4 over 2 matches: match 1 to Alpha (2), match 2 halved (1 each).
    expect(projected).toEqual({ [a]: 3, [b]: 1 });
  });
});

describe("projection parity — rack n stack", () => {
  const PAR = [4, 5, 3, 4, 4, 3, 5, 4, 4];
  const BOGEY = PAR.map((p) => p + 1);

  it("in a head-to-head cup, by team (rack's two sides are the cup's two teams)", async () => {
    const { tripId, competitionId } = await ctx.createCupTrip({ name: "Parity · rack", scoringModel: "match_play", members: CREW });
    const { a, b } = await twoTeams(competitionId, { a: [owner, planner], b: [member, outsider] });
    const game = (await ctx.caller().games.create({ tripId, gameTypeId: "gtt_rack_n_stack", name: "Rack", competitionId })) as { id: string };
    await ctx.callerAs("planner").playGroups.setFoursomes({
      tripId, gameId: game.id,
      groups: [
        { name: "G1", userIds: [owner, member] },
        { name: "G2", userIds: [planner, outsider] },
      ],
    });
    // A total of 10 over two slots, as the settings page saves it.
    await ctx.caller().games.setPointsTotal({ tripId, gameId: game.id, total: 10 });
    await ctx.caller().games.setPointsDistribution({ tripId, gameId: game.id, distribution: { type: "per_match", value: 5 } });
    await ctx.caller().games.enableScoring({ tripId, gameId: game.id });
    for (const [userId, gross] of [[owner, PAR], [planner, PAR], [member, BOGEY], [outsider, BOGEY]] as const) {
      for (let i = 0; i < gross.length; i++) {
        await ctx.caller().scores.upsertEntry({ tripId, gameId: game.id, participantId: userId, unitLabel: String(i + 1), value: gross[i] });
      }
    }

    const projected = await projectThenFinish({ tripId, competitionId, gameId: game.id, units: [a, b] });
    // Alpha's pair at par beat Bravo's at bogey in both slots: 5 + 5.
    expect(projected).toEqual({ [a]: 10, [b]: 0 });
  });
});

/**
 * PICK'EM. `pickemProjectionParity.test.ts` already drives the board's
 * projection and the real finalize over one set of rows (both scoring models,
 * both roll-ups) and stops at the awards the finalize WRITES. This adds the
 * step the other formats here take: what the board then BANKS.
 *
 * The game, its config and slate are inserted directly (pick'em's own router
 * tests do the same); everything with a LIFECYCLE goes through the app:
 * `pickem.setPhase` opens picks — which is what makes the game `active`, and
 * the first version of this case, inserting `picks_opened_at` by hand, left it
 * `pending` and invisible to the board — then the sheets, then the lock, then
 * results through `pickem.setResult`.
 */
describe("projection parity — pick'em", () => {
  it("in a points tournament with teams, by team", async () => {
    const { tripId, competitionId } = await ctx.createCupTrip({ name: "Parity · pick'em", scoringModel: "points", members: CREW });
    const { a, b } = await twoTeams(competitionId, { a: [owner, member], b: [planner, outsider] });
    const gameId = genId("pkpar");
    const game = await ctx.admin.from("games").insert({
      id: gameId, trip_id: tripId, competition_id: competitionId, game_type_id: "gtt_pickem", name: "Pick'em",
      points_distribution: { type: "placement", values: [4, 1] },
    });
    expect(game.error).toBeNull();
    const cfg = await ctx.admin.from("pickem_games").insert({
      game_id: gameId, use_confidence: false, roll_up: "team_totals",
    });
    expect(cfg.error).toBeNull();
    const s1 = genId("sl"), s2 = genId("sl");
    const slate = await ctx.admin.from("pickem_slate_games").insert([
      { id: s1, game_id: gameId, display_order: 0, away_team: "Away 1", home_team: "Home 1", multiplier: 1 },
      { id: s2, game_id: gameId, display_order: 1, away_team: "Away 2", home_team: "Home 2", multiplier: 1 },
    ]);
    expect(slate.error).toBeNull();
    await ctx.caller().pickem.setPhase({ tripId, gameId, action: "open" });
    // s1 goes HOME and s2 AWAY. owner 2 right, member 1, planner 1, outsider 0.
    const sheets: [string, string, string][] = [[owner, "home", "away"], [member, "home", "home"], [planner, "away", "away"], [outsider, "away", "home"]];
    const picks = await ctx.admin.from("pickem_picks").insert(
      sheets.flatMap(([user_id, p1, p2]) => [
        { id: genId("pk"), game_id: gameId, slate_game_id: s1, user_id, pick: p1 },
        { id: genId("pk"), game_id: gameId, slate_game_id: s2, user_id, pick: p2 },
      ])
    );
    expect(picks.error).toBeNull();
    await ctx.caller().pickem.setPhase({ tripId, gameId, action: "lock" });
    await ctx.caller().pickem.setResult({ tripId, gameId, slateGameId: s1, result: "home" });
    await ctx.caller().pickem.setResult({ tripId, gameId, slateGameId: s2, result: "away" });

    const projected = await projectThenFinish({ tripId, competitionId, gameId, units: [a, b] });
    // Team totals: Alpha 2 + 1 = 3, Bravo 1 + 0 = 1 → Alpha 1st (4), Bravo 2nd (1).
    expect(projected).toEqual({ [a]: 4, [b]: 1 });
  });
});
