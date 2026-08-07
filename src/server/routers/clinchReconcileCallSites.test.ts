import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * End-to-end: every mutation Phase 0 confirmed can un-clinch a cup, driven
 * through the REAL tRPC procedures (not the helper directly — that's
 * `reconcileClinchClaim.test.ts`). Each scenario clinches a cup for real (via
 * `games.finish`, the same path #839/#840 pin), performs the un-clinching
 * mutation, and asserts on the claim column — the only externally-observable
 * trace, since `notifyCupClinchedIfDecided`/`reconcileClinchClaim` both return
 * void and swallow their own errors.
 *
 * A fresh competition per test (`beforeEach`) rather than one shared fixture —
 * these mutations are destructive by nature (delete, reset), so sharing state
 * across cases would make failures order-dependent.
 */

const MANUAL = "gtt_generic_yard";

let ctx: TestContext;
let tripId: string;

async function stored(compId: string): Promise<string | null> {
  const { data } = await ctx.admin
    .from("competitions")
    .select("clinch_notified_team_id")
    .eq("id", compId)
    .maybeSingle();
  return (data?.clinch_notified_team_id as string | null) ?? null;
}

/** A 3-game, 1-point-each competition — available 3, winNumber 2. Games are
 *  created but NOT finalized; the caller decides the finalize order. */
async function seedThreeGameCup() {
  const compId = await ctx.createCompetition(tripId, "Reconcile E2E Cup", { scoringModel: "points" });
  const winner = await ctx.createTeam(compId, "Winner", { shortName: "WIN" });
  const loser = await ctx.createTeam(compId, "Loser", { shortName: "LOS", color: "#ef4444", colorDim: "#2a0a0a" });
  const games: string[] = [];
  for (let i = 0; i < 3; i++) {
    const g = (await ctx.caller().games.create({
      tripId,
      gameTypeId: MANUAL,
      name: `Game ${i + 1}`,
      competitionId: compId,
      pointsDistribution: { type: "placement", values: [1] },
      pointsTotal: 1,
    })) as { id: string };
    games.push(g.id);
  }
  return { compId, winner, loser, games };
}

async function finish(gameId: string, first: string, second: string) {
  await ctx.caller().games.finish({
    tripId,
    gameId,
    placements: [
      { entityId: first, position: 1 },
      { entityId: second, position: 2 },
    ],
  });
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Clinch Reconcile Call-Site Trip");
}, 120_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

describe("games.delete — clinch → delete the clinching game → same team re-clinches → push fires", () => {
  it("releases on delete, and a later finalize re-claims for the same team", async () => {
    const { compId, winner, loser, games } = await seedThreeGameCup();
    await finish(games[0], winner, loser);
    await finish(games[1], winner, loser); // winner 2 of 3 available — CLINCHED
    expect(await stored(compId)).toBe(winner);

    // Delete one of winner's two wins: remaining available = games[1] + games[2]
    // = 2, winThreshold(2) = 1.5, winner's remaining total = 1 < 1.5 — undecided.
    await ctx.caller().games.delete({ tripId, gameId: games[0] });
    expect(await stored(compId), "delete un-clinched — released").toBeNull();

    // Re-clinch: finish the last game for winner too. Available now 2
    // (games[1]+games[2]), winner 2 ≥ 1.5 — decided again, by the SAME team.
    await finish(games[2], winner, loser);
    expect(await stored(compId), "the same team re-clinching fires again").toBe(winner);
  }, 60_000);

  it("a delete that leaves the SAME team still clinched does not release (no double-push risk)", async () => {
    const { compId, winner, loser, games } = await seedThreeGameCup();
    await finish(games[0], winner, loser);
    await finish(games[1], winner, loser); // clinched, available=3, winner=2
    expect(await stored(compId)).toBe(winner);

    // Delete the UNPLAYED third game: available drops to 2, winner's total (2)
    // is unaffected and 2 ≥ winThreshold(2)=1.5 — still decided, same team.
    await ctx.caller().games.delete({ tripId, gameId: games[2] });
    expect(await stored(compId), "still clinched by the same team — must not release").toBe(winner);
  }, 60_000);
});

describe("games.resetScoring — clinch → reset the deciding game → same team re-clinches", () => {
  it("releases on reset, and a later finalize re-claims", async () => {
    const { compId, winner, loser, games } = await seedThreeGameCup();
    await finish(games[0], winner, loser);
    await finish(games[1], winner, loser); // clinched, available=3, winner=2
    expect(await stored(compId)).toBe(winner);

    // Reset ONE winning game: points_total survives (available stays 3), but
    // its result is cleared — winner drops to 1 < winNumber 2 — undecided.
    await ctx.caller().games.resetScoring({ tripId, gameId: games[0] });
    expect(await stored(compId), "reset un-clinched — released").toBeNull();

    await finish(games[0], winner, loser); // re-finalize the reset game
    expect(await stored(compId), "re-clinches for the same team").toBe(winner);
  }, 60_000);
});

describe("games.resetToSkeleton — same shape as resetScoring", () => {
  it("releases on reset-to-skeleton, and a later finalize re-claims", async () => {
    const { compId, winner, loser, games } = await seedThreeGameCup();
    await finish(games[0], winner, loser);
    await finish(games[1], winner, loser);
    expect(await stored(compId)).toBe(winner);

    // points_total SURVIVES this primitive (migration 066 clears only the
    // placement split) — same availability-preserving shape as resetScoring.
    await ctx.caller().games.resetToSkeleton({ tripId, gameId: games[0] });
    expect(await stored(compId), "released").toBeNull();

    // Re-finalizing needs a fresh distribution — resetToSkeleton clears the
    // split, so set it back before finishing.
    await ctx.caller().games.setPointsDistribution({
      tripId, gameId: games[0], distribution: { type: "placement", values: [1] },
    });
    await finish(games[0], winner, loser);
    expect(await stored(compId), "re-clinches for the same team").toBe(winner);
  }, 60_000);
});

describe("games.setPointsTotal — a config edit that REMOVES a clinch", () => {
  it("raising an unplayed game's total un-clinches the leader", async () => {
    const { compId, winner, loser, games } = await seedThreeGameCup();
    await finish(games[0], winner, loser);
    await finish(games[1], winner, loser); // clinched: available=3, winner=2
    expect(await stored(compId)).toBe(winner);

    // Raise the THIRD (unplayed) game from 1 to 5: available becomes
    // 1+1+5=7, winThreshold(7)=4. Winner's total (2) no longer clears it.
    await ctx.caller().games.setPointsTotal({ tripId, gameId: games[2], total: 5 });
    expect(await stored(compId), "raising the total un-clinched the leader — released").toBeNull();
  }, 60_000);

  it("is reachable on an already-complete game — no status guard", async () => {
    // Confirms the item-4 Phase 0 finding this fix depends on: without this,
    // the scenario above (raising a total post-finalize) couldn't happen at all.
    const { winner, loser, games } = await seedThreeGameCup();
    await finish(games[0], winner, loser);
    const before = (await ctx.caller().games.getById({ tripId, gameId: games[0] })) as { status: string };
    expect(before.status, "the game is genuinely complete before the edit").toBe("complete");

    await expect(
      ctx.caller().games.setPointsTotal({ tripId, gameId: games[0], total: 9 })
    ).resolves.toBeTruthy();

    const after = (await ctx.caller().games.getById({ tripId, gameId: games[0] })) as {
      status: string;
      points_total: number;
    };
    expect(after.status, "status is untouched by the edit — no guard fired, none reverted it").toBe("complete");
    expect(after.points_total, "the edit actually landed").toBe(9);
  }, 60_000);
});

describe("games.setPointsDistribution — redistributing a FIXED total moves the leader", () => {
  it("a split change can un-clinch without a re-finish, and without changing pointsAvailable", async () => {
    const compId = await ctx.createCompetition(tripId, "Split Cup", { scoringModel: "points" });
    const a = await ctx.createTeam(compId, "A", { shortName: "A" });
    const b = await ctx.createTeam(compId, "B", { shortName: "B", color: "#ef4444", colorDim: "#2a0a0a" });
    // ONE game worth 3, split [3,0] — winner-take-all.
    const g = (await ctx.caller().games.create({
      tripId, gameTypeId: MANUAL, name: "Split game", competitionId: compId,
      pointsDistribution: { type: "placement", values: [3] }, pointsTotal: 3,
    })) as { id: string };
    await ctx.caller().games.finish({
      tripId, gameId: g.id,
      placements: [{ entityId: a, position: 1 }, { entityId: b, position: 2 }],
    });
    // available=3, winNumber=2, A has 3 (all of it) — clinched.
    expect(await stored(compId)).toBe(a);

    // Re-split the SAME fixed total to [1,2]: A's share drops to 1, B's rises
    // to 2 — pointsAvailable is UNCHANGED (still 3, still one game), only the
    // AWARD moves. `position` is all `game_results` stores; `placementPoints`
    // applies whatever distribution is CURRENT at read time — so this takes
    // effect on the very next recompute, no re-finish needed. If it needed one,
    // `setPointsDistribution`'s own wired reconcile (which runs immediately
    // after the write, before any re-finish could happen) would be checking
    // stale points and this assertion would catch that regression.
    await ctx.caller().games.setPointsDistribution({
      tripId, gameId: g.id, distribution: { type: "placement", values: [1, 2] },
    });
    expect(await stored(compId), "A dropped to 1 of 3 — below winNumber 2 — released").toBeNull();

    const board = (await ctx.caller().competitions.leaderboard({ tripId, competitionId: compId })) as {
      pointsAvailable: number;
      teamTotals: Record<string, number>;
    };
    expect(board.pointsAvailable, "the total in play never moved — only the split did").toBe(3);
    expect(board.teamTotals[a]).toBe(1);
    expect(board.teamTotals[b]).toBe(2);
  }, 60_000);
});

describe("teams.delete — a manual (non-golf) competition, where the roster lock doesn't block", () => {
  it("competitionHasScore (score_entries) is false for a manual competition, so the lock doesn't fire", async () => {
    const { compId, winner, loser, games } = await seedThreeGameCup();
    await finish(games[0], winner, loser);
    await finish(games[1], winner, loser);
    expect(await stored(compId)).toBe(winner);

    // The roster lock is gated on score_entries specifically; manual games
    // never write there, so this competition — fully decided — is unlocked.
    const { competitionHasScore } = await import("../lib/rosterLock");
    expect(await competitionHasScore(ctx.admin, compId)).toBe(false);

    // Deleting the CLINCHING team removes it from `teams` entirely — the
    // recompute no longer has an entry for it, so it reads as un-decided and
    // the stale announcement is released.
    await ctx.caller().teams.delete({ tripId, teamId: winner });
    expect(await stored(compId), "the announced team no longer exists — released").toBeNull();
  }, 60_000);
});

describe("competitions.resetScoring — the whole-competition primitive", () => {
  it("clears every game's results at once; points survive, so it can only release", async () => {
    const { compId, winner, loser, games } = await seedThreeGameCup();
    await finish(games[0], winner, loser);
    await finish(games[1], winner, loser);
    expect(await stored(compId)).toBe(winner);

    await ctx.caller().competitions.resetScoring({ tripId, competitionId: compId });
    expect(await stored(compId), "everyone reset to zero — released").toBeNull();

    await finish(games[0], winner, loser);
    await finish(games[1], winner, loser);
    expect(await stored(compId), "re-clinches for the same team after re-scoring").toBe(winner);
  }, 60_000);
});

describe("competitions.resetToSkeleton — the whole-competition superset", () => {
  it("also releases a stale claim", async () => {
    const { compId, winner, loser, games } = await seedThreeGameCup();
    await finish(games[0], winner, loser);
    await finish(games[1], winner, loser);
    expect(await stored(compId)).toBe(winner);

    await ctx.caller().competitions.resetToSkeleton({ tripId, competitionId: compId });
    expect(await stored(compId), "released").toBeNull();
  }, 60_000);
});

describe("no retroactive fire on deploy", () => {
  it("a competition with no held claim is untouched by reconciling — nothing to release means nothing changes", async () => {
    const { compId } = await seedThreeGameCup();
    expect(await stored(compId)).toBeNull();
    await ctx.caller().competitions.resetScoring({ tripId, competitionId: compId });
    expect(await stored(compId)).toBeNull();
  }, 60_000);
});
