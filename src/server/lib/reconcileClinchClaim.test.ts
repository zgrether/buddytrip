import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";
import { claimClinchNotification, reconcileClinchClaim, releaseClinchClaim } from "./gameFinishNotify";

/**
 * `reconcileClinchClaim` — the release half of the un-clinching paths #839's
 * finalize-only release doesn't reach: `games.delete`, both reset primitives
 * (game- and competition-scoped), `teams.delete`, and a point-value config edit
 * (`setPointsTotal`/`setPointsDistribution`).
 *
 * This file drives the HELPER directly against real result-row mutations that
 * stand in for what those procedures do to `game_results` (delete a row / clear
 * a row / change a total) — it is not testing the procedures themselves (that's
 * `clinchReconcileCallSites.test.ts`), it is pinning the DECISION LOGIC: given a
 * held claim and a recomputed board, does it release, and does it do so safely
 * under concurrency.
 */

let ctx: TestContext;
let tripId: string;
let compId: string;
let winner: string;
let loser: string;
const gameIds: string[] = [];

async function seedGame(name: string, first: string, second: string, total = 1) {
  const id = crypto.randomUUID();
  const g = await ctx.admin.from("games").insert({
    id, trip_id: tripId, competition_id: compId, game_type_id: "gtt_generic_yard",
    name, status: "complete", scoring_enabled: true,
    points_total: total, points_distribution: { type: "placement", values: [total] },
  });
  if (g.error) throw new Error(`seed game ${name}: ${g.error.message}`);
  gameIds.push(id);
  const r = await ctx.admin.from("game_results").insert([
    { id: crypto.randomUUID(), game_id: id, entity_id: first, entity_type: "team", position: 1, raw_score: 1 },
    { id: crypto.randomUUID(), game_id: id, entity_id: second, entity_type: "team", position: 2, raw_score: 2 },
  ]);
  if (r.error) throw new Error(`seed results ${name}: ${r.error.message}`);
  return id;
}

async function stored(): Promise<string | null> {
  const { data } = await ctx.admin
    .from("competitions")
    .select("clinch_notified_team_id")
    .eq("id", compId)
    .maybeSingle();
  return (data?.clinch_notified_team_id as string | null) ?? null;
}

/** Reset to a clean 3-game, winner-clinched shape for each scenario. */
async function reseed() {
  if (gameIds.length) {
    await ctx.admin.from("game_results").delete().in("game_id", gameIds);
    await ctx.admin.from("games").delete().in("id", gameIds);
    gameIds.length = 0;
  }
  await ctx.admin.from("competitions").update({ clinch_notified_team_id: null }).eq("id", compId);
  await seedGame("g1", winner, loser);
  await seedGame("g2", winner, loser);
  await seedGame("g3", loser, winner);
  // available 3, winNumber 2, winner on 2 — decided.
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Reconcile Trip");
  compId = await ctx.createCompetition(tripId, "Reconcile Cup", { scoringModel: "points" });
  winner = await ctx.createTeam(compId, "Winner", { shortName: "WIN" });
  loser = await ctx.createTeam(compId, "Loser", { shortName: "LOS", color: "#ef4444", colorDim: "#2a0a0a" });
}, 120_000);

afterAll(async () => {
  if (gameIds.length) {
    await ctx.admin.from("game_results").delete().in("game_id", gameIds);
    await ctx.admin.from("games").delete().in("id", gameIds);
  }
  await ctx.cleanup();
}, 60_000);

describe("reconcileClinchClaim — the held team is still decided", () => {
  it("leaves the claim untouched", async () => {
    await reseed();
    await claimClinchNotification(ctx.admin, compId, winner);
    expect(await stored()).toBe(winner);

    await reconcileClinchClaim(compId, ctx.admin);
    expect(await stored(), "still clinched by the same team — nothing to reconcile").toBe(winner);
  });
});

