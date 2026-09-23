import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";
import { MATCHES_COMPETITION_FORMAT } from "@/lib/resultStrategy";
import { computeCompetitionLeaderboard } from "./competitionLeaderboard";

/**
 * #1420, end to end: a FINISHED per-match game counts what it PAID toward
 * points-available — through the app's own writers and `games.finish`, never a
 * hand-inserted `game_results` row, because the claim is about what the
 * leaderboard does with rows the app really writes.
 *
 * The arithmetic and the three rulings (complete → paid, live → set, an open
 * correction holds) are pinned purely in `src/lib/settledPool.test.ts`. This
 * file exists for what only a database shows:
 *
 *  - the WIRING — that the leaderboard applies `settledPool` to each arm that
 *    can pay nobody (the match arm, via non-golf Matches; the pick'em arm);
 *  - the ANNOUNCEMENT — that a clinch created by the shrink is claimed by the
 *    same `games.finish` that caused it. `finish` is the ONLY place a clinch is
 *    announced; that the shrink happens there and nowhere else is the whole
 *    reason live games keep the owner-set total (ruling 2).
 *
 * Golf match play shares the match arm with Matches — same `expects: "points"`
 * return, same `settledPool` below it — and is not finalized separately here.
 * Stated rather than implied.
 *
 * Every case asserts the LIVE value first, as its control: without it, "4
 * available" would pass on a fixture that was only ever worth 4.
 */

const MANUAL = "gtt_generic_card";

let ctx: TestContext;
let tripId: string;
let owner: string;
let member: string;
const gameIds: string[] = [];
const guestIds: string[] = [];

async function guest(name: string): Promise<string> {
  const id = `ghost-${crypto.randomUUID()}`;
  await ctx.admin.from("users").insert({ id, name, is_guest: true });
  guestIds.push(id);
  await ctx.addTripMemberById(tripId, id, "Member");
  return id;
}

async function claimOf(competitionId: string): Promise<string | null> {
  const { data } = await ctx.admin
    .from("competitions")
    .select("clinch_notified_team_id")
    .eq("id", competitionId)
    .maybeSingle();
  return (data?.clinch_notified_team_id as string | null) ?? null;
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("paid-not-set trip");
  owner = ctx.getUser("owner").id;
  member = ctx.getUser("member").id;
  await ctx.addTripMemberById(tripId, member, "Member");
});

afterAll(async () => {
  if (gameIds.length > 0) {
    await ctx.admin.from("game_results").delete().in("game_id", gameIds);
    await ctx.admin.from("pickem_picks").delete().in("game_id", gameIds);
    await ctx.admin.from("pickem_slate_games").delete().in("game_id", gameIds);
    await ctx.admin.from("game_matches").delete().in("game_id", gameIds);
    await ctx.admin.from("game_participants").delete().in("game_id", gameIds);
    await ctx.admin.from("games").delete().in("id", gameIds);
  }
  await ctx.cleanup();
  if (guestIds.length > 0) await ctx.admin.from("users").delete().in("id", guestIds);
});

describe("non-golf Matches — the match arm", () => {
  it("a match undecided at finalize leaves the target, and the clinch is announced by that finalize", async () => {
    const comp = await ctx.createCompetition(tripId, "Paid Not Set Cup");
    const teamA = await ctx.createTeam(comp, "Alpha", { shortName: "ALP" });
    const teamB = await ctx.createTeam(comp, "Bravo", { shortName: "BRV" });
    const ghostA = await guest("Paid Ghost A");
    const ghostB = await guest("Paid Ghost B");
    await ctx.admin.from("team_assignments").insert([
      { competition_id: comp, user_id: owner, team_id: teamA },
      { competition_id: comp, user_id: ghostA, team_id: teamA },
      { competition_id: comp, user_id: member, team_id: teamB },
      { competition_id: comp, user_id: ghostB, team_id: teamB },
    ]);

    const g = (await ctx.caller().games.create({
      tripId,
      gameTypeId: MANUAL,
      name: "paid not set",
      competitionId: comp,
    })) as { id: string };
    gameIds.push(g.id);
    await ctx.admin
      .from("games")
      .update({
        points_total: 8,
        points_distribution: { type: "per_match", value: 4 },
        competition_format: MATCHES_COMPETITION_FORMAT,
      })
      .eq("id", g.id);

    // The real payload builder (`matchesCupPayout.test.ts`'s shape).
    const hash = (await ctx.caller().games.configHash({ tripId, gameId: g.id })).hash;
    await ctx.caller().games.saveConfig({
      tripId,
      gameId: g.id,
      baseHash: hash,
      payload: {
        name: "paid not set",
        rulesForToday: null,
        scoringEnabled: true,
        pointsTotal: 8,
        pointsDistribution: { type: "per_match", value: 4 },
        courseId: null,
        backCourseId: null,
        scorecardSchema: null,
        delegates: [],
        competitionFormat: MATCHES_COMPETITION_FORMAT,
        matches: [
          { matchNumber: 1, playersPerSide: 1 as const, a: [owner], b: [member], strokesA: 0, strokesB: 0, pointValue: null },
          { matchNumber: 2, playersPerSide: 1 as const, a: [ghostA], b: [ghostB], strokesA: 0, strokesB: 0, pointValue: null },
        ],
        matchesStructureDirty: true,
      },
    });
    const { data: ms } = await ctx.admin
      .from("game_matches")
      .select("id, match_number")
      .eq("game_id", g.id)
      .order("match_number");
    expect(ms).toHaveLength(2);

    // Bravo takes match 1; match 2 is never decided.
    await ctx.caller().matches.setResult({ tripId, gameId: g.id, matchId: ms![0].id as string, result: "b_win" });

    // CONTROL — live, the owner-set total stands (ruling 2): 8 available, first
    // to 4.5, Bravo on 0 banked. Nobody has clinched and nothing is claimed.
    const live = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(live.pointsAvailable).toBe(8);
    expect(await claimOf(comp)).toBeNull();

    await ctx.caller().games.finish({ tripId, gameId: g.id });

    // The write: Bravo 4, Alpha 0 — match 2's 4 went to nobody.
    const { data: rows } = await ctx.admin
      .from("game_results")
      .select("entity_id, raw_score")
      .eq("game_id", g.id)
      .eq("entity_type", "team");
    const paid = new Map((rows ?? []).map((r) => [r.entity_id as string, Number(r.raw_score)]));
    expect(paid.get(teamB)).toBe(4);
    expect(paid.get(teamA)).toBe(0);

    // The read: 4 available, not 8 — so first to 2.5, and Bravo's 4 clinches.
    const done = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(done.pointsAvailable).toBe(4);
    expect(done.winNumber).toBe(2.5);
    expect(done.teamTotals[teamB]).toBe(4);
    expect(done.pointsToClinch[teamB]).toBeLessThanOrEqual(0);

    // …and ANNOUNCED, by the finalize that caused it. Counted as set, 4 of 4.5
    // would not clinch and this claim would be null — the red this case exists
    // to be able to produce.
    expect(await claimOf(comp)).toBe(teamB);
    const { data: sends } = await ctx.admin
      .from("push_send_log")
      .select("trigger")
      .eq("competition_id", comp)
      .eq("trigger", "cup_clinched");
    expect((sends ?? []).length).toBeGreaterThan(0);

    // Ruling 3: opening a correction must NOT raise the target back to 8. If it
    // did, the cup would un-clinch here and the re-finalize would announce it
    // again — a second push to every phone for a correction nobody acted on.
    await ctx.caller().games.openCorrection({ tripId, gameId: g.id });
    const correcting = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(correcting.pointsAvailable).toBe(4);
    expect(correcting.pointsToClinch[teamB]).toBeLessThanOrEqual(0);
  });
});

