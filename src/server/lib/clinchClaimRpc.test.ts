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

/**
 * EVERY CASE BUILDS ITS OWN CUP (#1527). The cases used to walk ONE cup's
 * `clinch_notified_team_id` through a sequence — claim Alpha, lose a repeat,
 * swap to Bravo, release, re-claim — each asserting on the column the case
 * before had left. Shuffled, "the FIRST claim wins from a NULL column" met a
 * column already holding a team, and the release cases met claims that had
 * never been made. Each case now starts from a fresh, unclaimed cup and makes
 * the claims its premise needs through the real functions.
 */
type Cup = { compId: string; teamA: string; teamB: string };

async function freshCup(label: string): Promise<Cup> {
  const tripId = await ctx.createTrip(`Clinch RPC ${label}`);
  const compId = await ctx.createCompetition(tripId, `RPC Cup ${label}`);
  const teamA = await ctx.createTeam(compId, "Alpha");
  const teamB = await ctx.createTeam(compId, "Bravo");
  return { compId, teamA, teamB };
}

const claim = async (comp: string, team: string): Promise<boolean> => {
  const { data, error } = await ctx.admin.rpc("claim_clinch_notification", {
    p_competition_id: comp,
    p_team_id: team,
  });
  if (error) throw new Error(`claim: ${error.message}`);
  return data as boolean;
};

const release = async (comp: string, expected: string): Promise<boolean> => {
  const { data, error } = await ctx.admin.rpc("release_clinch_claim", {
    p_competition_id: comp,
    p_expected_team_id: expected,
  });
  if (error) throw new Error(`release: ${error.message}`);
  return data as boolean;
};

const held = async (comp: string): Promise<string | null> => {
  const { data, error } = await ctx.admin
    .from("competitions")
    .select("clinch_notified_team_id")
    .eq("id", comp)
    .single();
  if (error) throw new Error(`read claim: ${error.message}`);
  return (data?.clinch_notified_team_id as string | null) ?? null;
};

