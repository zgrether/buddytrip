import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { evenShare } from "@/lib/pointsDistribution";

/**
 * Refactor A2b — the Total Points model, end-to-end through the DB.
 *
 * The owner sets a TOTAL (games.points_total); the per-match value DERIVES (the even
 * share → points_distribution.value); individual matches OVERRIDE via
 * game_matches.point_value with the remainder redistributing to keep the total locked.
 * The award sites read `point_value ?? points_distribution.value`; the leaderboard
 * points-in-play reads the authoritative `points_total`.
 *
 * The exact Buddy math (16 total, doubles overridden to 4, six singles → 2 each) is
 * locked by the pure unit tests (pointsDistribution.test.ts / gameProjection.test.ts).
 * These prove the WIRING with the 4 shared users: 2 singles with one overridden proves
 * override + redistribution + the points_total leaderboard switch + the award read rule
 * — the same properties, a testable size. A 1-match doubles case proves the override
 * awards on a play_group side too.
 */

const MATCH_PLAY = "gtt_match_play";

let ctx: TestContext;
let tripId: string;
let owner: string, planner: string, member: string, outsider: string;
const gameIds: string[] = [];

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("A2b Total Points Trip");
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  await ctx.addTripMember(tripId, "outsider", "Member");
  owner = ctx.user.id;
  planner = ctx.getUser("planner").id;
  member = ctx.getUser("member").id;
  outsider = ctx.getUser("outsider").id;
});

afterAll(async () => {
  if (gameIds.length) {
    await ctx.admin.from("game_results").delete().in("game_id", gameIds);
    await ctx.admin.from("games").delete().in("id", gameIds);
  }
  await ctx.cleanup();
}, 30000);

type Side = { type: string; id: string } | null;
interface MatchRow {
  id: string;
  side_a: Side;
  side_b: Side;
}

/** A competition with Blue (owner+planner) vs Red (member+outsider). */
async function makeComp(name: string): Promise<{ comp: string; blue: string; red: string }> {
  const comp = await ctx.createCompetition(tripId, name);
  const blue = await ctx.createTeam(comp, "Blue", { color: "#2563eb" });
  const red = await ctx.createTeam(comp, "Red", { color: "#dc2626" });
  await ctx.admin.from("team_assignments").insert([
    { competition_id: comp, user_id: owner, team_id: blue },
    { competition_id: comp, user_id: planner, team_id: blue },
    { competition_id: comp, user_id: member, team_id: red },
    { competition_id: comp, user_id: outsider, team_id: red },
  ]);
  return { comp, blue, red };
}

async function makeGame(comp: string, name: string): Promise<string> {
  const g = (await ctx.caller().games.create({ tripId, gameTypeId: MATCH_PLAY, name, competitionId: comp })) as { id: string };
  gameIds.push(g.id);
  return g.id;
}

/** Set the owner total + derive & persist the even share (the client's setup writes). */
async function setTotal(gameId: string, total: number, overrides: number[], matchCount: number) {
  await ctx.caller().games.setPointsTotal({ tripId, gameId, total });
  await ctx.caller().games.setPointsDistribution({ tripId, gameId, distribution: { type: "per_match", value: evenShare(total, overrides, matchCount) } });
}

/** Blue (side A) sweeps side B: A shoots 4, B shoots 5 over `holes` holes → A closes
 *  out (10&8 by hole 10). participantType per the side shape. */
async function blueSweeps(gameId: string, aId: string, bId: string, type: "user" | "play_group", holes = 10) {
  const caller = ctx.caller();
  await caller.games.enableScoring({ tripId, gameId });
  for (let h = 1; h <= holes; h++) {
    await caller.scores.upsertEntry({ tripId, gameId, participantId: aId, unitLabel: String(h), value: 4, participantType: type });
    await caller.scores.upsertEntry({ tripId, gameId, participantId: bId, unitLabel: String(h), value: 5, participantType: type });
  }
}

