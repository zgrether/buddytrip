import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * Rack total-points migration — the setup UI now inverts input direction (owner
 * sets a TOTAL, the per-slot value derives = total ÷ slot count), reusing A2b's
 * storage trio (points_total + points_distribution.value) with no overrides. These
 * tests simulate what the client's reconcile effect does (setPointsTotal +
 * setPointsDistribution, called directly here) to prove the SERVER-SIDE wiring:
 * the derived value feeds the SAME award path (computeRackNStackResults) and the
 * leaderboard's points-in-play unchanged, and — the headline guard — the DIVISOR
 * is this game's own slot count, never the competition-roster-derived match count
 * the leaderboard used to (mis)use as a stand-in.
 *
 * The exact evenShare math (honest fractions, no rounding) is locked by the pure
 * unit tests in pointsDistribution.test.ts (A2b) — not re-proven here.
 */

const RACK = "gtt_rack_n_stack";
const PAR = [4, 5, 3, 4, 4, 3, 5, 4, 4]; // front 9

let ctx: TestContext;
let tripId: string;
let owner: string, planner: string, member: string, outsider: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Rack Total Points Trip");
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  await ctx.addTripMember(tripId, "outsider", "Member");
  owner = ctx.user.id;
  planner = ctx.getUser("planner").id;
  member = ctx.getUser("member").id;
  outsider = ctx.getUser("outsider").id;
});

afterAll(async () => {
  await ctx.cleanup();
});

/** A 2v2-ROSTER competition (owner+planner=Blue, member+outsider=Red) — so
 *  deriveMatchCount(teamSizes) = 2 for every game, regardless of how many of the
 *  roster a given rack game actually invites. */
async function makeComp(name: string): Promise<{ comp: string; blue: string; red: string }> {
  const comp = await ctx.createCompetition(tripId, name);
  const blue = await ctx.createTeam(comp, "Blue", { shortName: "BLU", color: "#3b82f6" });
  const red = await ctx.createTeam(comp, "Red", { shortName: "RED", color: "#ef4444" });
  await ctx.admin.from("team_assignments").insert([
    { competition_id: comp, user_id: owner, team_id: blue },
    { competition_id: comp, user_id: planner, team_id: blue },
    { competition_id: comp, user_id: member, team_id: red },
    { competition_id: comp, user_id: outsider, team_id: red },
  ]);
  return { comp, blue, red };
}

async function makeGame(comp: string, name: string): Promise<string> {
  const g = await ctx.caller().games.create({ tripId, gameTypeId: RACK, name, competitionId: comp });
  return g.id as string;
}

/** Set the owner total + derive & persist the per-slot value — the two mutations
 *  the client's RackTotalPointsControl reconcile effect calls. */
async function setTotal(gameId: string, total: number, slotCount: number) {
  await ctx.caller().games.setPointsTotal({ tripId, gameId, total });
  const derived = slotCount > 0 ? total / slotCount : 0;
  await ctx.caller().games.setPointsDistribution({ tripId, gameId, distribution: { type: "per_match", value: derived } });
}

async function enter(gameId: string, userId: string, gross: number[]) {
  await ctx.callerAs("planner").games.enableScoring({ tripId, gameId }); // idempotent
  for (let i = 0; i < gross.length; i++) {
    await ctx.callerAs("planner").scores.upsertEntry({ tripId, gameId, participantId: userId, unitLabel: String(i + 1), value: gross[i] });
  }
}
const bogey = PAR.map((p) => p + 1);

