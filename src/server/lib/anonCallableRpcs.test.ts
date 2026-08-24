import { describe, it, expect } from "vitest";

/**
 * What can an UNAUTHENTICATED caller invoke? (migration 143)
 *
 * ── The incident this exists for ────────────────────────────────────────────
 *
 * `_write_game_results` was granted EXECUTE to `anon`. It is an internal core:
 * the guarded wrapper `write_game_results` calls `assert_game_edit` and then
 * delegates to it, so the core carries no identity check of its own. With the
 * anon grant, anyone holding the publishable key — which ships in the client
 * bundle — could POST `/rest/v1/rpc/_write_game_results` and write arbitrary
 * `game_results` rows into any game. Confirmed against a local stack: HTTP 204
 * and a row on disk. `game_results` is what the competition leaderboard rolls
 * up, so that is standings manipulation with no session and no membership.
 *
 * Its sibling cores (`_reset_game_scoring`, `_reset_game_to_skeleton`) were
 * locked correctly, so this was one function missed in an otherwise-applied
 * pattern — the kind of gap no unit test looks for and no type can see.
 *
 * ── Why this asks PostgREST instead of reading the catalogue ───────────────
 *
 * PostgREST serves its OpenAPI document PER ROLE: the paths it lists for the
 * anon key are exactly the RPCs anon may call. So this asserts the REACHABLE
 * surface rather than the grant table that is supposed to produce it — the
 * difference being that a grant can be correct while some other mechanism
 * (schema exposure, a later GRANT, a re-created function resetting its ACL to
 * the PUBLIC default) still leaves the endpoint open. It also needs no
 * `information_schema` access, which PostgREST does not expose — the same
 * reasoning `gameResetEquivalence.test.ts` uses for reading the live schema.
 *
 * ── The invariant is general, not a list of five names ─────────────────────
 *
 * A hardcoded denylist only catches the functions someone already thought of;
 * it is green the day a NEW core is added with a stray grant. The rule asserted
 * here is the codebase's own convention — a leading underscore means "internal
 * core, reached only through its guarded wrapper" — so any future core is
 * covered on the day it is written.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function anonCallableRpcs(): Promise<string[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      Accept: "application/openapi+json",
    },
  });
  if (!res.ok) throw new Error(`PostgREST root failed: ${res.status}`);
  const doc = (await res.json()) as { paths?: Record<string, unknown> };
  return Object.keys(doc.paths ?? {})
    .filter((p) => p.startsWith("/rpc/"))
    .map((p) => p.slice("/rpc/".length))
    .sort();
}

describe("the anon-callable RPC surface", () => {
  it("exposes NO underscore-prefixed core", async () => {
    const rpcs = await anonCallableRpcs();

    // Premise: if the document came back empty the assertion below would pass
    // while checking nothing at all — the classic vacuous guard.
    expect(rpcs.length, "the anon OpenAPI document should list some RPCs").toBeGreaterThan(0);

    const cores = rpcs.filter((n) => n.startsWith("_"));
    expect(
      cores,
      "a `_`-prefixed function is an internal core reached only through its guarded " +
        "wrapper; anon must never be able to call one directly"
    ).toEqual([]);
  });

  it("does not expose the un-guarded writers by name", async () => {
    // Belt to the invariant's braces. These four establish no caller identity
    // at all, so reachability IS the vulnerability — there is no second line of
    // defence behind the grant. Named explicitly because three of them do not
    // carry the underscore convention and so are invisible to the rule above.
    const rpcs = new Set(await anonCallableRpcs());
    for (const name of [
      "_write_game_results", // writes game_results — the proven exploit
      "increment_member_email_count", // writes per-member email counters
      "record_api_call", // writes the golf-course API daily cap counter
      "trip_has_any_member", // "is this trip empty?" — a claiming primitive (#991)
      "user_delete_blocking_fks", // schema metadata
    ]) {
      expect(rpcs.has(name), `${name} must not be callable by anon`).toBe(false);
    }
  });

  it("everything anon CAN still call establishes identity for itself", async () => {
    /**
     * The remaining anon-callable set is deliberate and is NOT a finding: every
     * one of these resolves `auth.uid()`, which is NULL for anon, and refuses.
     * They keep the PUBLIC grant because many RLS policies are declared
     * `TO PUBLIC` and call these same helpers — revoking anon there would turn
     * policy evaluation into an ERROR rather than an empty result, on paths
     * nobody has enumerated. See migration 143's note.
     *
     * Pinned as an ALLOWLIST so the set cannot grow quietly: a new anon-callable
     * function fails here and has to be justified, which is the whole point.
     */
    const allowed = new Set([
      "assert_competition_owner",
      "assert_game_edit",
      "assert_game_owner",
      "can_score_match",
      "can_score_unit",
      "delete_competition_cascade",
      "has_trip_role",
      "is_game_delegate",
      "is_team_captain",
      "is_trip_member",
      "is_trip_planner",
      "reset_competition_scoring",
      "reset_competition_to_skeleton",
      "reset_game_scoring",
      "reset_game_to_skeleton",
      "save_game_config",
      "set_team_captain",
      "trip_status",
      "write_game_results",
    ]);

    const unexpected = (await anonCallableRpcs()).filter((n) => !allowed.has(n));
    expect(
      unexpected,
      "a NEW anon-callable RPC appeared — confirm it establishes caller identity " +
        "internally, then add it here with that justification"
    ).toEqual([]);
  });
});
