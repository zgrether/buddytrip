import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * #1031 — rack shares match play's shape: the per-slot value must recompute LIVE
 * from the game's current grouped roster, never from a persisted
 * `points_distribution.value` snapshot. `rackNStack.pointsTotal.test.ts`'s
 * "field grows" case still calls `setPointsDistribution` again to simulate the
 * client's reconcile after a roster change; this proves that call is no longer
 * NEEDED — a roster change with NO settings Save in between (a seat vacate) is
 * reflected the instant it happens, both in the derived value and in the award
 * write.
 *
 * A FRESH file/trip, deliberately: `tripMembers.remove` refuses to remove
 * someone with contributions ANYWHERE in the trip (`findContributionBlockers`),
 * and `rackNStack.pointsTotal.test.ts`'s shared trip already has all four users
 * scored by its earlier tests. Isolating this test is what keeps the removal
 * clean without weakening that guard.
 */

const RACK = "gtt_rack_n_stack";
const PAR = [4, 5, 3, 4, 4, 3, 5, 4, 4]; // front 9
const bogey = PAR.map((p) => p + 1);

let ctx: TestContext;
let tripId: string;
let owner: string, planner: string, member: string, outsider: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Rack Live Count Trip");
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

describe("#1031 — rack per-slot value recomputes with NO settings Save", () => {
  it("a seat vacate shrinks a team's roster mid-game — the persisted snapshot stays stale, but the award write uses the LIVE slot count", async () => {
    const { comp, blue, red } = await makeComp("Vacate Mid-Rack");
    const gameId = await makeGame(comp, "Vacate Recompute");
    await ctx.callerAs("planner").playGroups.setFoursomes({
      tripId, gameId,
      groups: [
        { name: "G1", userIds: [owner, member] },
        { name: "G2", userIds: [planner, outsider] },
      ],
    });
    // Owner sets total 10 over the full 2v2 (slot count 2) → per-slot 5. This is
    // the ONLY settings-time write in this test.
    await setTotal(gameId, 10, 2);
    const { data: preVacate } = await ctx.admin.from("games").select("points_distribution").eq("id", gameId).maybeSingle();
    expect((preVacate as { points_distribution: { value: number } }).points_distribution.value).toBe(5);

    // `member` has no scores anywhere in this fresh trip yet — findContributionBlockers
    // passes, and removal proceeds to clearTripParticipation → vacateTripGameSeats,
    // which DELETES member's game_participants row for every game in the trip
    // (rack has no side to null — the row itself goes). No settings Save follows.
    await ctx.caller().tripMembers.remove({ tripId, userId: member });

    const { data: parts } = await ctx.admin.from("game_participants").select("user_id").eq("game_id", gameId);
    expect((parts ?? []).map((p) => p.user_id as string).sort()).toEqual([outsider, owner, planner].sort());

    // The persisted snapshot is UNCHANGED (still the stale 5) — no Save happened.
    const { data: stillStale } = await ctx.admin.from("games").select("points_distribution").eq("id", gameId).maybeSingle();
    expect((stillStale as { points_distribution: { value: number } }).points_distribution.value).toBe(5);

    // Roster is now Blue{owner,planner} vs Red{outsider} → slot count min(2,1)=1,
    // so the LIVE per-slot value is 10/1=10, not the stale 10/2=5.
    await enter(gameId, owner, PAR);
    await enter(gameId, outsider, bogey);
    await ctx.caller().games.finish({ tripId, gameId });

    const { data: rows } = await ctx.admin.from("game_results").select("entity_id, raw_score").eq("game_id", gameId);
    const byTeam = Object.fromEntries((rows as { entity_id: string; raw_score: number }[]).map((r) => [r.entity_id, Number(r.raw_score)]));
    expect(byTeam[blue]).toBe(10); // 1 slot won × the LIVE 10/slot, not the stale 5
    expect(byTeam[red] ?? 0).toBe(0);
  }, 60000);
});
