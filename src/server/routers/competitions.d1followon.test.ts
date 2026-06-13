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
  // Batch the deletes (one query each) — a per-game loop over the now-larger
  // game set blows the default 10s hook timeout against the remote DB.
  if (gameIds.length) {
    await ctx.admin.from("game_results").delete().in("game_id", gameIds);
    await ctx.admin.from("games").delete().in("id", gameIds);
  }
  await ctx.cleanup();
}, 30000);

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
  it("per_match available = value × matchCount (stable); teamTotals from realized points", async () => {
    const comp = await ctx.createCompetition(tripId, "PerMatch Rollup Comp");
    const ta = await ctx.createTeam(comp, "Blue", { shortName: "BLU" });
    const tb = await ctx.createTeam(comp, "Red", { shortName: "RED" });
    // 2 members per team → singles matchCount = min(2,2) = 2 → available = 1×2.
    await ctx.admin.from("team_assignments").insert([
      { competition_id: comp, user_id: ctx.getUser("owner").id, team_id: ta },
      { competition_id: comp, user_id: ctx.getUser("planner").id, team_id: ta },
      { competition_id: comp, user_id: ctx.getUser("member").id, team_id: tb },
      { competition_id: comp, user_id: ctx.getUser("outsider").id, team_id: tb },
    ]);

    const g = (await ctx.caller().games.create({
      tripId,
      gameTypeId: MATCH_PLAY,
      name: "Cup Day 1",
      competitionId: comp,
      pointsDistribution: { type: "per_match", value: 1 },
    })) as { id: string };
    gameIds.push(g.id);

    // Realized awarded points (adapter output): Blue won both of the 2 matches.
    await ctx.admin.from("game_results").insert([
      { id: crypto.randomUUID(), game_id: g.id, entity_id: ta, entity_type: "team", raw_score: 2, position: null, competition_points_earned: null },
      { id: crypto.randomUUID(), game_id: g.id, entity_id: tb, entity_type: "team", raw_score: 0, position: null, competition_points_earned: null },
    ]);

    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });

    expect(lb.teamTotals[ta]).toBe(2);
    expect(lb.teamTotals[tb]).toBe(0);
    // available = value × matchCount = 1 × 2 (NOT the realized sum) — stable.
    expect(lb.pointsAvailable).toBe(2);
    expect(lb.winNumber).toBe(1.5); // smallest > half of 2
    expect(lb.pointsToClinch[ta]).toBeLessThanOrEqual(0); // 2 ≥ 1.5 → clinched
    expect(lb.pointsToClinch[tb]).toBeGreaterThan(0);
  });

  it("halved match: 0.5-point raw_score survives the numeric column", async () => {
    const comp = await ctx.createCompetition(tripId, "Halve Comp");
    const ta = await ctx.createTeam(comp, "A", { shortName: "A" });
    const tb = await ctx.createTeam(comp, "B", { shortName: "B" });
    // 2 members per team → matchCount 2 → available = 1×2 = 2.
    await ctx.admin.from("team_assignments").insert([
      { competition_id: comp, user_id: ctx.getUser("owner").id, team_id: ta },
      { competition_id: comp, user_id: ctx.getUser("planner").id, team_id: ta },
      { competition_id: comp, user_id: ctx.getUser("member").id, team_id: tb },
      { competition_id: comp, user_id: ctx.getUser("outsider").id, team_id: tb },
    ]);

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

    expect(lb.teamTotals[ta]).toBe(1.5); // realized (the 0.5 halve survives numeric)
    expect(lb.teamTotals[tb]).toBe(0.5);
    expect(lb.pointsAvailable).toBe(2); // value × matchCount = 1×2
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

// ── Stage 4: stable clinch — owner-set total counts before configuration ─────

describe("Stage 4 — available counts owner-set totals; configuring doesn't move it", () => {
  it("an UNCONFIGURED placement game's owner-set total counts toward available", async () => {
    const comp = await ctx.createCompetition(tripId, "Stable Placement Comp");
    await ctx.createTeam(comp, "A");
    await ctx.createTeam(comp, "B");
    // Shell: total set on the Game tab, distribution NOT yet chosen.
    const g = (await ctx.caller().games.create({
      tripId, gameTypeId: MANUAL, name: "Unconfigured", competitionId: comp, pointsTotal: 8,
    })) as { id: string };
    gameIds.push(g.id);

    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(lb.pointsAvailable).toBe(8); // total counts with no distribution yet
    expect(lb.winNumber).toBe(4.5); // smallest > half of 8
  });

  it("configuring the distribution later does NOT move the available total", async () => {
    const comp = await ctx.createCompetition(tripId, "Stable Config Comp");
    await ctx.createTeam(comp, "A");
    await ctx.createTeam(comp, "B");
    const g = (await ctx.caller().games.create({
      tripId, gameTypeId: MANUAL, name: "Config Later", competitionId: comp, pointsTotal: 8,
    })) as { id: string };
    gameIds.push(g.id);

    const before = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(before.pointsAvailable).toBe(8);

    await ctx.caller().games.setPointsDistribution({
      tripId, gameId: g.id, distribution: { type: "placement", values: [5, 3] },
    });
    const after = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(after.pointsAvailable).toBe(8); // unchanged — only awarded points move
  });

  it("per_match available is stable BEFORE any matches are scored", async () => {
    const comp = await ctx.createCompetition(tripId, "Stable Match Comp");
    const ta = await ctx.createTeam(comp, "A");
    const tb = await ctx.createTeam(comp, "B");
    await ctx.admin.from("team_assignments").insert([
      { competition_id: comp, user_id: ctx.getUser("owner").id, team_id: ta },
      { competition_id: comp, user_id: ctx.getUser("planner").id, team_id: ta },
      { competition_id: comp, user_id: ctx.getUser("member").id, team_id: tb },
      { competition_id: comp, user_id: ctx.getUser("outsider").id, team_id: tb },
    ]);
    const g = (await ctx.caller().games.create({
      tripId, gameTypeId: MATCH_PLAY, name: "Future Cup", competitionId: comp,
      pointsDistribution: { type: "per_match", value: 1 },
    })) as { id: string };
    gameIds.push(g.id);

    // No game_results yet — but matchCount from team sizes = 2 → available = 2.
    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(lb.pointsAvailable).toBe(2);
    expect(lb.teamTotals[ta]).toBe(0); // nothing awarded yet
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