describe("A2b — override redistributes; award reads point_value ?? even share", () => {
  it("2 singles, total 6, one overridden to 4 → other redistributes to 2; Blue sweeps → 6", async () => {
    const { comp, blue, red } = await makeComp("A2b Redistribute");
    const gameId = await makeGame(comp, "Two Singles");
    const matches = (await ctx.caller().matches.setPairings({
      tripId, gameId,
      matches: [
        { playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 },
        { playersPerSide: 1, sideA: { members: [planner] }, sideB: { members: [outsider] }, matchNumber: 2 },
      ],
    })) as MatchRow[];
    const m1 = matches[0], m2 = matches[1];

    // Owner total 6, even 3/3 at first.
    await setTotal(gameId, 6, [], 2);
    // Override match 1 to 4 → the other redistributes to (6−4)/1 = 2.
    await ctx.caller().matches.setPointValue({ tripId, gameId, matchId: m1.id, value: 4 });
    await ctx.caller().games.setPointsDistribution({ tripId, gameId, distribution: { type: "per_match", value: evenShare(6, [4], 2) } });

    // The override persisted; the even share is 2.
    const { data: mrow } = await ctx.admin.from("game_matches").select("id, point_value").eq("id", m1.id).maybeSingle();
    expect(Number((mrow as { point_value: number }).point_value)).toBe(4);
    const { data: grow } = await ctx.admin.from("games").select("points_total, points_distribution").eq("id", gameId).maybeSingle();
    expect((grow as { points_total: number }).points_total).toBe(6);
    expect((grow as { points_distribution: { value: number } }).points_distribution.value).toBe(2);

    // Blue sweeps both singles (side A wins each).
    const caller = ctx.caller();
    await caller.games.enableScoring({ tripId, gameId });
    for (const [aId, bId] of [[owner, member], [planner, outsider]] as const) {
      for (let h = 1; h <= 10; h++) {
        await caller.scores.upsertEntry({ tripId, gameId, participantId: aId, unitLabel: String(h), value: 4, participantType: "user" });
        await caller.scores.upsertEntry({ tripId, gameId, participantId: bId, unitLabel: String(h), value: 5, participantType: "user" });
      }
    }
    await ctx.caller().games.finish({ tripId, gameId });

    // Blue earns the override (4) + the even share (2) = 6; Red 0. Award read rule.
    const { data: teamRows } = await ctx.admin
      .from("game_results").select("entity_id, raw_score").eq("game_id", gameId).eq("entity_type", "team");
    const byTeam = Object.fromEntries((teamRows as { entity_id: string; raw_score: number }[]).map((r) => [r.entity_id, Number(r.raw_score)]));
    expect(byTeam[blue]).toBe(6); // 4 (M1 override) + 2 (M2 even) — locked total, redistributed
    expect(byTeam[red] ?? 0).toBe(0);

    // Leaderboard points-in-play = points_total (6), NOT the recomputed even × mc (2×2=4).
    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    const gameCell = lb.games.find((g) => g.id === gameId);
    expect(gameCell?.pointsTotal).toBe(6); // authoritative total, no value×mc snapshot drift
    expect(lb.teamTotals[blue]).toBe(6);

    void m2; // (referenced for clarity; its even value is asserted via byTeam)
  }, 60000);

  it("clearing an override reverts the match to the even share (point_value → null)", async () => {
    const { comp } = await makeComp("A2b Clear");
    const gameId = await makeGame(comp, "Clearable");
    const matches = (await ctx.caller().matches.setPairings({
      tripId, gameId,
      matches: [
        { playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 },
        { playersPerSide: 1, sideA: { members: [planner] }, sideB: { members: [outsider] }, matchNumber: 2 },
      ],
    })) as MatchRow[];
    await setTotal(gameId, 6, [], 2);
    await ctx.caller().matches.setPointValue({ tripId, gameId, matchId: matches[0].id, value: 4 });
    // Clear it.
    await ctx.caller().matches.setPointValue({ tripId, gameId, matchId: matches[0].id, value: null });
    const { data } = await ctx.admin.from("game_matches").select("point_value").eq("id", matches[0].id).maybeSingle();
    expect((data as { point_value: number | null }).point_value).toBeNull();
  }, 30000);
});

