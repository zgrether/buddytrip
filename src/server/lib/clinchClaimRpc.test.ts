import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * Migration 107 — the clinch CAS, done in Postgres.
 *
 * These assertions are the SAME set `clinchClaim.test.ts` holds against the
 * PostgREST version of the claim, deliberately: the point of moving the CAS
 * into SQL is that the guarantees don't change, only where they're enforced.
 *
 * ── Why they moved ──────────────────────────────────────────────────────────
 * The PostgREST form carried its CAS predicate as an `or=(…)` filter. On the
 * deployed PostgREST that filter is applied to the RETURNING projection rather
 * than the UPDATE's WHERE, which cannot work: after
 * `SET clinch_notified_team_id = teamId` the row no longer satisfies
 * `IS NULL OR <> teamId`, so the projection filters out the row it just wrote.
 * The write landed and reported itself lost — observed in production as a fresh
 * claim on the row alongside an `already_claimed` outcome and no push.
 *
 * A compare-and-swap is falsified BY THE WRITE IT GUARDS, so it cannot be
 * expressed as a post-image filter at all.
 *
 * Local PostgREST 14.5 applied the same filter pre-image, so every test passed
 * while production never once worked. That version-dependence is the reason
 * these functions exist, and the reason this file tests the DB objects directly
 * rather than through the client.
 */

let ctx: TestContext;
let tripId: string;
let compId: string;
let teamA: string;
let teamB: string;

const claim = async (team: string, comp = compId): Promise<boolean> => {
  const { data, error } = await ctx.admin.rpc("claim_clinch_notification", {
    p_competition_id: comp,
    p_team_id: team,
  });
  if (error) throw new Error(`claim: ${error.message}`);
  return data as boolean;
};

const release = async (expected: string, comp = compId): Promise<boolean> => {
  const { data, error } = await ctx.admin.rpc("release_clinch_claim", {
    p_competition_id: comp,
    p_expected_team_id: expected,
  });
  if (error) throw new Error(`release: ${error.message}`);
  return data as boolean;
};

const held = async (): Promise<string | null> => {
  const { data } = await ctx.admin
    .from("competitions")
    .select("clinch_notified_team_id")
    .eq("id", compId)
    .maybeSingle();
  return (data?.clinch_notified_team_id as string | null) ?? null;
};

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Clinch RPC Trip");
  compId = await ctx.createCompetition(tripId, "RPC Cup");
  teamA = await ctx.createTeam(compId, "Alpha");
  teamB = await ctx.createTeam(compId, "Bravo");
}, 120_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

describe("claim_clinch_notification — exactly-once, in SQL", () => {
  it("the FIRST claim wins from a NULL column, and the row actually changes", async () => {
    // The case `IS DISTINCT FROM` exists for: a bare `<>` is NULL against a NULL
    // column, so it would match nothing and silently lose EVERY first clinch.
    expect(await held()).toBeNull();
    expect(await claim(teamA)).toBe(true);
    expect(await held()).toBe(teamA);
  }, 60_000);

  it("a second claim for the same team loses, and does NOT report the write it made", async () => {
    // The production regression in one assertion: true here would mean a second
    // push for one clinch; a claim that returned true while writing nothing (or
    // false while writing) is the failure this migration removes.
    expect(await claim(teamA)).toBe(false);
    expect(await held()).toBe(teamA);
  }, 60_000);

  it("repeated claims stay lost — idempotent, not alternating", async () => {
    for (let i = 0; i < 3; i++) expect(await claim(teamA)).toBe(false);
    expect(await held()).toBe(teamA);
  }, 60_000);

  it("a DIFFERENT team wins — an un-clinch then a new decision IS news", async () => {
    expect(await claim(teamB)).toBe(true);
    expect(await held()).toBe(teamB);
  }, 60_000);

  it("concurrent claims for the same team produce exactly ONE winner", async () => {
    // The property migration 099 introduced, now enforced by the row lock rather
    // than by a filter: concurrent callers serialize and one sees row_count > 0.
    await ctx.admin
      .from("competitions")
      .update({ clinch_notified_team_id: null })
      .eq("id", compId);

    const results = await Promise.all(Array.from({ length: 5 }, () => claim(teamA)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await held()).toBe(teamA);
  }, 60_000);

  it("an unknown competition is a loss, not a throw", async () => {
    expect(await claim(teamA, genId("no-such-comp"))).toBe(false);
  }, 60_000);
});

describe("release_clinch_claim — conditional, never a blind clear", () => {
  it("releases a claim it still holds", async () => {
    expect(await held()).toBe(teamA);
    expect(await release(teamA)).toBe(true);
    expect(await held()).toBeNull();
  }, 60_000);

  it("clinch → release → the SAME team re-claims → eligible again", async () => {
    // The #841 sequence end to end. Before the release existed, step 3 returned
    // false and the second clinch went unannounced.
    expect(await claim(teamA)).toBe(true);
    expect(await release(teamA)).toBe(true);
    expect(await claim(teamA)).toBe(true);
    expect(await held()).toBe(teamA);
  }, 60_000);

  it("a STALE release loses to a newer claim — exactly-once survives", async () => {
    // A observed Alpha; B claims Bravo before A's release lands. A blind clear
    // would wipe B's claim and let one clinch announce twice.
    const observedByA = teamA;
    expect(await claim(teamB)).toBe(true);

    expect(await release(observedByA)).toBe(false);
    expect(await held(), "B's claim survives A's stale release").toBe(teamB);
  }, 60_000);

  it("releasing a claim nobody holds is a no-op, not a throw", async () => {
    expect(await release(teamB)).toBe(true);
    expect(await held()).toBeNull();
    expect(await release(teamB)).toBe(false);
  }, 60_000);
});

describe("the functions are not reachable by end users", () => {
  it("an authenticated caller cannot execute either — EXECUTE is service_role only", async () => {
    // Supabase auto-grants EXECUTE to PUBLIC on new functions. Without the
    // revoke, any signed-in user could set or clear the cup's announcement
    // bookkeeping (revoke-from-public, migration 066's rule).
    const asUser = ctx.authedClient("member");

    const claimed = await asUser.rpc("claim_clinch_notification", {
      p_competition_id: compId,
      p_team_id: teamA,
    });
    expect(claimed.error, "claim must be denied for authenticated").not.toBeNull();

    const released = await asUser.rpc("release_clinch_claim", {
      p_competition_id: compId,
      p_expected_team_id: teamA,
    });
    expect(released.error, "release must be denied for authenticated").not.toBeNull();
  }, 60_000);
});
