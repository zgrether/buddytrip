import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * #1416 — the board banks a game's result rows only once the game is FINISHED.
 *
 * Result rows reach a LIVE game by design, from more places than anyone listed:
 * `saveConfig`'s recompute (stroke / skins / rack / match), and five match-play
 * setup mutations (`assignPlayer`, `setHandicap`, `setPointValue`,
 * `removeMatch`, `setParticipantStrokes`) that bank every match decided so far.
 * And `games.finish` writes results BEFORE it flips `status`, in two updates, so
 * a failure between them leaves finished rows on a live game through no
 * ordinary path at all. Enumerating writers is how the ninth gets missed; the
 * board reads the outcome instead — a live game banks nothing (Zach, 2026-09-23,
 * reader-first).
 *
 * THIS FILE WAS PUSHED BEFORE THE FIX, on purpose. The match-play half of the
 * finding came from reading, not a run; the red on that commit is the
 * demonstration, and the green on the next is the fix.
 *
 * What it shows, through the real write paths:
 *  1. DOUBLE COUNT — the hero's "if today holds" total is banked + projected,
 *     and a live match-play game's decided match was in both.
 *  2. SILENT CLINCH — a mid-round edit that banks a decided match can cross the
 *     threshold, and none of the setup paths calls `games.finish`, the only
 *     place a clinch is announced. The board says clinched; nobody is told.
 *  3. THE MATRIX — a live placement game's partial rows render as that game's
 *     points (and the totals row) on a points cup.
 */

const MATCH_PLAY = "gtt_match_play";
const MANUAL = "gtt_generic_card";

let ctx: TestContext;
let tripId: string;
let owner: string;
let member: string;

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
  tripId = await ctx.createTrip("live-banks-nothing trip");
  await ctx.addTripMember(tripId, "member", "Member");
  owner = ctx.user.id;
  member = ctx.getUser("member").id;
});

afterAll(async () => {
  await ctx.cleanup();
});

describe("match play — a decided match banked by a mid-round edit", () => {
  it("is projected, NOT banked, until the finalize — which is also what announces the clinch", async () => {
    const comp = await ctx.createCompetition(tripId, "Live Banks Nothing Cup");
    const blue = await ctx.createTeam(comp, "Blue");
    const red = await ctx.createTeam(comp, "Red");
    await ctx.admin.from("team_assignments").insert([
      { competition_id: comp, user_id: owner, team_id: blue },
      { competition_id: comp, user_id: member, team_id: red },
    ]);

    const game = await ctx.caller().games.create({
      tripId,
      gameTypeId: MATCH_PLAY,
      name: "Mid-round edit",
      competitionId: comp,
      pointsDistribution: { type: "per_match", value: 3 },
    });
    const gameId = game.id as string;
    await ctx.admin.from("games").update({ entry_mode: "outcome" }).eq("id", gameId);
    const matches = await ctx.caller().matches.setPairings({
      tripId,
      gameId,
      matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 }],
    });
    const matchId = (matches as { id: string }[])[0].id;
    await ctx.caller().games.enableScoring({ tripId, gameId });

    // Blue wins 1-10: ten up with eight to play — decided, 10&8. Outcome entry
    // runs no recompute, so nothing is banked by the entries themselves.
    for (let h = 1; h <= 10; h++) {
      await ctx.caller().matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: h, result: "side_a" });
    }

    // The mid-round edit: an ordinary setup correction. It recomputes, and the
    // recompute banks every decided match as a TEAM row.
    await ctx.caller().matches.setHandicap({ tripId, gameId, matchId, recipientId: member, strokes: 0 });

    // THE MECHANISM, asserted before the outcome: the live game holds a team row
    // paying Blue. This half is the writer, which this PR leaves as it is for
    // match play — if it ever stops being true, the scenario below proves nothing.
    const { data: g } = await ctx.admin.from("games").select("status").eq("id", gameId).single();
    expect(g!.status).not.toBe("complete");
    const { data: teamRows } = await ctx.admin
      .from("game_results")
      .select("entity_id, raw_score")
      .eq("game_id", gameId)
      .eq("entity_type", "team");
    expect(new Map((teamRows ?? []).map((r) => [r.entity_id, Number(r.raw_score)])).get(blue)).toBe(3);

    const live = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });

    // 1. Nothing banked for a live game…
    expect(live.teamTotals[blue]).toBe(0);
    // …the decided match is PROJECTED…
    expect(live.projections[gameId]?.[blue]).toBe(3);
    // …and counted ONCE in "if today holds". Before the fix: 6 — banked 3 + projected 3.
    expect(live.projectedTeamTotals[blue]).toBe(3);

    // 2. Not clinched mid-round. Before the fix: 3 available, first to 2,
    // Blue banked 3 → clinched — with no push, because setHandicap never calls
    // finish. The claim is null either way; that is the silence.
    expect(live.pointsToClinch[blue]).toBeGreaterThan(0);
    expect(await claimOf(comp)).toBeNull();

    // The finalize banks it, clinches, and ANNOUNCES — one event, one moment.
    await ctx.caller().games.finish({ tripId, gameId });
    const done = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(done.teamTotals[blue]).toBe(3);
    expect(done.pointsToClinch[blue]).toBeLessThanOrEqual(0);
    expect(await claimOf(comp)).toBe(blue);
  }, 60000);
});

describe("points cup — a live placement game's rows", () => {
  it("render as nothing in the matrix or the standings until the game is finished", async () => {
    const comp = await ctx.createCompetition(tripId, "Live Matrix Cup", { scoringModel: "points" });
    const blue = await ctx.createTeam(comp, "Blue", { shortName: "BLU" });
    const red = await ctx.createTeam(comp, "Red", { shortName: "RED" });
    const g = (await ctx.caller().games.create({
      tripId,
      gameTypeId: MANUAL,
      name: "Live placement",
      competitionId: comp,
      pointsDistribution: { type: "placement", values: [5, 3] },
      pointsTotal: 8,
    })) as { id: string };

    // Rows on an UNFINISHED game — the shape a mid-round stroke/skins settings
    // save produced (#1416 as filed). Written through the one procedure that
    // still does it for a manual game with no status check.
    await ctx.caller().games.setManualResults({
      tripId,
      gameId: g.id,
      placements: [
        { entityId: blue, position: 1 },
        { entityId: red, position: 2 },
      ],
    });
    const { data: st } = await ctx.admin.from("games").select("status").eq("id", g.id).single();
    expect(st!.status).not.toBe("complete");

    const live = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(live.teamTotals[blue]).toBe(0);
    expect(live.teamTotals[red]).toBe(0);
    // The matrix renders `cells`; a live game must contribute none.
    expect(live.cells.filter((c) => c.gameId === g.id)).toEqual([]);
    // The target is unaffected either way — the owner-set total, as #1425 keeps
    // it for every live game.
    expect(live.pointsAvailable).toBe(8);

    await ctx.caller().games.finish({
      tripId,
      gameId: g.id,
      placements: [
        { entityId: blue, position: 1 },
        { entityId: red, position: 2 },
      ],
    });
    const done = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(done.teamTotals[blue]).toBe(5);
    expect(done.teamTotals[red]).toBe(3);
    expect(done.cells.filter((c) => c.gameId === g.id)).toHaveLength(2);
  }, 60000);
});
