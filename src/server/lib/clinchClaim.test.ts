import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";
import { claimClinchNotification } from "./gameFinishNotify";

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
    await expect(claimClinchNotification(ctx.admin, competitionId, teamA)).resolves.toBe(true);
    expect(await storedTeam()).toBe(teamA);
  });

  it("a second claim for the SAME team loses — one push per clinch, not one per finalize", async () => {
    // This is the guard that makes "finish another game and confirm no second
    // clinch push" hold: the clinch check runs on every finalize by design.
    await expect(claimClinchNotification(ctx.admin, competitionId, teamA)).resolves.toBe(false);
    expect(await storedTeam()).toBe(teamA);
  });

  it("repeated claims for the same team keep losing (idempotent, not alternating)", async () => {
    for (let i = 0; i < 3; i++) {
      expect(await claimClinchNotification(ctx.admin, competitionId, teamA)).toBe(false);
    }
    expect(await storedTeam()).toBe(teamA);
  });

  it("a DIFFERENT team clinching wins — an un-clinch then a new decision IS news", async () => {
    // The score-correction path: a correction flips the leader, the cup is
    // decided the other way. Clinch state itself is derived and never stored, so
    // nothing migrates; only the announcement bookkeeping moves.
    await expect(claimClinchNotification(ctx.admin, competitionId, teamB)).resolves.toBe(true);
    expect(await storedTeam()).toBe(teamB);
  });

  it("…and the ORIGINAL team can then win again if the cup swings back", async () => {
    await expect(claimClinchNotification(ctx.admin, competitionId, teamA)).resolves.toBe(true);
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
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await storedTeam()).toBe(teamB);
  });

  it("a claim against an unknown competition is a loss, not a throw", async () => {
    await expect(
      claimClinchNotification(ctx.admin, genId("no-such-comp"), teamA)
    ).resolves.toBe(false);
  });
});