describe("rack total-points — divisor is this game's SLOT count, not the roster-derived match count", () => {
  it("total 10 over 1 GAME slot (roster mc would be 2) → derives 10/slot, not 5; leaderboard reads the owner's total", async () => {
    const { comp, blue, red } = await makeComp("Divisor Guard");
    const gameId = await makeGame(comp, "One Slot");
    // Only ONE player per team invited to THIS rack game — game-side slot count 1,
    // even though the competition roster is a full 2v2 (deriveMatchCount = 2).
    await ctx.callerAs("planner").playGroups.setFoursomes({
      tripId, gameId,
      groups: [{ name: "G1", userIds: [owner, member] }],
    });
    // Owner sets Total Points = 10. Divided by the GAME's 1 slot → 10/slot (the
    // false-friend guard: NOT 10/roster-mc(2) = 5).
    await setTotal(gameId, 10, 1);
    const { data: grow } = await ctx.admin.from("games").select("points_total, points_distribution").eq("id", gameId).maybeSingle();
    expect((grow as { points_total: number }).points_total).toBe(10);
    expect((grow as { points_distribution: { value: number } }).points_distribution.value).toBe(10);

    // Blue (par) beats Red (bogey) on the lone slot.
    await enter(gameId, owner, PAR);
    await enter(gameId, member, bogey);
    await ctx.caller().games.finish({ tripId, gameId });

    const { data: rows } = await ctx.admin.from("game_results").select("entity_id, raw_score").eq("game_id", gameId);
    const byTeam = Object.fromEntries((rows as { entity_id: string; raw_score: number }[]).map((r) => [r.entity_id, Number(r.raw_score)]));
    expect(byTeam[blue]).toBe(10); // 1 slot won × 10/slot — the FULL total, not 5
    expect(byTeam[red] ?? 0).toBe(0);

    // Leaderboard points-in-play = the owner's points_total (10) directly — NOT
    // value(10) × roster-mc(2) = 20, which the pre-migration formula would show.
    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(lb.games.find((g) => g.id === gameId)?.pointsTotal).toBe(10);
    expect(lb.teamTotals[blue]).toBe(10);
  }, 60000);
});

describe("rack total-points — per-slot value recomputes live as the field grows", () => {
  it("total stays LOCKED at 10 while per-slot recomputes 10→5 as slots grow 1→2; award reads the LATEST value", async () => {
    const { comp, blue, red } = await makeComp("Live Recompute");
    const gameId = await makeGame(comp, "Growing Field");

    // Phase 1: one slot, total 10 → per-slot 10 (mirrors the previous test's setup).
    await ctx.callerAs("planner").playGroups.setFoursomes({
      tripId, gameId,
      groups: [{ name: "G1", userIds: [owner, member] }],
    });
    await setTotal(gameId, 10, 1);

    // Phase 2: the owner adds the other pair — the field grows to a full 2v2 (game
    // slot count 2). The client's reconcile effect would re-derive and persist;
    // simulate that here. The TOTAL is untouched (still 10) — only the per-slot
    // value changes, live, as the divisor grows.
    await ctx.callerAs("planner").playGroups.setFoursomes({
      tripId, gameId,
      groups: [{ name: "G1", userIds: [owner, member] }, { name: "G2", userIds: [planner, outsider] }],
    });
    await ctx.caller().games.setPointsDistribution({ tripId, gameId, distribution: { type: "per_match", value: 10 / 2 } });
    const { data: grow } = await ctx.admin.from("games").select("points_total, points_distribution").eq("id", gameId).maybeSingle();
    expect((grow as { points_total: number }).points_total).toBe(10); // locked
    expect((grow as { points_distribution: { value: number } }).points_distribution.value).toBe(5); // recomputed

    // Blue wins slot 1 (par vs bogey), HALVES slot 2 (both par → tied net-to-par).
    // Rank-pairing: Blue's two par players tie each other (order immaterial); Red
    // has one par (ties a Blue player → halve) and one bogey (loses → Blue wins).
    await enter(gameId, owner, PAR);
    await enter(gameId, planner, PAR);
    await enter(gameId, member, PAR); // Red's par player → halves its paired Blue par
    await enter(gameId, outsider, bogey); // Red's bogey player → loses its slot
    await ctx.caller().games.finish({ tripId, gameId });

    // Blue = 1 win + 1 halve = 1.5 slot-points × 5/slot (the LATEST derived value,
    // not the stale 10/slot from phase 1) = 7.5. Red = 0.5 × 5 = 2.5. Sums to the
    // locked total (10) exactly — no rounding anywhere in the chain.
    const { data: rows } = await ctx.admin.from("game_results").select("entity_id, raw_score").eq("game_id", gameId);
    const byTeam = Object.fromEntries((rows as { entity_id: string; raw_score: number }[]).map((r) => [r.entity_id, Number(r.raw_score)]));
    expect(byTeam[blue]).toBe(7.5);
    expect(byTeam[red]).toBe(2.5);

    // The leaderboard's points-in-play still reads the LOCKED total (10) — the
    // per-slot recompute never perturbs it.
    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(lb.games.find((g) => g.id === gameId)?.pointsTotal).toBe(10);
    expect(lb.teamTotals[blue]).toBe(7.5);
    expect(lb.teamTotals[red]).toBe(2.5);
  }, 60000);
});
