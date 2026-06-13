import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * D1 follow-on: per-match points distribution (§5 done-criteria).
 *
 * Tests the tagged shape, the per_match leaderboard path, the
 * competition match-points roll-up, and teamAssignmentCounts.
 *
 * The match-points adapter (computeMatchPlayResults → writeTeamMatchPoints)
 * requires a full match-play scoring flow (score_entries → buildDecided →
 * matchState). To test roll-up independently, we write game_results rows
 * directly via admin — same isolation pattern as the D2 tests — and verify
 * computeCompetitionLeaderboard reads them correctly via the endpoint.
 */

const MANUAL = "gtt_manual";
const MATCH_PLAY = "gtt_match_play_singles";

let ctx: TestContext;
let tripId: string;
const gameIds: string[] = [];

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("D1-FollowOn Trip");
});

afterAll(async () => {
  for (const id of gameIds) {
    await ctx.admin.from("game_results").delete().eq("game_id", id);
    await ctx.admin.from("games").delete().eq("id", id);
  }
  await ctx.cleanup();
});

// ── §1: tagged shape persists and reads back ─────────────────────────────────

describe("§1 — tagged shape round-trips through the DB", () => {
  it("placement distribution persists as {type:'placement', values:[...]}", async () => {
    const comp = await ctx.createCompetition(tripId, "Shape Comp");
    await ctx.createTeam(comp, "A");
    const g = (await ctx.caller().games.create({
      tripId,
      gameTypeId: MANUAL,
      name: "Placement Game",
      competitionId: comp,
      pointsDistribution: { type: "placement", values: [9, 6, 4] },
    })) as { id: string };
    gameIds.push(g.id);

    const game = (await ctx.caller().games.getById({ tripId, gameId: g.id })) as {
      points_distribution: unknown;
    };
    expect(game.points_distribution).toEqual({ type: "placement", values: [9, 6, 4] });
  });

  it("per_match distribution persists as {type:'per_match', value:N}", async () => {
    const comp = await ctx.createCompetition(tripId, "PerMatch Shape Comp");
    await ctx.createTeam(comp, "A");
    const g = (await ctx.caller().games.create({
      tripId,
      gameTypeId: MATCH_PLAY,
      name: "Singles Day 1",
      competitionId: comp,
      pointsDistribution: { type: "per_match", value: 2 },
    })) as { id: string };
    gameIds.push(g.id);

    const game = (await ctx.caller().games.getById({ tripId, gameId: g.id })) as {
      points_distribution: unknown;
    };
    expect(game.points_distribution).toEqual({ type: "per_match", value: 2 });
  });

  it("setPointsDistribution accepts per_match shape", async () => {
    const comp = await ctx.createCompetition(tripId, "SetDist Comp");
    await ctx.createTeam(comp, "A");
    const g = (await ctx.caller().games.create({
      tripId,
      gameTypeId: MATCH_PLAY,
      name: "Day 1 MP",
      competitionId: comp,
      pointsDistribution: { type: "per_match", value: 1 },
    })) as { id: string };
    gameIds.push(g.id);

    await ctx.caller().games.setPointsDistribution({
      tripId,
      gameId: g.id,
      distribution: { type: "per_match", value: 3 },
    });

    const game = (await ctx.caller().games.getById({ tripId, gameId: g.id })) as {
      points_distribution: unknown;
    };
    expect(game.points_distribution).toEqual({ type: "per_match", value: 3 });
  });
});

// ── §3/§5: roll-up parity — per_match team totals via synthetic distribution ─