describe("reconcileClinchClaim — the held team is no longer decided", () => {
  it("releases when a game is REMOVED (stands in for games.delete)", async () => {
    await reseed();
    await claimClinchNotification(ctx.admin, compId, winner);

    // Remove one of winner's wins — total drops to 1, still ahead of loser's 1
    // but... wait, need it to actually undecide. Delete BOTH remaining wins is
    // too strong; delete results for g1 only: winner now has 1, loser 1 — tied,
    // available still 3 (games remain, only results cleared) so winNumber stays
    // 2 and NEITHER team is at 2 — genuinely undecided.
    await ctx.admin.from("game_results").delete().eq("game_id", gameIds[0]);

    await reconcileClinchClaim(compId, ctx.admin);
    expect(await stored(), "no longer decided — released").toBeNull();
  });

  it("releases when the claim's own points DROP (stands in for a reset)", async () => {
    await reseed();
    await claimClinchNotification(ctx.admin, compId, winner);

    // A reset clears results but keeps points_total/config — model that by
    // deleting ALL result rows while leaving the games (and their totals) intact.
    await ctx.admin.from("game_results").delete().in("game_id", gameIds);

    await reconcileClinchClaim(compId, ctx.admin);
    expect(await stored(), "totals reset to zero — undecided, released").toBeNull();
  });

  it("releases when a DIFFERENT team becomes decided (stands in for a config edit)", async () => {
    await reseed();
    await claimClinchNotification(ctx.admin, compId, winner);

    // Flip g1 and g2 to loser instead — loser now has the 2, winner has 1.
    await ctx.admin.from("game_results").update({ entity_id: loser }).eq("game_id", gameIds[0]).eq("entity_id", winner);
    await ctx.admin.from("game_results").update({ entity_id: winner }).eq("game_id", gameIds[0]).eq("entity_id", loser);
    await ctx.admin.from("game_results").update({ entity_id: loser }).eq("game_id", gameIds[1]).eq("entity_id", winner);
    await ctx.admin.from("game_results").update({ entity_id: winner }).eq("game_id", gameIds[1]).eq("entity_id", loser);

    await reconcileClinchClaim(compId, ctx.admin);
    // The claim named WINNER, and winner is no longer decided (loser is, now) —
    // release. This function never claims the new team; that stays unaddressed
    // (a separate, larger gap) and the assertion below confirms it doesn't creep
    // in silently.
    expect(await stored(), "the stale claim is released, but nothing is claimed for the new leader").toBeNull();
  });

  it("does nothing when no claim is held", async () => {
    await reseed();
    expect(await stored()).toBeNull();
    await reconcileClinchClaim(compId, ctx.admin);
    expect(await stored()).toBeNull();
  });

  it("against an unknown competition: no throw", async () => {
    await expect(reconcileClinchClaim(genId("no-such-comp"), ctx.admin)).resolves.toBeUndefined();
  });
});

/**
 * THE RACE — the reason `reconcileClinchClaim` calls `releaseClinchClaim`
 * rather than doing its own `UPDATE … SET clinch_notified_team_id = null`.
 *
 * `reconcileClinchClaim` is two steps: read `held`, then (if no longer decided)
 * release exactly that value. Between those steps, another request can claim a
 * FRESH clinch — a real finalize, running concurrently with a delete/reset that
 * happens to un-clinch the OLD claim at nearly the same moment. The release must
 * not wipe that fresh claim; it is acting on a read that is already stale by the
 * time its write lands.
 *
 * `reconcileClinchClaim` is a single function call from the test's side, so its
 * own internal read-then-write can't be paused mid-flight without mocking. This
 * reconstructs the exact two-step shape deterministically instead: capture
 * `held` the same way `reconcileClinchClaim` does (a direct read), let a
 * concurrent claim land, then perform the SAME release call
 * `reconcileClinchClaim` would have made with that now-stale value. This is not
 * a different code path — `releaseClinchClaim` IS the call
 * `reconcileClinchClaim` makes; the CAS living there is the whole reason no
 * call site (this one included) needs its own concurrency handling.
 */
describe("reconcileClinchClaim — the internal release is a CAS, so a stale one loses", () => {
  it("a release using a stale `held` value cannot wipe a fresh concurrent claim", async () => {
    await reseed();
    await claimClinchNotification(ctx.admin, compId, winner);

    // Step 1 of reconcileClinchClaim, replicated: read what it would read.
    const heldAtReadTime = await stored();
    expect(heldAtReadTime).toBe(winner);

    // Concurrently: winner's game is deleted (as `games.delete` would do), AND
    // — before the stale release below executes — a genuine finalize decides
    // the cup for loser instead and claims it for real.
    await ctx.admin.from("game_results").delete().in("game_id", gameIds);
    expect(await claimClinchNotification(ctx.admin, compId, loser)).toBe(true);
    expect(await stored()).toBe(loser);

    // Step 2 of reconcileClinchClaim, replicated: release using the value read
    // in step 1 — which is now stale. A blind `SET null` here would succeed and
    // wipe loser's real claim; the CAS must refuse instead.
    const released = await releaseClinchClaim(ctx.admin, compId, heldAtReadTime!);
    expect(released, "the stale release must fail, not merely no-op quietly").toBe(false);
    expect(await stored(), "loser's fresh, real claim survives").toBe(loser);
  });
});
