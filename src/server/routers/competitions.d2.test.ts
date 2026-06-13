import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { rollUp, placementPoints, winThreshold, type LiveGame } from "../../lib/competitionPlacement";
import type { PointsDistribution } from "../../lib/pointsDistribution";

/**
 * Slice D2 — CompetitionLeaderboard data contract (§6).
 *
 * These tests verify the leaderboard endpoint produces exactly the shape the
 * CompetitionLeaderboard component expects, covering the four §6 scenarios.
 * All math delegates to competitionPlacement.ts (client-safe lib) — the
 * assertions here prove the endpoint matches what the lib would compute, not a
 * re-implementation of the math.
 */

const MANUAL = "gtt_manual";

let ctx: TestContext;
let tripId: string;
let competitionId: string;
const gameIds: string[] = [];

async function makeGame(distribution: PointsDistribution | null, name = "Game") {
  const g = (await ctx.caller().games.create({
    tripId,
    gameTypeId: MANUAL,
    name,
    competitionId,
    pointsDistribution: distribution,
  })) as { id: string };
  gameIds.push(g.id);
  return g.id;
}

async function enterResults(
  gameId: string,
  placements: { teamId: string; position: number }[]
) {
  await ctx
    .caller()
    .games.setManualResults({
      tripId,
      gameId,
      placements: placements.map((p) => ({ entityId: p.teamId, position: p.position })),
    });
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("D2 Leaderboard Trip");
  competitionId = await ctx.createCompetition(tripId, "D2 Cup");
});

afterAll(async () => {
  for (const id of gameIds) {
    await ctx.admin.from("game_results").delete().eq("game_id", id);
    await ctx.admin.from("games").delete().eq("id", id);
  }
  await ctx.cleanup();
});

describe("D2 §6 — 2-team hero data (N-team structure holds at 2)", () => {
  let teamA: string;
  let teamB: string;

  beforeAll(async () => {
    teamA = await ctx.createTeam(competitionId, "Blue", { shortName: "BLU" });
    teamB = await ctx.createTeam(competitionId, "Red", { shortName: "RED" });
  });

  it("early state: all totals zero, winNumber derived, game returns with no cells", async () => {
    const gameId = await makeGame({ type: "placement", values: [9, 6] }, "Shell Game");

    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId });

    expect(lb.teamTotals[teamA]).toBe(0);
    expect(lb.teamTotals[teamB]).toBe(0);
    // winNumber = smallest > half of 15 (9+6) → 8
    expect(lb.winNumber).toBe(8);
    expect(lb.pointsAvailable).toBe(15);
    // No results → no cells
    expect(lb.cells.filter((c: { gameId: string }) => c.gameId === gameId)).toHaveLength(0);
    // Game is present in the response
    const game = lb.games.find((g: { id: string }) => g.id === gameId);
    expect(game).toBeDefined();
    expect(game!.dropped).toBe(false);
  });

  it("in-progress: scores entered, teamTotals and pointsToClinch update", async () => {
    const gameId = await makeGame({ type: "placement", values: [9, 6] }, "Scored Game");
    await enterResults(gameId, [
      { teamId: teamA, position: 1 },
      { teamId: teamB, position: 2 },
    ]);

    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId });

    // Points earned: 9 for 1st, 6 for 2nd across all live games with this setup
    // We only assert the game we just set, net of the shell (0 for shell)
    const aTotal = lb.teamTotals[teamA] as number;
    const bTotal = lb.teamTotals[teamB] as number;
    expect(aTotal).toBeGreaterThan(bTotal);

    // pointsToClinch = winNumber - total
    const aPtc = lb.pointsToClinch[teamA] as number;
    expect(aPtc).toBe(lb.winNumber - aTotal);
  });

  it("clinched: pointsToClinch <= 0 when a team reaches winNumber", async () => {
    // Create a fresh competition for a clean slate
    const cleanComp = await ctx.createCompetition(tripId, "D2 Clinch Comp");
    const ta = await ctx.createTeam(cleanComp, "Blue2", { shortName: "B2" });
    const tb = await ctx.createTeam(cleanComp, "Red2", { shortName: "R2" });

    const g = await ctx.caller().games.create({
      tripId,
      gameTypeId: MANUAL,
      name: "Clincher",
      competitionId: cleanComp,
      pointsDistribution: { type: "placement", values: [10, 0] },
    }) as { id: string };
    gameIds.push(g.id);

    await ctx.caller().games.setManualResults({
      tripId,
      gameId: g.id,
      placements: [
        { entityId: ta, position: 1 },
        { entityId: tb, position: 2 },
      ],
    });

    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: cleanComp });

    // ta has 10 pts, available=10 → half=5 → winNumber=5.5 (smallest > half)
    expect(lb.teamTotals[ta]).toBe(10);
    expect(lb.teamTotals[tb]).toBe(0);
    expect(lb.winNumber).toBe(5.5);
    expect(lb.pointsToClinch[ta]).toBeLessThanOrEqual(0);
    expect(lb.pointsToClinch[tb]).toBeGreaterThan(0);
  });

  it("retain case: defending team clinches at half (not > half)", async () => {
    const cleanComp = await ctx.createCompetition(tripId, "D2 Retain Comp");
    const defender = await ctx.createTeam(cleanComp, "Defender", { shortName: "DEF" });
    const challenger = await ctx.createTeam(cleanComp, "Challenger", { shortName: "CHL" });

    // Set defending_team_id directly on the competition (no tRPC for this yet)
    await ctx.admin
      .from("competitions")
      .update({ defending_team_id: defender })
      .eq("id", cleanComp);

    const g = await ctx.caller().games.create({
      tripId,
      gameTypeId: MANUAL,
      name: "Retain Test",
      competitionId: cleanComp,
      pointsDistribution: { type: "placement", values: [14, 14] },
    }) as { id: string };
    gameIds.push(g.id);

    await ctx.caller().games.setManualResults({
      tripId,
      gameId: g.id,
      placements: [
        { entityId: defender, position: 1 },
        { entityId: challenger, position: 2 },
      ],
    });

    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: cleanComp });

    expect(lb.defendingTeamId).toBe(defender);
    // Available = 28, winThreshold(28, false) = 14.5, winThreshold(28, true) = 14
    // Defender has 14 pts → pointsToClinch = 14 - 14 = 0 → clinched (retain)
    // Challenger has 14 pts too, but winThreshold(28, false) = 14.5 → 14.5-14=0.5 → not clinched
    expect(lb.pointsToClinch[defender]).toBeLessThanOrEqual(0);
    expect(lb.pointsToClinch[challenger]).toBeGreaterThan(0);
  });
});

