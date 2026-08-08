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
let tripId: string;
let competitionId: string;
let teamA: string;
let teamB: string;

describe("claimClinchNotification — exactly-once, and the un-clinch rule", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Clinch Claim Trip");
    // Sequential, never Promise.all — these can race and flake (CLAUDE.md).
    competitionId = await ctx.createCompetition(tripId, "Claim Cup");
    teamA = await ctx.createTeam(competitionId, "Alpha");
    teamB = await ctx.createTeam(competitionId, "Bravo");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  async function storedTeam(): Promise<string | null> {
    const { data } = await ctx.admin
      .from("competitions")
      .select("clinch_notified_team_id")
      .eq("id", competitionId)
      .maybeSingle();
    return (data?.clinch_notified_team_id as string | null) ?? null;
  }

  it("the FIRST claim wins from a NULL column — the case a bare .neq() would silently lose", async () => {
    expect(await storedTeam()).toBeNull();
    await expect(claimClinchNotification(ctx.admin, competitionId, teamA)).resolves.toEqual({
      outcome: "claimed",
    });
    expect(await storedTeam()).toBe(teamA);
  });

  it("a second claim for the SAME team loses — one push per clinch, not one per finalize", async () => {
    // This is the guard that makes "finish another game and confirm no second
    // clinch push" hold: the clinch check runs on every finalize by design.
    // VERIFIED suppression, not merely a falsy return: the result names the team
    // the column actually holds, so a FAILING write can no longer reach this
    // shape — which is what it did in production for six weeks.
    await expect(claimClinchNotification(ctx.admin, competitionId, teamA)).resolves.toEqual({
      outcome: "already_claimed",
      heldBy: teamA,
    });
    expect(await storedTeam()).toBe(teamA);
  });

  it("repeated claims for the same team keep losing (idempotent, not alternating)", async () => {
    for (let i = 0; i < 3; i++) {
      expect(await claimClinchNotification(ctx.admin, competitionId, teamA)).toEqual({
        outcome: "already_claimed",
        heldBy: teamA,
      });
    }
    expect(await storedTeam()).toBe(teamA);
  });

  it("a DIFFERENT team clinching wins — an un-clinch then a new decision IS news", async () => {
    // The score-correction path: a correction flips the leader, the cup is
    // decided the other way. Clinch state itself is derived and never stored, so
    // nothing migrates; only the announcement bookkeeping moves.
    await expect(claimClinchNotification(ctx.admin, competitionId, teamB)).resolves.toEqual({
      outcome: "claimed",
    });
    expect(await storedTeam()).toBe(teamB);
  });

  it("…and the ORIGINAL team can then win again if the cup swings back", async () => {
    await expect(claimClinchNotification(ctx.admin, competitionId, teamA)).resolves.toEqual({
      outcome: "claimed",
    });
    expect(await storedTeam()).toBe(teamA);
  });

  it("concurrent claims for the same team produce exactly ONE winner", async () => {
    // The race the column exists to settle: two organizers finishing two
    // different games at the same moment, both observing the same clincher.
    await ctx.admin
      .from("competitions")
      .update({ clinch_notified_team_id: null })
      .eq("id", competitionId);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => claimClinchNotification(ctx.admin, competitionId, teamB))
    );
    // NOT `.filter(Boolean)` — every result is an object now and therefore
    // truthy, so the old form would have passed with five winners. Count the
    // winning OUTCOME, and assert the four losers are VERIFIED suppression
    // rather than four silent failures wearing the same shape.
    expect(results.filter((r) => r.outcome === "claimed")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "already_claimed")).toHaveLength(4);
    expect(await storedTeam()).toBe(teamB);
  });

  it("a claim against an unknown competition is a loss, not a throw", async () => {
    // Distinguishable from suppression now: nothing holds the claim, so this is
    // the unexplained-zero-rows shape — which is also the PRODUCTION signature
    // (a real competition, a null column, and a write that matched no row).
    // Before the split, this and correct suppression were the same `false`.
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
    const chain: Record<string, unknown> = {};
    for (const m of ["from", "update", "eq", "or", "select"]) chain[m] = () => chain;
    chain.then = (ok: (v: unknown) => void) =>
      ok({ data: null, error: { message: "permission denied for table competitions", code: "42501" } });

    await expect(
      claimClinchNotification(
        chain as unknown as Parameters<typeof claimClinchNotification>[0],
        competitionId,
        teamA
      )
    ).resolves.toEqual({
      outcome: "claim_error",
      message: "permission denied for table competitions",
      code: "42501",
    });
  });

  it("an error with no code still reports claim_error rather than degrading to a loss", async () => {
    const chain: Record<string, unknown> = {};
    for (const m of ["from", "update", "eq", "or", "select"]) chain[m] = () => chain;
    chain.then = (ok: (v: unknown) => void) => ok({ data: null, error: { message: "network reset" } });

    await expect(
      claimClinchNotification(
        chain as unknown as Parameters<typeof claimClinchNotification>[0],
        competitionId,
        teamA
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
  let rTrip: string;
  let rComp: string;
  let rTeamA: string;
  let rTeamB: string;

  beforeAll(async () => {
    rTrip = await ctx.createTrip("Clinch Release Trip");
    rComp = await ctx.createCompetition(rTrip, "Release Cup");
    rTeamA = await ctx.createTeam(rComp, "Alpha");
    rTeamB = await ctx.createTeam(rComp, "Bravo");
  });

  /**
   * These cases assert only "did the claim win" — the outcome SHAPES are pinned
   * in the suite above, and repeating them here would obscure the sequence each
   * of these tests exists to describe.
   */
  async function claimWon(comp: string, team: string): Promise<boolean> {
    const r = await claimClinchNotification(ctx.admin, comp, team);
    return r.outcome === "claimed";
  }

  async function stored(): Promise<string | null> {
    const { data } = await ctx.admin
      .from("competitions")
      .select("clinch_notified_team_id")
      .eq("id", rComp)
      .maybeSingle();
    return (data?.clinch_notified_team_id as string | null) ?? null;
  }

  it("releases a claim it still holds", async () => {
    expect(await claimWon(rComp, rTeamA)).toBe(true);
    await expect(releaseClinchClaim(ctx.admin, rComp, rTeamA)).resolves.toBe(true);
    expect(await stored()).toBeNull();
  });

  /**
   * THE REPORTED BUG, end to end. Before the release existed, step 4 returned
   * false and the second clinch went unannounced.
   */
  it("clinch → un-clinch → the SAME team re-clinches → the push is eligible again", async () => {
    expect(await claimWon(rComp, rTeamA)).toBe(true); // 1. clinched, announced
    await releaseClinchClaim(ctx.admin, rComp, rTeamA); //                         2. correction un-clinched it
    expect(await stored()).toBeNull(); //                                          3. eligibility restored
    expect(await claimWon(rComp, rTeamA)).toBe(true); // 4. re-clinch DOES announce
    expect(await stored()).toBe(rTeamA);
  });

  it("STILL suppresses a same-team re-claim with no un-clinch in between", async () => {
    // The original product rule, unchanged: one push per clinch, not one per
    // finalize. Only an intervening release makes it news again.
    expect(await stored()).toBe(rTeamA);
    expect(await claimWon(rComp, rTeamA)).toBe(false);
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
    await ctx.admin.from("competitions").update({ clinch_notified_team_id: null }).eq("id", rComp);
    expect(await claimWon(rComp, rTeamA)).toBe(true);

    // A observed Alpha, then B claims Bravo before A's release lands.
    const observedByA = rTeamA;
    expect(await claimWon(rComp, rTeamB)).toBe(true);

    await expect(releaseClinchClaim(ctx.admin, rComp, observedByA)).resolves.toBe(false);
    expect(await stored(), "B's claim survives A's stale release").toBe(rTeamB);
  });

  it("releasing a claim nobody holds is a no-op, not a throw", async () => {
    await ctx.admin.from("competitions").update({ clinch_notified_team_id: null }).eq("id", rComp);
    await expect(releaseClinchClaim(ctx.admin, rComp, rTeamA)).resolves.toBe(false);
    expect(await stored()).toBeNull();
  });

  it("concurrent releases produce exactly one winner (no double-clear surprises)", async () => {
    expect(await claimWon(rComp, rTeamB)).toBe(true);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => releaseClinchClaim(ctx.admin, rComp, rTeamB))
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await stored()).toBeNull();
  });

  it("a release against an unknown competition is a loss, not a throw", async () => {
    await expect(releaseClinchClaim(ctx.admin, genId("no-such-comp"), rTeamA)).resolves.toBe(false);
  });
});