describe("§5 — roll-up parity: per_match game_results feed through competitionPlacement.ts", () => {
  it("per_match game with team raw_score rows rolls up to correct leaderboard totals", async () => {
    const comp = await ctx.createCompetition(tripId, "PerMatch Rollup Comp");
    const ta = await ctx.createTeam(comp, "Blue", { shortName: "BLU" });
    const tb = await ctx.createTeam(comp, "Red", { shortName: "RED" });

    const g = (await ctx.caller().games.create({
      tripId,
      gameTypeId: MATCH_PLAY,
      name: "Cup Day 1",
      competitionId: comp,
      pointsDistribution: { type: "per_match", value: 1 },
    })) as { id: string };
    gameIds.push(g.id);

    // Inject team totals directly (simulating the adapter output).
    // Blue won 7 matches, Red won 3.
    await ctx.admin.from("game_results").insert([
      { id: crypto.randomUUID(), game_id: g.id, entity_id: ta, entity_type: "team", raw_score: 7, position: null, competition_points_earned: null },
      { id: crypto.randomUUID(), game_id: g.id, entity_id: tb, entity_type: "team", raw_score: 3, position: null, competition_points_earned: null },
    ]);

    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });

    expect(lb.teamTotals[ta]).toBe(7);
    expect(lb.teamTotals[tb]).toBe(3);
    // pointsAvailable = synthetic sum = 7+3 = 10
    expect(lb.pointsAvailable).toBe(10);
    // winNumber = smallest > 5 = 5.5
    expect(lb.winNumber).toBe(5.5);
    // Blue clinched (7 >= 5.5)
    expect(lb.pointsToClinch[ta]).toBeLessThanOrEqual(0);
    expect(lb.pointsToClinch[tb]).toBeGreaterThan(0);
  });

  it("halved match: 0.5-point raw_score survives the numeric column", async () => {
    const comp = await ctx.createCompetition(tripId, "Halve Comp");
    const ta = await ctx.createTeam(comp, "A", { shortName: "A" });
    const tb = await ctx.createTeam(comp, "B", { shortName: "B" });

    const g = (await ctx.caller().games.create({
      tripId,
      gameTypeId: MATCH_PLAY,
      name: "Halve Day",
      competitionId: comp,
      pointsDistribution: { type: "per_match", value: 1 },
    })) as { id: string };
    gameIds.push(g.id);

    // 2 matches played: 1 halve (each gets 0.5) + A wins 1 (A gets 1).
    // A total = 1.5, B total = 0.5.
    await ctx.admin.from("game_results").insert([
      { id: crypto.randomUUID(), game_id: g.id, entity_id: ta, entity_type: "team", raw_score: 1.5, position: null, competition_points_earned: null },
      { id: crypto.randomUUID(), game_id: g.id, entity_id: tb, entity_type: "team", raw_score: 0.5, position: null, competition_points_earned: null },
    ]);

    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });

    expect(lb.teamTotals[ta]).toBe(1.5);
    expect(lb.teamTotals[tb]).toBe(0.5);
    expect(lb.pointsAvailable).toBe(2); // 1.5+0.5
  });

  it("per_match shell with no team results contributes 0 to pointsAvailable (no pairings)", async () => {
    const comp = await ctx.createCompetition(tripId, "PerMatch Shell Comp");
    await ctx.createTeam(comp, "X", { shortName: "X" });
    await ctx.createTeam(comp, "Y", { shortName: "Y" });

    const g = (await ctx.caller().games.create({
      tripId,
      gameTypeId: MATCH_PLAY,
      name: "Not Paired Yet",
      competitionId: comp,
      pointsDistribution: { type: "per_match", value: 1 },
    })) as { id: string };
    gameIds.push(g.id);

    // No game_results inserted (no decided matches yet).
    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });

    expect(lb.pointsAvailable).toBe(0);
    expect(lb.winNumber).toBe(0.5); // winThreshold(0, false) → 0.5 (smallest > 0)
    const teams: { id: string }[] = lb.teams;
    for (const t of teams) {
      expect(lb.teamTotals[t.id] ?? 0).toBe(0);
    }
  });

  it("per_match cells reflect team place and match points", async () => {
    const comp = await ctx.createCompetition(tripId, "PerMatch Cells Comp");
    const ta = await ctx.createTeam(comp, "A", { shortName: "A" });
    const tb = await ctx.createTeam(comp, "B", { shortName: "B" });

    const g = (await ctx.caller().games.create({
      tripId,
      gameTypeId: MATCH_PLAY,
      name: "Cup Day 2",
      competitionId: comp,
      pointsDistribution: { type: "per_match", value: 1 },
    })) as { id: string };
    gameIds.push(g.id);

    await ctx.admin.from("game_results").insert([
      { id: crypto.randomUUID(), game_id: g.id, entity_id: ta, entity_type: "team", raw_score: 5, position: null, competition_points_earned: null },
      { id: crypto.randomUUID(), game_id: g.id, entity_id: tb, entity_type: "team", raw_score: 3, position: null, competition_points_earned: null },
    ]);

    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });

    const aCell = lb.cells.find((c: { gameId: string; teamId: string }) => c.gameId === g.id && c.teamId === ta);
    const bCell = lb.cells.find((c: { gameId: string; teamId: string }) => c.gameId === g.id && c.teamId === tb);
    expect(aCell).toBeDefined();
    expect(bCell).toBeDefined();
    expect(aCell!.points).toBe(5);
    expect(bCell!.points).toBe(3);
    // A is 1st (higher pts), B is 2nd
    expect(aCell!.place).toBe(1);
    expect(bCell!.place).toBe(2);
  });
});

// ── teamAssignmentCounts ──────────────────────────────────────────────────────

describe("competitions.teamAssignmentCounts", () => {
  it("returns correct member counts per team", async () => {
    const comp = await ctx.createCompetition(tripId, "Counts Comp");
    const ta = await ctx.createTeam(comp, "Team A");
    const tb = await ctx.createTeam(comp, "Team B");

    const userA1 = ctx.getUser("owner").id;
    const userA2 = ctx.getUser("planner").id;
    const userB1 = ctx.getUser("member").id;

    await ctx.admin.from("team_assignments").insert([
      { competition_id: comp, user_id: userA1, team_id: ta },
      { competition_id: comp, user_id: userA2, team_id: ta },
      { competition_id: comp, user_id: userB1, team_id: tb },
    ]);

    const counts = (await ctx.caller().competitions.teamAssignmentCounts({
      tripId,
      competitionId: comp,
    })) as Record<string, number>;

    expect(counts[ta]).toBe(2);
    expect(counts[tb]).toBe(1);
  });

  it("returns empty object when no assignments", async () => {
    const comp = await ctx.createCompetition(tripId, "Empty Counts Comp");
    await ctx.createTeam(comp, "A");

    const counts = await ctx.caller().competitions.teamAssignmentCounts({
      tripId,
      competitionId: comp,
    });

    expect(Object.keys(counts as object)).toHaveLength(0);
  });
});
