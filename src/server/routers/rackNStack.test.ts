import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

const RACK = "gtt_rack_n_stack";
const PAR = [4, 5, 3, 4, 4, 3, 5, 4, 4]; // front 9; net par over 9 = 36

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let teamA: string, teamB: string;
let owner: string, planner: string, member: string, outsider: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Rack Trip");
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  await ctx.addTripMember(tripId, "outsider", "Member");
  owner = ctx.user.id;
  planner = ctx.getUser("planner").id;
  member = ctx.getUser("member").id;
  outsider = ctx.getUser("outsider").id;

  competitionId = await ctx.createCompetition(tripId, "Rack Cup");
  teamA = await ctx.createTeam(competitionId, "Blue", { shortName: "BLU", color: "#3b82f6" });
  teamB = await ctx.createTeam(competitionId, "Red", { shortName: "RED", color: "#ef4444" });
  // owner+planner → Blue; member+outsider → Red.
  await ctx.admin.from("team_assignments").insert([
    { competition_id: competitionId, user_id: owner, team_id: teamA },
    { competition_id: competitionId, user_id: planner, team_id: teamA },
    { competition_id: competitionId, user_id: member, team_id: teamB },
    { competition_id: competitionId, user_id: outsider, team_id: teamB },
  ]);
});

afterAll(async () => {
  await ctx.cleanup();
});

async function enter(gameId: string, userId: string, gross: number[]) {
  await ctx.callerAs("planner").games.enableScoring({ tripId, gameId }); // Phase 2B.1 universal gate
  for (let i = 0; i < gross.length; i++) {
    await ctx.callerAs("planner").scores.upsertEntry({
      tripId,
      gameId,
      participantId: userId,
      unitLabel: String(i + 1),
      value: gross[i],
    });
  }
}

describe("rack-n-stack — finish distills team points to game_results", () => {
  it("Blue (all pars) beats Red (all bogeys) 2–0 over two slots", async () => {
    const game = await ctx.caller().games.create({ tripId, gameTypeId: RACK, name: "Day 1", competitionId });
    const gameId = game.id as string;

    // Two foursomes (mixed) — grouping is entry-only; slots derive from teams.
    await ctx.callerAs("planner").playGroups.setFoursomes({
      tripId,
      gameId,
      groups: [
        { name: "Group 1", userIds: [owner, member] },
        { name: "Group 2", userIds: [planner, outsider] },
      ],
    });

    // Blue plays pars (net-to-par 0); Red plays bogeys (+9 thru 9). Handicap 0.
    await enter(gameId, owner, PAR);
    await enter(gameId, planner, PAR);
    await enter(gameId, member, PAR.map((p) => p + 1));
    await enter(gameId, outsider, PAR.map((p) => p + 1));

    const res = await ctx.caller().games.finish({ tripId, gameId });
    const teams = res.teams as { teamId: string; points: number; position: number }[];
    const blue = teams.find((t) => t.teamId === teamA)!;
    const red = teams.find((t) => t.teamId === teamB)!;
    expect(blue.points).toBe(2);
    expect(red.points).toBe(0);
    expect(blue.position).toBe(1);
    expect(red.position).toBe(2);

    // Persisted as team rows with the numeric points column.
    const { data: rows } = await ctx.admin
      .from("game_results")
      .select("entity_id, entity_type, points")
      .eq("game_id", gameId);
    expect(rows).toHaveLength(2);
    expect(rows!.every((r) => r.entity_type === "team")).toBe(true);
    expect(rows!.find((r) => r.entity_id === teamA)!.points).toBe(2);
  });

  it("setParticipantStrokes clamps 0–18, persists, and is canEdit-gated", async () => {
    const game = await ctx.caller().games.create({ tripId, gameTypeId: RACK, name: "HC", competitionId });
    const gameId = game.id as string;
    await ctx.callerAs("planner").playGroups.setFoursomes({ tripId, gameId, groups: [{ userIds: [owner, member] }] });

    // Over-cap clamps to 18.
    const r = await ctx.callerAs("planner").playGroups.setParticipantStrokes({ tripId, gameId, userId: owner, strokes: 25 });
    expect(r.strokes).toBe(18);
    const { data: row } = await ctx.admin
      .from("game_participants")
      .select("handicap_strokes")
      .eq("game_id", gameId)
      .eq("user_id", owner)
      .single();
    expect(row!.handicap_strokes).toBe(18);

    // Negative clamps to 0.
    const r0 = await ctx.callerAs("planner").playGroups.setParticipantStrokes({ tripId, gameId, userId: owner, strokes: -3 });
    expect(r0.strokes).toBe(0);

    // A plain member cannot set strokes (game setup is canEdit-only).
    await expect(
      ctx.callerAs("member").playGroups.setParticipantStrokes({ tripId, gameId, userId: owner, strokes: 5 })
    ).rejects.toThrow();
  });

  it("a tied slot halves ½/½", async () => {
    const game = await ctx.caller().games.create({ tripId, gameTypeId: RACK, name: "Day 2", competitionId });
    const gameId = game.id as string;
    await ctx.callerAs("planner").playGroups.setFoursomes({
      tripId,
      gameId,
      groups: [{ name: "G", userIds: [owner, member] }],
    });
    // One vs one, identical scores → halve.
    await enter(gameId, owner, PAR);
    await enter(gameId, member, PAR);
    const res = await ctx.caller().games.finish({ tripId, gameId });
    const teams = res.teams as { teamId: string; points: number }[];
    expect(teams.find((t) => t.teamId === teamA)!.points).toBe(0.5);
    expect(teams.find((t) => t.teamId === teamB)!.points).toBe(0.5);
  });
});