describe("A2b — existing games safe (null total → value × mc fallback)", () => {
  it("a pre-A2b game (null points_total, no override) awards on the even-share fallback", async () => {
    const { comp, blue, red } = await makeComp("A2b Legacy");
    const gameId = await makeGame(comp, "Legacy Match");
    await ctx.caller().matches.setPairings({
      tripId, gameId,
      matches: [
        { playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 },
        { playersPerSide: 1, sideA: { members: [planner] }, sideB: { members: [outsider] }, matchNumber: 2 },
      ],
    });
    // Simulate a pre-A2b game: a per_match distribution, NO owner total, NO overrides.
    await ctx.admin.from("games").update({ points_total: null, points_distribution: { type: "per_match", value: 2 } }).eq("id", gameId);

    const caller = ctx.caller();
    await caller.games.enableScoring({ tripId, gameId });
    for (const [aId, bId] of [[owner, member], [planner, outsider]] as const) {
      for (let h = 1; h <= 10; h++) {
        await caller.scores.upsertEntry({ tripId, gameId, participantId: aId, unitLabel: String(h), value: 4, participantType: "user" });
        await caller.scores.upsertEntry({ tripId, gameId, participantId: bId, unitLabel: String(h), value: 5, participantType: "user" });
      }
    }
    await ctx.caller().games.finish({ tripId, gameId });

    const { data: teamRows } = await ctx.admin
      .from("game_results").select("entity_id, raw_score").eq("game_id", gameId).eq("entity_type", "team");
    const byTeam = Object.fromEntries((teamRows as { entity_id: string; raw_score: number }[]).map((r) => [r.entity_id, Number(r.raw_score)]));
    expect(byTeam[blue]).toBe(4); // 2 (value) × 2 matches — the null-total fallback, unchanged
    expect(byTeam[red] ?? 0).toBe(0);

    // Leaderboard points-in-play falls back to value × mc (2 × 2 = 4) with a null total.
    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(lb.games.find((g) => g.id === gameId)?.pointsTotal).toBe(4);
  }, 60000);
});

describe("A2b — a doubles override awards on the play_group side", () => {
  it("a 2v2 match overridden to 4 awards 4 to the winning pair's team", async () => {
    const { comp, blue, red } = await makeComp("A2b Doubles Override");
    const gameId = await makeGame(comp, "Doubles Override");
    const matches = (await ctx.caller().matches.setPairings({
      tripId, gameId,
      matches: [
        { playersPerSide: 2, sideA: { members: [owner, planner] }, sideB: { members: [member, outsider] }, matchNumber: 1 },
      ],
    })) as MatchRow[];
    const pgA = matches[0].side_a!.id;
    const pgB = matches[0].side_b!.id;

    await setTotal(gameId, 2, [], 1); // even share 2 for the lone match…
    await ctx.caller().matches.setPointValue({ tripId, gameId, matchId: matches[0].id, value: 4 }); // …overridden to 4

    await blueSweeps(gameId, pgA, pgB, "play_group");
    await ctx.caller().games.finish({ tripId, gameId });

    const { data: teamRows } = await ctx.admin
      .from("game_results").select("entity_id, raw_score").eq("game_id", gameId).eq("entity_type", "team");
    const byTeam = Object.fromEntries((teamRows as { entity_id: string; raw_score: number }[]).map((r) => [r.entity_id, Number(r.raw_score)]));
    expect(byTeam[blue]).toBe(4); // the override, not the even share of 2
    expect(byTeam[red] ?? 0).toBe(0);
  }, 60000);
});