describe("D2 §6 — N-team (3+ teams) ranked list data", () => {
  it("3-team competition: winNumber and pointsToClinch work for all three teams", async () => {
    const comp = await ctx.createCompetition(tripId, "D2 3-Team Comp");
    const t1 = await ctx.createTeam(comp, "Alpha", { shortName: "ALP" });
    const t2 = await ctx.createTeam(comp, "Beta", { shortName: "BET" });
    const t3 = await ctx.createTeam(comp, "Gamma", { shortName: "GAM" });

    const g = await ctx.caller().games.create({
      tripId,
      gameTypeId: MANUAL,
      name: "3-way",
      competitionId: comp,
      pointsDistribution: { type: "placement", values: [9, 6, 4] },
    }) as { id: string };
    gameIds.push(g.id);

    await ctx.caller().games.setManualResults({
      tripId,
      gameId: g.id,
      placements: [
        { entityId: t1, position: 1 },
        { entityId: t2, position: 2 },
        { entityId: t3, position: 3 },
      ],
    });

    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });

    expect(lb.teams).toHaveLength(3);
    expect(lb.teamTotals[t1]).toBe(9);
    expect(lb.teamTotals[t2]).toBe(6);
    expect(lb.teamTotals[t3]).toBe(4);
    // available = 19, winNumber = smallest > 9.5 → 10
    expect(lb.winNumber).toBe(10);
    expect(lb.pointsToClinch[t1]).toBe(1); // 10-9=1
    expect(lb.pointsToClinch[t2]).toBe(4); // 10-6=4
    expect(lb.pointsToClinch[t3]).toBe(6); // 10-4=6
  });
});

describe("D2 §6 — dropped game excluded from totals and winNumber", () => {
  it("dropping a game moves the winNumber and removes it from cells", async () => {
    const comp = await ctx.createCompetition(tripId, "D2 Drop Comp");
    const ta = await ctx.createTeam(comp, "Blue", { shortName: "BLU" });
    const tb = await ctx.createTeam(comp, "Red", { shortName: "RED" });

    const g1r = await ctx.caller().games.create({
      tripId, gameTypeId: MANUAL, name: "Live", competitionId: comp,
      pointsDistribution: { type: "placement", values: [9, 6] },
    }) as { id: string };
    const g1 = g1r.id;
    gameIds.push(g1);
    const g2r = await ctx.caller().games.create({
      tripId, gameTypeId: MANUAL, name: "To Drop", competitionId: comp,
      pointsDistribution: { type: "placement", values: [9, 6] },
    }) as { id: string };
    const g2 = g2r.id;
    gameIds.push(g2);

    await ctx.caller().games.setManualResults({ tripId, gameId: g1, placements: [{ entityId: ta, position: 1 }, { entityId: tb, position: 2 }] });
    await ctx.caller().games.setManualResults({ tripId, gameId: g2, placements: [{ entityId: ta, position: 1 }, { entityId: tb, position: 2 }] });

    const before = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(before.pointsAvailable).toBe(30); // 15+15
    expect(before.teamTotals[ta]).toBe(18); // 9+9

    await ctx.caller().games.setStatus({ tripId, gameId: g2, status: "dropped" });

    const after = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    // Dropped game excluded from roll-up
    expect(after.pointsAvailable).toBe(15);
    expect(after.teamTotals[ta]).toBe(9);
    // Dropped game still present in games[] but with dropped:true
    const droppedGame = after.games.find((g: { id: string }) => g.id === g2);
    expect(droppedGame?.dropped).toBe(true);
    // No cells for dropped game
    expect(after.cells.filter((c: { gameId: string }) => c.gameId === g2)).toHaveLength(0);
  });
});