describe("rack-n-stack — per-match points (Stage 3)", () => {
  it("a per_match rack writes raw_score = slot points × value (position null) and rolls up", async () => {
    // Isolated competition so the leaderboard reflects only this game.
    const comp = await ctx.createCompetition(tripId, "Rack PM Cup");
    const ta = await ctx.createTeam(comp, "Blue", { shortName: "B" });
    const tb = await ctx.createTeam(comp, "Red", { shortName: "R" });
    await ctx.admin.from("team_assignments").insert([
      { competition_id: comp, user_id: owner, team_id: ta },
      { competition_id: comp, user_id: planner, team_id: ta },
      { competition_id: comp, user_id: member, team_id: tb },
      { competition_id: comp, user_id: outsider, team_id: tb },
    ]);

    const game = await ctx.caller().games.create({
      tripId, gameTypeId: RACK, name: "PM Day", competitionId: comp,
      pointsDistribution: { type: "per_match", value: 2 },
    });
    const gameId = game.id as string;
    await ctx.callerAs("planner").playGroups.setFoursomes({
      tripId, gameId,
      groups: [{ name: "G1", userIds: [owner, member] }, { name: "G2", userIds: [planner, outsider] }],
    });
    // Blue (both par) wins both rank slots over Red (both bogey) → 2 slots.
    await enter(gameId, owner, PAR);
    await enter(gameId, planner, PAR);
    await enter(gameId, member, PAR.map((p) => p + 1));
    await enter(gameId, outsider, PAR.map((p) => p + 1));
    await ctx.caller().games.finish({ tripId, gameId });

    // game_results: per_match shape — raw_score = slotPoints × value, no position.
    const { data: rows } = await ctx.admin
      .from("game_results")
      .select("entity_id, raw_score, position")
      .eq("game_id", gameId);
    const blue = rows!.find((r) => r.entity_id === ta)!;
    const red = rows!.find((r) => r.entity_id === tb)!;
    expect(blue.raw_score).toBe(4); // 2 slots won × value 2
    expect(red.raw_score).toBe(0);
    expect(blue.position).toBeNull();

    // Leaderboard: available = value(2) × matchCount(min team size 2) = 4; Blue takes all.
    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(lb.pointsAvailable).toBe(4);
    expect(lb.teamTotals[ta]).toBe(4);
    expect(lb.teamTotals[tb]).toBe(0);
  });
});

describe("rack-n-stack — scoring is blocked until playing groups are assigned", () => {
  it("enableScoring refuses a rack with no groups, then allows once groups exist", async () => {
    const game = await ctx.caller().games.create({ tripId, gameTypeId: RACK, name: "Gate", competitionId });
    const gameId = game.id as string;

    // No groups yet → the enable guard refuses (manual grouping is required).
    await expect(
      ctx.callerAs("planner").games.enableScoring({ tripId, gameId })
    ).rejects.toThrow(/setting up/i);

    // Build one group → now ready.
    await ctx.callerAs("planner").playGroups.setFoursomes({
      tripId,
      gameId,
      groups: [{ name: "G1", userIds: [owner, member] }],
    });
    await expect(ctx.callerAs("planner").games.enableScoring({ tripId, gameId })).resolves.toBeTruthy();
  });

  it("clearing all groups makes the leaderboard read Setting-up again (grouped-count gate)", async () => {
    const game = await ctx.caller().games.create({ tripId, gameTypeId: RACK, name: "Clear", competitionId });
    const gameId = game.id as string;
    await ctx.callerAs("planner").playGroups.setFoursomes({
      tripId,
      gameId,
      groups: [{ name: "G1", userIds: [owner, member] }],
    });
    const before = await ctx.caller().competitions.leaderboard({ tripId, competitionId });
    expect(before.games.find((g) => g.id === gameId)!.configured).toBe(true);

    // Clear the groups — participants may linger with a null play_group_id, but the
    // readiness signal counts GROUPED players, so it flips back to not-configured.
    await ctx.callerAs("planner").playGroups.setFoursomes({ tripId, gameId, groups: [] });
    const after = await ctx.caller().competitions.leaderboard({ tripId, competitionId });
    expect(after.games.find((g) => g.id === gameId)!.configured).toBe(false);
  });
});
