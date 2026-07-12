import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * Refactor B2 — the headline acceptance case, end to end through the REAL write
 * path (matchOutcomes.upsertOutcome, not an admin insert — B1's test used admin
 * inserts to isolate the compute layer; this proves the full B2 pipeline: tap →
 * router mutation → finish → leaderboard, exactly the flow the entry surface
 * drives). "a match-play game set to hole-outcome mode: tap the winner of each
 * hole... finishes + posts to the leaderboard identically to a stroke game —
 * with no score_entries rows anywhere."
 */

const MATCH_PLAY = "gtt_match_play";

let ctx: TestContext;
let tripId: string;
let owner: string, member: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Outcome E2E Trip");
  await ctx.addTripMember(tripId, "member", "Member");
  owner = ctx.user.id;
  member = ctx.getUser("member").id;
});

afterAll(async () => {
  await ctx.cleanup();
});

describe("Refactor B2 acceptance case — outcome entry, tap by tap, posts like a stroke game", () => {
  it("records 3&2 via real upsertOutcome calls, finishes, and posts to the leaderboard — zero score_entries", async () => {
    const comp = await ctx.createCompetition(tripId, "Outcome E2E Cup");
    const blue = await ctx.createTeam(comp, "Blue");
    const red = await ctx.createTeam(comp, "Red");
    await ctx.admin.from("team_assignments").insert([
      { competition_id: comp, user_id: owner, team_id: blue },
      { competition_id: comp, user_id: member, team_id: red },
    ]);

    const game = await ctx.caller().games.create({
      tripId, gameTypeId: MATCH_PLAY, name: "Buddy v Rival", competitionId: comp,
      pointsDistribution: { type: "per_match", value: 3 },
    });
    const gameId = game.id as string;
    await ctx.admin.from("games").update({ entry_mode: "outcome" }).eq("id", gameId);
    const matches = await ctx.caller().matches.setPairings({
      tripId, gameId,
      matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 }],
    });
    const matchId = (matches as { id: string }[])[0].id;
    await ctx.caller().games.enableScoring({ tripId, gameId });

    // Tap the winner of each hole — the SAME mutation MatchOutcomeEntryView's
    // choice buttons call. Owner wins 1-3, halves 4-16 → 3&2 (mirrors the
    // score-mode "Close 3&2" acceptance case exactly, decided the outcome way).
    for (let h = 1; h <= 3; h++) {
      await ctx.caller().matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: h, result: "side_a" });
    }
    for (let h = 4; h <= 16; h++) {
      await ctx.caller().matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: h, result: "halved" });
    }

    const { matches: outcome } = await ctx.caller().games.finish({ tripId, gameId });
    expect(outcome[0]).toMatchObject({ result: "a_win", margin: "3&2", status: "complete" });

    // Posts to the leaderboard exactly like a stroke game — the SAME payload
    // shape, the SAME per_match team-points adapter.
    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(lb.teamTotals[blue]).toBe(3);
    expect(lb.teamTotals[red] ?? 0).toBe(0);

    // The headline: zero score_entries anywhere for this game.
    const { data: scoreRows } = await ctx.admin.from("score_entries").select("id").eq("game_id", gameId);
    expect(scoreRows).toHaveLength(0);

    // The posted-lock applies to outcomes exactly like scores: a finished
    // (complete, not re-opened for correction) game rejects further edits.
    await expect(
      ctx.caller().matchOutcomes.deleteOutcome({ tripId, gameId, matchId, holeNumber: 3 })
    ).rejects.toThrow(/posted/i);
  }, 60000);
});

describe("Refactor B3 — presence + live projection for an in-progress outcome-mode game", () => {
  it("an outcome-mode game reads 'started' and gets a live-projection pill as soon as ≥1 hole is decided", async () => {
    const comp = await ctx.createCompetition(tripId, "Outcome B3 Presence Cup");
    const blue = await ctx.createTeam(comp, "Blue");
    const red = await ctx.createTeam(comp, "Red");
    await ctx.admin.from("team_assignments").insert([
      { competition_id: comp, user_id: owner, team_id: blue },
      { competition_id: comp, user_id: member, team_id: red },
    ]);

    const game = await ctx.caller().games.create({
      tripId, gameTypeId: MATCH_PLAY, name: "Live Outcome Match", competitionId: comp,
      pointsDistribution: { type: "per_match", value: 3 },
    });
    const gameId = game.id as string;
    await ctx.admin.from("games").update({ entry_mode: "outcome" }).eq("id", gameId);
    const matches = await ctx.caller().matches.setPairings({
      tripId, gameId,
      matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 }],
    });
    const matchId = (matches as { id: string }[])[0].id;
    await ctx.caller().games.enableScoring({ tripId, gameId });

    // Before any hole is decided — the board still shows this as Ready for
    // Play, not On Tap; no rows in match_hole_outcomes means the OLD
    // score_entries-only presence check would have never flipped it.
    const before = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(before.games.find((g) => g.id === gameId)?.started).toBe(false);
    expect(before.projections[gameId]).toBeUndefined();

    // Owner wins hole 1 via the real upsertOutcome path — the game is now
    // "on tap" and the board projects the current leader's full match value.
    await ctx.caller().matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: 1, result: "side_a" });

    const after = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(after.games.find((g) => g.id === gameId)?.started).toBe(true);
    expect(after.projections[gameId]).toEqual({ [blue]: 3 });
  }, 60000);
});
