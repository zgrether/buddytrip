import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * matches.setResult — declaring one match's result directly (non-golf
 * Matches, 170). No migration dependency: `game_matches.result`/`status` have
 * existed since 035, so this file runs on any stack, unlike the 171-dependent
 * `save_game_config` freeze tests.
 *
 * Mirrors `matchOutcomes.upsertOutcome`'s own gate shape (posted/enabled
 * checks, unpaired-match refusal) — the write-path counterpart one level up
 * (a MATCH's result, not a hole's), so the guards are asserted the same way:
 * a real write, refused or accepted, not a literal-vs-literal check.
 */

const CARD = "gtt_generic_card";

let ctx: TestContext;
let tripId: string;
let owner: string, member: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("setResult Trip");
  await ctx.addTripMember(tripId, "member", "Member");
  await ctx.addTripMember(tripId, "outsider", "Member");
  owner = ctx.user.id;
  member = ctx.getUser("member").id;
});

afterAll(async () => {
  await ctx.cleanup();
});

/** A fresh Matches-shaped game: paired, scoring enabled. Returns the game and
 *  match ids. */
async function freshDecidableGame(name: string): Promise<{ gameId: string; matchId: string }> {
  // `gtt_generic_card` is neither a MATCH_PLAY_TYPE nor a ROSTER_TYPE, so
  // `assertGameReady`'s readiness falls to its `hasPoints` arm regardless of
  // pairing — a points total, not the pairing, is what `enableScoring` is
  // actually gated on for this game type. Set at CREATE (`games.create`
  // accepts it directly; `games.update`'s Configuration-tab zod does not).
  const game = await ctx.caller().games.create({ tripId, gameTypeId: CARD, name, pointsTotal: 4 });
  const gameId = game.id as string;
  const matches = await ctx.caller().matches.setPairings({
    tripId,
    gameId,
    matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 }],
  });
  const matchId = (matches as { id: string }[])[0].id;
  await ctx.caller().games.enableScoring({ tripId, gameId });
  return { gameId, matchId };
}

/**
 * Posts the game via the MANUAL arm (`placements: []`), NOT the "matches"
 * arm — deliberately. The migration (170) that admits `competition_format =
 * 'matches'` is not on every stack this file runs against, and `setResult`
 * itself has no opinion on competition_format at all (it only ever touches
 * `game_matches`), so these tests stay independent of that migration entirely
 * rather than joining the small set that can only be trusted on CI. An empty
 * `placements` array is a real, accepted input (`writeManualResults` writes
 * zero rows and returns cleanly) — what's under test here is `status` moving
 * to `complete`, not which arm computed the result.
 */
async function post(gameId: string) {
  await ctx.caller().games.finish({ tripId, gameId, placements: [] });
}

async function matchRow(matchId: string) {
  const { data } = await ctx.admin.from("game_matches").select("result, margin, status").eq("id", matchId).maybeSingle();
  return data as { result: string | null; margin: string | null; status: string } | null;
}

