import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";
import { claimClinchNotification, releaseClinchClaim } from "./gameFinishNotify";

/**
 * DB-backed test for the clinch-notification claim (migration 099).
 *
 * This runs against a real Postgres deliberately. The claim's whole correctness
 * rests on one PostgREST filter expressing SQL's `IS DISTINCT FROM`, and a
 * hand-rolled stub would accept a filter that means something else entirely —
 * the exact failure this is here to catch is `.neq()` alone, which matches
 * NOTHING while the column is still NULL. That is the state every first clinch
 * starts in, so the bug would be silent and would suppress the highest-value
 * push in the app rather than duplicate it.
 */

let ctx: TestContext;

// ONE context for the whole file (#1516). Each describe used to rely on the
// first describe's context, and that describe's own afterAll cleaned it up
// BEFORE the next describe created its trip on it — so that trip was never
// deleted and leaked into the local database on every run.
beforeAll(async () => {
  ctx = await TestContext.create();
});

afterAll(async () => {
  await ctx.cleanup();
});

/**
 * EVERY CASE BUILDS ITS OWN CUP (#1527). Both describes used to walk one cup's
 * `clinch_notified_team_id` through a sequence, each case asserting on what the
 * case before had left — "STILL suppresses a same-team re-claim" even opened by
 * asserting the previous case's claim was there. Shuffled, the first-claim case
 * met a held column and the swing-back case met an Alpha that was never
 * displaced. Each case now starts unclaimed and makes the claims its premise
 * needs through the function under test.
 */
type Cup = { compId: string; teamA: string; teamB: string };

async function freshCup(label: string): Promise<Cup> {
  const tripId = await ctx.createTrip(`Clinch Claim ${label}`);
  // Sequential, never Promise.all — these can race and flake (CLAUDE.md).
  const compId = await ctx.createCompetition(tripId, `Claim Cup ${label}`);
  const teamA = await ctx.createTeam(compId, "Alpha");
  const teamB = await ctx.createTeam(compId, "Bravo");
  return { compId, teamA, teamB };
}

async function storedTeam(compId: string): Promise<string | null> {
  const { data, error } = await ctx.admin
    .from("competitions")
    .select("clinch_notified_team_id")
    .eq("id", compId)
    .single();
  if (error) throw new Error(`read claim: ${error.message}`);
  return (data?.clinch_notified_team_id as string | null) ?? null;
}

