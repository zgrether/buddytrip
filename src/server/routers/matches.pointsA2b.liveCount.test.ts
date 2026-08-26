import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { evenShare, liveMatchPointsPerMatch } from "@/lib/pointsDistribution";

/**
 * #1031 — the per-match even share must be recomputed LIVE from the game's
 * current assigned matches, never read from the persisted
 * `points_distribution.value` snapshot (which only refreshes on a settings
 * Save). Two failure modes, both proven here against the real DB:
 *
 *  - the divisor changing with NO Save in between (a seat vacate nulling a
 *    match's side, or the reverse — a match being added/re-paired);
 *  - the award WRITE (`computeMatchPlayResults` → `game_results`) landing the
 *    stale, pre-change number instead of the live one.
 *
 * `matches.pointsA2b.test.ts` covers the override/redistribution math and the
 * Save-time wiring; this file covers the live-recompute guarantee #1031 adds
 * on top of it.
 */

const MATCH_PLAY = "gtt_match_play";

let ctx: TestContext;
let tripId: string;
let owner: string, planner: string, member: string, outsider: string;
const gameIds: string[] = [];

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("A2b Live Count Trip");
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

async function currentAssignedMatches(gameId: string) {
  const { data } = await ctx.admin.from("game_matches").select("side_a, side_b, point_value").eq("game_id", gameId);
  return ((data ?? []) as { side_a: Side; side_b: Side; point_value: number | null }[]).map((m) => ({
    sideAId: m.side_a?.id ?? null,
    sideBId: m.side_b?.id ?? null,
    pointValue: m.point_value,
  }));
}