describe("matches.setResult — declares a match's result", () => {
  it("an owner declares a_win — result + status write, no margin invented", async () => {
    const { gameId, matchId } = await freshDecidableGame("Declares a_win");
    await ctx.caller().matches.setResult({ tripId, gameId, matchId, result: "a_win" });
    const row = await matchRow(matchId);
    expect(row?.result).toBe("a_win");
    expect(row?.status).toBe("complete");
    // A declared result has no hole sequence to derive a margin from
    // ("3&2") — must stay null, not invented.
    expect(row?.margin).toBeNull();
  });

  it("re-declaring changes the result cleanly — a_win then b_win then halve", async () => {
    const { gameId, matchId } = await freshDecidableGame("Re-declares");
    await ctx.caller().matches.setResult({ tripId, gameId, matchId, result: "a_win" });
    await ctx.caller().matches.setResult({ tripId, gameId, matchId, result: "b_win" });
    expect((await matchRow(matchId))?.result).toBe("b_win");
    await ctx.caller().matches.setResult({ tripId, gameId, matchId, result: "halve" });
    expect((await matchRow(matchId))?.result).toBe("halve");
  });

  it("a null result UNSETS a declared match back to undecided — result, margin and status all revert (feedback: a mis-tap needs a way back)", async () => {
    const { gameId, matchId } = await freshDecidableGame("Unsets");
    await ctx.caller().matches.setResult({ tripId, gameId, matchId, result: "a_win" });
    expect((await matchRow(matchId))?.status).toBe("complete");
    await ctx.caller().matches.setResult({ tripId, gameId, matchId, result: null });
    const row = await matchRow(matchId);
    expect(row?.result).toBeNull();
    expect(row?.margin).toBeNull();
    expect(row?.status).toBe("pending");
  });

  it("unsetting an already-undecided match is a harmless no-op", async () => {
    const { gameId, matchId } = await freshDecidableGame("Unset no-op");
    await ctx.caller().matches.setResult({ tripId, gameId, matchId, result: null });
    const row = await matchRow(matchId);
    expect(row?.result).toBeNull();
    expect(row?.status).toBe("pending");
  });

  it("an unpaired match refuses — nothing to resolve (Phase 0 §3)", async () => {
    const game = await ctx.caller().games.create({ tripId, gameTypeId: CARD, name: "Unpaired refuses" });
    const gameId = game.id as string;
    // One empty-B-side match — an assigned slot with nothing to resolve into.
    const matches = await ctx.caller().matches.setPairings({
      tripId,
      gameId,
      matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: null, matchNumber: 1 }],
    });
    const matchId = (matches as { id: string }[])[0].id;
    // Scoring enabled directly via admin, bypassing `games.enableScoring`'s
    // own readiness gate (this game has no points set, which is what it
    // would actually refuse on for a `gtt_generic_card` game — pairing
    // completeness isn't part of THAT type's readiness check at all). This
    // simulates a match losing its pairing AFTER scoring was already on (a
    // seat vacate, CLAUDE.md's documented case) rather than routing through
    // setup. `status: 'active'` + `pairings_published_at` are set alongside
    // `scoring_enabled` to satisfy migration 135's CHECK
    // (`games_scoring_requires_started_or_published`) — an admin write that
    // violates it fails SILENTLY unless the error is checked, which is
    // checked here on purpose after finding that out the direct way.
    const { error: forceEnableError } = await ctx.admin
      .from("games")
      .update({ scoring_enabled: true, status: "active", pairings_published_at: new Date().toISOString() })
      .eq("id", gameId);
    expect(forceEnableError, "test setup: force-enabling scoring").toBeNull();
    await expect(
      ctx.caller().matches.setResult({ tripId, gameId, matchId, result: "a_win" })
    ).rejects.toThrow(/isn't paired yet/i);
    expect((await matchRow(matchId))?.result).toBeNull();
  });

  it("scoring not enabled refuses — the same gate matchOutcomes.upsertOutcome uses", async () => {
    const game = await ctx.caller().games.create({ tripId, gameTypeId: CARD, name: "Not enabled refuses" });
    const gameId = game.id as string;
    const matches = await ctx.caller().matches.setPairings({
      tripId,
      gameId,
      matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 }],
    });
    const matchId = (matches as { id: string }[])[0].id;
    // Deliberately NOT calling enableScoring.
    await expect(
      ctx.caller().matches.setResult({ tripId, gameId, matchId, result: "a_win" })
    ).rejects.toThrow(/enable scoring/i);
  });

  it("a posted game (complete, corrections closed) refuses — points to the actual reopen action", async () => {
    const { gameId, matchId } = await freshDecidableGame("Posted refuses");
    await ctx.caller().matches.setResult({ tripId, gameId, matchId, result: "a_win" });
    await post(gameId);
    await expect(
      ctx.caller().matches.setResult({ tripId, gameId, matchId, result: "b_win" })
    ).rejects.toThrow(/correct a score/i);
  });

  it("reopened for correction (corrections_open) accepts a changed result again", async () => {
    const { gameId, matchId } = await freshDecidableGame("Correction reopens");
    await ctx.caller().matches.setResult({ tripId, gameId, matchId, result: "a_win" });
    await post(gameId);
    await ctx.admin.from("games").update({ corrections_open: true }).eq("id", gameId);
    await ctx.caller().matches.setResult({ tripId, gameId, matchId, result: "halve" });
    expect((await matchRow(matchId))?.result).toBe("halve");
  });

  it("a plain member is refused — this surface is owner/delegate-only, matching NonGolfScoreboard's existing precedent", async () => {
    const { gameId, matchId } = await freshDecidableGame("Member refused");
    await expect(
      ctx.callerAs("member").matches.setResult({ tripId, gameId, matchId, result: "a_win" })
    ).rejects.toThrow();
    expect((await matchRow(matchId))?.result).toBeNull();
  });

  it("a non-trip outsider is refused", async () => {
    const { gameId, matchId } = await freshDecidableGame("Outsider refused");
    await expect(
      ctx.callerAs("outsider").matches.setResult({ tripId, gameId, matchId, result: "a_win" })
    ).rejects.toThrow();
  });

  it("a match id from a DIFFERENT game is refused, not silently found", async () => {
    const a = await freshDecidableGame("Game A");
    const b = await freshDecidableGame("Game B");
    await expect(
      ctx.caller().matches.setResult({ tripId, gameId: a.gameId, matchId: b.matchId, result: "a_win" })
    ).rejects.toThrow(/match not found/i);
  });
});