describe("claimClinchNotification — exactly-once, and the un-clinch rule", () => {
  it("the FIRST claim wins from a NULL column — the case a bare .neq() would silently lose", async () => {
    const { compId, teamA } = await freshCup("first");
    expect(await storedTeam(compId)).toBeNull();
    await expect(claimClinchNotification(ctx.admin, compId, teamA)).resolves.toEqual({
      outcome: "claimed",
    });
    expect(await storedTeam(compId)).toBe(teamA);
  });

  it("a second claim for the SAME team loses — one push per clinch, not one per finalize", async () => {
    // This is the guard that makes "finish another game and confirm no second
    // clinch push" hold: the clinch check runs on every finalize by design.
    // VERIFIED suppression, not merely a falsy return: the result names the team
    // the column actually holds, so a FAILING write can no longer reach this
    // shape — which is what it did in production for six weeks.
    const { compId, teamA } = await freshCup("second-same");
    expect(await claimClinchNotification(ctx.admin, compId, teamA)).toEqual({ outcome: "claimed" });
    await expect(claimClinchNotification(ctx.admin, compId, teamA)).resolves.toEqual({
      outcome: "already_claimed",
      heldBy: teamA,
    });
    expect(await storedTeam(compId)).toBe(teamA);
  });

  it("repeated claims for the same team keep losing (idempotent, not alternating)", async () => {
    const { compId, teamA } = await freshCup("repeated");
    expect(await claimClinchNotification(ctx.admin, compId, teamA)).toEqual({ outcome: "claimed" });
    for (let i = 0; i < 3; i++) {
      expect(await claimClinchNotification(ctx.admin, compId, teamA)).toEqual({
        outcome: "already_claimed",
        heldBy: teamA,
      });
    }
    expect(await storedTeam(compId)).toBe(teamA);
  });

  it("a DIFFERENT team clinching wins — an un-clinch then a new decision IS news", async () => {
    // The score-correction path: a correction flips the leader, the cup is
    // decided the other way. Clinch state itself is derived and never stored, so
    // nothing migrates; only the announcement bookkeeping moves.
    const { compId, teamA, teamB } = await freshCup("different");
    expect(await claimClinchNotification(ctx.admin, compId, teamA)).toEqual({ outcome: "claimed" });
    await expect(claimClinchNotification(ctx.admin, compId, teamB)).resolves.toEqual({
      outcome: "claimed",
    });
    expect(await storedTeam(compId)).toBe(teamB);
  });

  it("…and the ORIGINAL team can then win again if the cup swings back", async () => {
    const { compId, teamA, teamB } = await freshCup("swing-back");
    expect(await claimClinchNotification(ctx.admin, compId, teamA)).toEqual({ outcome: "claimed" });
    expect(await claimClinchNotification(ctx.admin, compId, teamB)).toEqual({ outcome: "claimed" });
    expect(await storedTeam(compId)).toBe(teamB); // premise: Bravo displaced Alpha
    await expect(claimClinchNotification(ctx.admin, compId, teamA)).resolves.toEqual({
      outcome: "claimed",
    });
    expect(await storedTeam(compId)).toBe(teamA);
  });

  it("concurrent claims for the same team produce exactly ONE winner", async () => {
    // The race the column exists to settle: two organizers finishing two
    // different games at the same moment, both observing the same clincher.
    const { compId, teamB } = await freshCup("concurrent");
    expect(await storedTeam(compId)).toBeNull(); // premise: everyone races from NULL

    const results = await Promise.all(
      Array.from({ length: 5 }, () => claimClinchNotification(ctx.admin, compId, teamB))
    );
    // NOT `.filter(Boolean)` — every result is an object now and therefore
    // truthy, so the old form would have passed with five winners. Count the
    // winning OUTCOME, and assert the four losers are VERIFIED suppression
    // rather than four silent failures wearing the same shape.
    expect(results.filter((r) => r.outcome === "claimed")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "already_claimed")).toHaveLength(4);
    expect(await storedTeam(compId)).toBe(teamB);
  });

  it("a claim against an unknown competition is a loss, not a throw", async () => {
    // Distinguishable from suppression now: nothing holds the claim, so this is
    // the unexplained-zero-rows shape — which is also the PRODUCTION signature
    // (a real competition, a null column, and a write that matched no row).
    // Before the split, this and correct suppression were the same `false`.
    const { teamA } = await freshCup("unknown");
    await expect(
      claimClinchNotification(ctx.admin, genId("no-such-comp"), teamA)
    ).resolves.toEqual({ outcome: "claim_no_row", heldNow: null });
  });

  /**
   * A REFUSED write is its own outcome, and it carries the message and code.
   *
   * Stubbed deliberately, and it is the one case that should be: every other
   * test here runs against real Postgres because the PostgREST FILTER is what
   * they verify, and a stub would accept a filter meaning something else. This
   * one verifies the opposite thing — that an error the database returns is
   * PROPAGATED rather than flattened — and the local stack cannot be made to
   * refuse a write that it correctly permits.
   *
   * Which is exactly the gap: in production this write has never once succeeded
   * across 41 competitions while passing every test above, and the old boolean
   * return reported each failure as correct suppression.
   */
  it("a REFUSED write returns claim_error carrying the message and code", async () => {
    const stub = {
      rpc: async () => ({
        data: null,
        error: { message: "permission denied for table competitions", code: "42501" },
      }),
    };

    await expect(
      claimClinchNotification(
        stub as unknown as Parameters<typeof claimClinchNotification>[0],
        genId("stub-comp"),
        genId("stub-team")
      )
    ).resolves.toEqual({
      outcome: "claim_error",
      message: "permission denied for table competitions",
      code: "42501",
    });
  });

  it("an error with no code still reports claim_error rather than degrading to a loss", async () => {
    const stub = { rpc: async () => ({ data: null, error: { message: "network reset" } }) };

    await expect(
      claimClinchNotification(
        stub as unknown as Parameters<typeof claimClinchNotification>[0],
        genId("stub-comp"),
        genId("stub-team")
      )
    ).resolves.toEqual({ outcome: "claim_error", message: "network reset", code: null });
  });
});