describe("pick'em individual matches — the pick'em arm", () => {
  /** A locked pick'em in its own cup; every slate game resolved. */
  async function pickem(label: string) {
    const competitionId = await ctx.createCompetition(tripId, `pickem ${label}`);
    const teamA = await ctx.createTeam(competitionId, "Alpha");
    const teamB = await ctx.createTeam(competitionId, "Bravo");
    await ctx.admin.from("team_assignments").insert([
      { competition_id: competitionId, user_id: owner, team_id: teamA },
      { competition_id: competitionId, user_id: member, team_id: teamB },
    ]);
    const g = (await ctx.caller().games.create({
      tripId,
      gameTypeId: "gtt_pickem",
      name: `pickem ${label}`,
      competitionId,
    })) as { id: string };
    gameIds.push(g.id);
    await ctx.admin.from("games").update({ points_total: 10 }).eq("id", g.id);
    await ctx.admin.from("pickem_games").upsert({
      game_id: g.id,
      picks_opened_at: new Date(Date.now() - 7_200_000).toISOString(),
      picks_locked_at: new Date(Date.now() - 3_600_000).toISOString(),
      roll_up: "individual_matches",
      use_confidence: true,
    });
    await ctx.admin.from("pickem_slate_games").insert(
      [0, 1].map((i) => ({
        id: genId("sg"),
        game_id: g.id,
        display_order: i,
        away_team: `Away${i}`,
        home_team: `Home${i}`,
        multiplier: 1,
        result: "home",
      }))
    );
    return { competitionId, gameId: g.id, teamA, teamB };
  }

  it("NO matches drawn → the whole total goes unpaid, and the target drops by all of it", async () => {
    // The SHAPE of Picks 2 on the Test Cup (individual matches, none drawn),
    // finalized. This fixture is worth 10; Picks 2 itself is worth 1 — an
    // earlier version of this comment ran the two together. Before #1420 the
    // whole total stayed in the target forever, winnable by nobody.
    const f = await pickem("no matches");
    const live = await computeCompetitionLeaderboard(ctx.admin, f.competitionId);
    expect(live.pointsAvailable).toBe(10); // control

    await ctx.caller().games.finish({ tripId, gameId: f.gameId });
    const done = await computeCompetitionLeaderboard(ctx.admin, f.competitionId);
    expect(done.teamTotals[f.teamA]).toBe(0);
    expect(done.teamTotals[f.teamB]).toBe(0);
    expect(done.pointsAvailable).toBe(0);
  });

  it("a match whose sheets are BOTH empty pays nobody (#1419) — and leaves the target too", async () => {
    const f = await pickem("both empty");
    await ctx.admin.from("game_matches").insert({
      id: crypto.randomUUID(),
      game_id: f.gameId,
      match_number: 1,
      display_order: 0,
      side_a: { type: "user", id: owner },
      side_b: { type: "user", id: member },
      status: "active",
    });
    const live = await computeCompetitionLeaderboard(ctx.admin, f.competitionId);
    expect(live.pointsAvailable).toBe(10); // control

    await ctx.caller().games.finish({ tripId, gameId: f.gameId });
    const done = await computeCompetitionLeaderboard(ctx.admin, f.competitionId);
    expect(done.teamTotals[f.teamA]).toBe(0);
    expect(done.teamTotals[f.teamB]).toBe(0);
    expect(done.pointsAvailable).toBe(0);
  });
});