beforeAll(async () => {
  ctx = await TestContext.create();
}, 120_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

describe("claim_clinch_notification — exactly-once, in SQL", () => {
  it("the FIRST claim wins from a NULL column, and the row actually changes", async () => {
    // The case `IS DISTINCT FROM` exists for: a bare `<>` is NULL against a NULL
    // column, so it would match nothing and silently lose EVERY first clinch.
    const { compId, teamA } = await freshCup("first");
    expect(await held(compId)).toBeNull();
    expect(await claim(compId, teamA)).toBe(true);
    expect(await held(compId)).toBe(teamA);
  }, 60_000);

  it("a second claim for the same team loses, and does NOT report the write it made", async () => {
    // The production regression in one assertion: true here would mean a second
    // push for one clinch; a claim that returned true while writing nothing (or
    // false while writing) is the failure this migration removes.
    const { compId, teamA } = await freshCup("second-same");
    expect(await claim(compId, teamA)).toBe(true); // premise: Alpha holds it
    expect(await claim(compId, teamA)).toBe(false);
    expect(await held(compId)).toBe(teamA);
  }, 60_000);

  it("repeated claims stay lost — idempotent, not alternating", async () => {
    const { compId, teamA } = await freshCup("repeated");
    expect(await claim(compId, teamA)).toBe(true); // premise
    for (let i = 0; i < 3; i++) expect(await claim(compId, teamA)).toBe(false);
    expect(await held(compId)).toBe(teamA);
  }, 60_000);

  it("a DIFFERENT team wins — an un-clinch then a new decision IS news", async () => {
    const { compId, teamA, teamB } = await freshCup("different");
    expect(await claim(compId, teamA)).toBe(true); // premise: Alpha holds it
    expect(await claim(compId, teamB)).toBe(true);
    expect(await held(compId)).toBe(teamB);
  }, 60_000);

  it("concurrent claims for the same team produce exactly ONE winner", async () => {
    // The property migration 099 introduced, now enforced by the row lock rather
    // than by a filter: concurrent callers serialize and one sees row_count > 0.
    const { compId, teamA } = await freshCup("concurrent");
    expect(await held(compId)).toBeNull(); // premise: everyone races from NULL

    const results = await Promise.all(Array.from({ length: 5 }, () => claim(compId, teamA)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await held(compId)).toBe(teamA);
  }, 60_000);

  it("an unknown competition is a loss, not a throw", async () => {
    const { teamA } = await freshCup("unknown");
    expect(await claim(genId("no-such-comp"), teamA)).toBe(false);
  }, 60_000);
});

describe("release_clinch_claim — conditional, never a blind clear", () => {
  it("releases a claim it still holds", async () => {
    const { compId, teamA } = await freshCup("release-held");
    expect(await claim(compId, teamA)).toBe(true);
    expect(await held(compId)).toBe(teamA); // premise
    expect(await release(compId, teamA)).toBe(true);
    expect(await held(compId)).toBeNull();
  }, 60_000);

  it("clinch → release → the SAME team re-claims → eligible again", async () => {
    // The #841 sequence end to end. Before the release existed, step 3 returned
    // false and the second clinch went unannounced.
    const { compId, teamA } = await freshCup("reclaim");
    expect(await claim(compId, teamA)).toBe(true);
    expect(await release(compId, teamA)).toBe(true);
    expect(await claim(compId, teamA)).toBe(true);
    expect(await held(compId)).toBe(teamA);
  }, 60_000);

  it("a STALE release loses to a newer claim — exactly-once survives", async () => {
    // A observed Alpha; B claims Bravo before A's release lands. A blind clear
    // would wipe B's claim and let one clinch announce twice.
    const { compId, teamA, teamB } = await freshCup("stale");
    expect(await claim(compId, teamA)).toBe(true); // what A observed
    const observedByA = teamA;
    expect(await claim(compId, teamB)).toBe(true);

    expect(await release(compId, observedByA)).toBe(false);
    expect(await held(compId), "B's claim survives A's stale release").toBe(teamB);
  }, 60_000);

  it("releasing a claim nobody holds is a no-op, not a throw", async () => {
    const { compId, teamB } = await freshCup("nobody");
    expect(await claim(compId, teamB)).toBe(true);
    expect(await release(compId, teamB)).toBe(true);
    expect(await held(compId)).toBeNull();
    expect(await release(compId, teamB)).toBe(false);
  }, 60_000);

  /**
   * THE PRE-IMAGE DISCRIMINATOR — release's correctness was assumed, never shown.
   *
   * Release SETS the column it FILTERS on, which is the shape that broke the
   * claim: if the predicate were evaluated against the post-update row, then
   * after `SET clinch_notified_team_id = null` the filter
   * `clinch_notified_team_id = expected` could never match. That would produce
   * row_count 0 — so the function returns FALSE — AND leave the column still
   * set, because nothing was updated.
   *
   * The original probe could not tell those apart: it used an id matching
   * nothing, where zero rows is the correct answer either way. It tested
   * error-versus-no-error, not row-return semantics.
   *
   * These three observations together are inconsistent with post-image
   * evaluation, and only the three together — `true` alone would not rule out a
   * blind clear, and a null column alone would not rule out a false negative.
   * Confirmed directly against the DB (`UPDATE 1` on the function's own
   * statement, in a rolled-back transaction).
   */
  it("release returns TRUE and the column goes null — the WHERE sees the pre-image", async () => {
    const { compId, teamA } = await freshCup("pre-image");
    expect(await claim(compId, teamA)).toBe(true);
    expect(await held(compId)).toBe(teamA);

    expect(await release(compId, teamA), "row_count > 0 — a post-image filter would match nothing").toBe(
      true
    );
    expect(await held(compId), "and the write landed — not merely reported").toBeNull();

    // The same call again now genuinely matches nothing: FALSE here is the
    // honest zero, which is what makes the TRUE above meaningful.
    expect(await release(compId, teamA)).toBe(false);
  }, 60_000);
});

describe("the functions are not reachable by end users", () => {
  it("an authenticated caller cannot execute either — EXECUTE is service_role only", async () => {
    // Supabase auto-grants EXECUTE to PUBLIC on new functions. Without the
    // revoke, any signed-in user could set or clear the cup's announcement
    // bookkeeping (revoke-from-public, migration 066's rule).
    const { compId, teamA } = await freshCup("authenticated");
    const asUser = ctx.authedClient("member");

    const claimed = await asUser.rpc("claim_clinch_notification", {
      p_competition_id: compId,
      p_team_id: teamA,
    });
    expect(claimed.error, "claim must be denied for authenticated").not.toBeNull();
    expect(await held(compId), "and nothing was written").toBeNull();

    // Release is denied against a claim that is really there to release.
    expect(await claim(compId, teamA)).toBe(true);
    const released = await asUser.rpc("release_clinch_claim", {
      p_competition_id: compId,
      p_expected_team_id: teamA,
    });
    expect(released.error, "release must be denied for authenticated").not.toBeNull();
    expect(await held(compId), "and the claim survives").toBe(teamA);
  }, 60_000);
});