describe("D2 §6 — non-engine game with no entry shows at 0, not hidden", () => {
  it("manual game with no results contributes to pointsAvailable but has no cells", async () => {
    const comp = await ctx.createCompetition(tripId, "D2 NoEntry Comp");
    await ctx.createTeam(comp, "X", { shortName: "X" });
    await ctx.createTeam(comp, "Y", { shortName: "Y" });

    const g = await ctx.caller().games.create({
      tripId, gameTypeId: MANUAL, name: "Not Entered Yet", competitionId: comp,
      pointsDistribution: { type: "placement", values: [5, 3] },
    }) as { id: string };
    gameIds.push(g.id);

    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });

    // Game is present (honest, not hidden)
    const game = lb.games.find((g2: { id: string }) => g2.id === g.id);
    expect(game).toBeDefined();
    expect(game!.dropped).toBe(false);
    // Points-available counts it (8 in play)
    expect(lb.pointsAvailable).toBe(8);
    // No cells (no results entered)
    expect(lb.cells.filter((c: { gameId: string }) => c.gameId === g.id)).toHaveLength(0);
    // Teams show at 0
    for (const team of lb.teams) {
      expect(lb.teamTotals[team.id] ?? 0).toBe(0);
    }
  });
});

describe("D2 §6 — leaderboard response shape includes D2 fields", () => {
  it("game_type_id and defendingTeamId are present in response", async () => {
    const comp = await ctx.createCompetition(tripId, "D2 Shape Comp");
    await ctx.createTeam(comp, "A", { shortName: "A" });
    const g = await ctx.caller().games.create({
      tripId, gameTypeId: MANUAL, name: "Shape Test", competitionId: comp,
      pointsDistribution: { type: "placement", values: [9] },
    }) as { id: string };
    gameIds.push(g.id);

    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });

    const game = lb.games.find((g2: { id: string }) => g2.id === g.id);
    expect(game).toBeDefined();
    expect("gameTypeId" in game!).toBe(true);
    expect(game!.gameTypeId).toBe(MANUAL);
    expect("defendingTeamId" in lb).toBe(true);
  });

  it("reads competitionPlacement.ts — rollUp matches the endpoint's teamTotals", async () => {
    // This test proves the endpoint delegates to the lib (CLAUDE.md #8 — single
    // source of truth). We run the same inputs through rollUp directly and compare.
    const comp = await ctx.createCompetition(tripId, "D2 Delegation Comp");
    const t1 = await ctx.createTeam(comp, "P", { shortName: "P" });
    const t2 = await ctx.createTeam(comp, "Q", { shortName: "Q" });

    const g = await ctx.caller().games.create({
      tripId, gameTypeId: MANUAL, name: "Delegate", competitionId: comp,
      pointsDistribution: { type: "placement", values: [9, 6] },
    }) as { id: string };
    gameIds.push(g.id);

    await ctx.caller().games.setManualResults({
      tripId, gameId: g.id,
      placements: [{ entityId: t1, position: 1 }, { entityId: t2, position: 2 }],
    });

    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });

    // Reproduce what the lib computes from these inputs
    const liveInput: LiveGame[] = [{
      id: g.id,
      distribution: [9, 6],
      numTeams: 2,
      standings: [
        { entityId: t1, value: 1 },
        { entityId: t2, value: 2 },
      ],
      direction: "low_wins",
    }];
    const roll = rollUp(liveInput, [t1, t2]);

    expect(lb.teamTotals[t1]).toBe(roll.teamTotals.get(t1));
    expect(lb.teamTotals[t2]).toBe(roll.teamTotals.get(t2));
    expect(lb.winNumber).toBe(roll.winNumber);
    expect(lb.pointsAvailable).toBe(roll.pointsAvailable);
  });
});