describe("#1031 — the divisor is the LIVE assigned-match count, recomputed on every read", () => {
  it("match count 2 → 1 → 2 (no Save between): liveMatchPointsPerMatch recomputes each time", async () => {
    // Only 4 users are available in the shared test harness, so a SINGLES game
    // can carry at most 2 non-overlapping matches at once (a person is on one
    // side per game) — 2 → 1 → 2 already proves the divisor recomputes on every
    // read in both directions without inventing an unreachable roster shape.
    const { comp } = await makeComp("Live Divisor");
    const gameId = await makeGame(comp, "Two Then One Then Two");
    await ctx.caller().matches.setPairings({
      tripId, gameId,
      matches: [
        { playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 },
        { playersPerSide: 1, sideA: { members: [planner] }, sideB: { members: [outsider] }, matchNumber: 2 },
      ],
    });
    await ctx.caller().games.setPointsTotal({ tripId, gameId, total: 12 });

    // 2 matches, total 12, no overrides → 6 each. Live, no setPointsDistribution call.
    expect(liveMatchPointsPerMatch(12, await currentAssignedMatches(gameId))).toBe(evenShare(12, [], 2));
    expect(liveMatchPointsPerMatch(12, await currentAssignedMatches(gameId))).toBe(6);

    // Drop to 1 match — re-pair down to a single match (matchesStructureDirty path).
    await ctx.caller().matches.setPairings({
      tripId, gameId,
      matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 }],
    });
    expect(liveMatchPointsPerMatch(12, await currentAssignedMatches(gameId))).toBe(12); // 12/1, no Save

    // Regrow to 2 matches (a different pairing than the original) — still no Save.
    await ctx.caller().matches.setPairings({
      tripId, gameId,
      matches: [
        { playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [planner] }, matchNumber: 1 },
        { playersPerSide: 1, sideA: { members: [member] }, sideB: { members: [outsider] }, matchNumber: 2 },
      ],
    });
    expect(liveMatchPointsPerMatch(12, await currentAssignedMatches(gameId))).toBe(6); // 12/2, still no Save
  }, 60000);

  it("a seat vacate invalidates a match with NO settings Save — the surviving match's derived value updates immediately, and the award write uses it", async () => {
    const { comp, blue, red } = await makeComp("Vacate Mid-Game");
    const gameId = await makeGame(comp, "Vacate Recompute");
    const matches = (await ctx.caller().matches.setPairings({
      tripId, gameId,
      matches: [
        { playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 },
        { playersPerSide: 1, sideA: { members: [planner] }, sideB: { members: [outsider] }, matchNumber: 2 },
      ],
    })) as MatchRow[];
    const survivor = matches[1]; // planner vs outsider — untouched by member's removal

    // Owner sets a total of 3 over 2 matches → 1.5 each, exactly the reported repro
    // ("2 matches, 3 total → 1.5 each"). This is the ONLY settings-time write in
    // this test — everything after happens with NO further Save.
    await ctx.caller().games.setPointsTotal({ tripId, gameId, total: 3 });
    await ctx.caller().games.setPointsDistribution({ tripId, gameId, distribution: { type: "per_match", value: evenShare(3, [], 2) } });
    const { data: preVacate } = await ctx.admin.from("games").select("points_distribution").eq("id", gameId).maybeSingle();
    expect((preVacate as { points_distribution: { value: number } }).points_distribution.value).toBe(1.5);

    // Scoring is already ON — the reported repro's actual scenario: a vacate
    // mid-round, not mid-setup. Both matches are still paired here, so the
    // enable gate (`matchPlayReady`: paired === total) passes; the vacate below
    // does not need to re-pass it, only `finish` does.
    await ctx.caller().games.enableScoring({ tripId, gameId });

    // `member` has no contributions yet (no scores) — findContributionBlockers
    // passes and the removal proceeds to clearTripParticipation → vacateTripGameSeats,
    // nulling match 1's side_b with NO settings Save.
    await ctx.caller().tripMembers.remove({ tripId, userId: member });

    // Match 1 is now unassigned; match 2 (the survivor) is untouched.
    const { data: matchRows } = await ctx.admin.from("game_matches").select("id, side_a, side_b").eq("game_id", gameId);
    const rows = (matchRows ?? []) as { id: string; side_a: Side; side_b: Side }[];
    const m1 = rows.find((r) => r.id === matches[0].id)!;
    expect(m1.side_b).toBeNull();
    expect(rows.find((r) => r.id === survivor.id)!.side_b?.id).toBe(outsider);

    // The persisted snapshot is UNCHANGED (still the stale 1.5) — no Save happened.
    // The point of #1031 is that nothing downstream should read it.
    const { data: stillStale } = await ctx.admin.from("games").select("points_distribution").eq("id", gameId).maybeSingle();
    expect((stillStale as { points_distribution: { value: number } }).points_distribution.value).toBe(1.5);

    // The LIVE derivation over the CURRENT game_matches already answers 3, not 1.5.
    expect(liveMatchPointsPerMatch(3, await currentAssignedMatches(gameId))).toBe(3);

    // Play out the survivor and finish — the award WRITE must use the live value.
    // Scoring was already enabled above (pre-vacate); enableScoring is idempotent.
    const caller = ctx.caller();
    for (let h = 1; h <= 10; h++) {
      await caller.scores.upsertEntry({ tripId, gameId, participantId: planner, unitLabel: String(h), value: 4, participantType: "user" });
      await caller.scores.upsertEntry({ tripId, gameId, participantId: outsider, unitLabel: String(h), value: 5, participantType: "user" });
    }
    await ctx.caller().games.finish({ tripId, gameId });

    const { data: teamRows } = await ctx.admin
      .from("game_results").select("entity_id, raw_score").eq("game_id", gameId).eq("entity_type", "team");
    const byTeam = Object.fromEntries((teamRows as { entity_id: string; raw_score: number }[]).map((r) => [r.entity_id, Number(r.raw_score)]));
    // Blue (planner) sweeps the surviving match — 3 pts, NOT the stale 1.5.
    expect(byTeam[blue]).toBe(3);
    expect(byTeam[red] ?? 0).toBe(0);
  }, 60000);
});