/**
 * Releasing the claim — the half the column never had.
 *
 * `clinch_notified_team_id` only ever moved null → team, so "un-clinched" was
 * not a state it could express. A cup clinched, the push fired, a correction
 * un-clinched it, the SAME team re-clinched — and the push was suppressed as
 * already-announced. The crew never learned the cup was decided.
 */
describe("releaseClinchClaim — restoring eligibility after an un-clinch", () => {
  /**
   * These cases assert only "did the claim win" — the outcome SHAPES are pinned
   * in the suite above, and repeating them here would obscure the sequence each
   * of these tests exists to describe.
   */
  async function claimWon(comp: string, team: string): Promise<boolean> {
    const r = await claimClinchNotification(ctx.admin, comp, team);
    return r.outcome === "claimed";
  }

  it("releases a claim it still holds", async () => {
    const { compId, teamA } = await freshCup("release-held");
    expect(await claimWon(compId, teamA)).toBe(true);
    await expect(releaseClinchClaim(ctx.admin, compId, teamA)).resolves.toBe(true);
    expect(await storedTeam(compId)).toBeNull();
  });

  /**
   * THE REPORTED BUG, end to end. Before the release existed, step 4 returned
   * false and the second clinch went unannounced.
   */
  it("clinch → un-clinch → the SAME team re-clinches → the push is eligible again", async () => {
    const { compId, teamA } = await freshCup("reclinch");
    expect(await claimWon(compId, teamA)).toBe(true); // 1. clinched, announced
    await releaseClinchClaim(ctx.admin, compId, teamA); //                         2. correction un-clinched it
    expect(await storedTeam(compId)).toBeNull(); //                                3. eligibility restored
    expect(await claimWon(compId, teamA)).toBe(true); // 4. re-clinch DOES announce
    expect(await storedTeam(compId)).toBe(teamA);
  });

  it("STILL suppresses a same-team re-claim with no un-clinch in between", async () => {
    // The original product rule, unchanged: one push per clinch, not one per
    // finalize. Only an intervening release makes it news again.
    const { compId, teamA } = await freshCup("no-release");
    expect(await claimWon(compId, teamA)).toBe(true);
    expect(await storedTeam(compId)).toBe(teamA);
    expect(await claimWon(compId, teamA)).toBe(false);
  });

  /**
   * THE RACE the compare-and-swap exists for.
   *
   * A recomputes and sees no clincher; concurrently B sees clincher Bravo,
   * claims it and pushes. A blind `SET null` would then wipe B's claim, and the
   * next finalize that still sees Bravo would push a SECOND time for one clinch
   * — reintroducing exactly what migration 099 prevents. A's release is
   * conditional on the value A observed, so it must lose.
   */
  it("a release racing a NEW claim must not wipe it — exactly-once survives", async () => {
    const { compId, teamA, teamB } = await freshCup("race");
    expect(await claimWon(compId, teamA)).toBe(true);

    // A observed Alpha, then B claims Bravo before A's release lands.
    const observedByA = teamA;
    expect(await claimWon(compId, teamB)).toBe(true);

    await expect(releaseClinchClaim(ctx.admin, compId, observedByA)).resolves.toBe(false);
    expect(await storedTeam(compId), "B's claim survives A's stale release").toBe(teamB);
  });

  it("releasing a claim nobody holds is a no-op, not a throw", async () => {
    const { compId, teamA } = await freshCup("nobody");
    expect(await storedTeam(compId)).toBeNull(); // premise: nobody holds it
    await expect(releaseClinchClaim(ctx.admin, compId, teamA)).resolves.toBe(false);
    expect(await storedTeam(compId)).toBeNull();
  });

  it("concurrent releases produce exactly one winner (no double-clear surprises)", async () => {
    const { compId, teamB } = await freshCup("concurrent-release");
    expect(await claimWon(compId, teamB)).toBe(true);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => releaseClinchClaim(ctx.admin, compId, teamB))
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await storedTeam(compId)).toBeNull();
  });

  it("a release against an unknown competition is a loss, not a throw", async () => {
    const { teamA } = await freshCup("release-unknown");
    await expect(releaseClinchClaim(ctx.admin, genId("no-such-comp"), teamA)).resolves.toBe(false);
  });
});
