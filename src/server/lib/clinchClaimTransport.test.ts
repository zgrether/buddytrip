import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { claimClinchNotification, releaseClinchClaim } from "./gameFinishNotify";

/**
 * The clinch CAS must travel as an RPC, never as a PostgREST filter.
 *
 * ── Why this is asserted on the REQUEST, not the result ─────────────────────
 * The failure it guards is PostgREST-VERSION-dependent, so no behavioural test
 * can see it: the filter form works on the local stack's PostgREST 14.5 and
 * misbehaves on the deployed one. Verified in both directions. That asymmetry is
 * why the claim write succeeded ZERO times across 41 competitions in production
 * while every test in `clinchClaim.test.ts` stayed green — and why those tests,
 * which now exercise the RPC, still cannot be the guard here.
 *
 * Asserting what goes on the wire is the only check that transfers between the
 * two environments.
 *
 * ── What reintroduction looks like ──────────────────────────────────────────
 * A mutation carrying its own CAS predicate:
 *
 *   .update({ clinch_notified_team_id: teamId })
 *   .or("clinch_notified_team_id.is.null,clinch_notified_team_id.neq.<team>")
 *
 * On the deployed PostgREST that filter is applied in the scope of the RETURNING
 * projection, so after the SET the row no longer satisfies the predicate and the
 * projection excludes the row it just wrote. The write lands and reports itself
 * lost; the caller reads "already claimed" and sends nothing. With the column
 * missing from the select it fails louder instead — 42703 naming a column that
 * plainly exists.
 *
 * A compare-and-swap is falsified BY THE WRITE IT GUARDS. It cannot be a
 * post-image filter, so it does not belong in PostgREST at all.
 */

/** A client whose fetch records the request and answers without a network. */
function capturingClient(rpcResult: unknown) {
  const seen: { method: string; url: string; body: string | null }[] = [];
  const client = createClient("https://example.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        seen.push({
          method: init?.method ?? "GET",
          url: String(input),
          body: typeof init?.body === "string" ? init.body : null,
        });
        return new Response(JSON.stringify(rpcResult), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  });
  return { client, seen };
}

describe("the clinch claim's transport", () => {
  it("claims via the RPC — POST to /rpc/claim_clinch_notification", async () => {
    const { client, seen } = capturingClient(true);

    const result = await claimClinchNotification(client, "comp-1", "team-1");
    expect(result.outcome).toBe("claimed");

    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe("POST");
    expect(seen[0].url).toContain("/rpc/claim_clinch_notification");
    expect(JSON.parse(seen[0].body ?? "{}")).toEqual({
      p_competition_id: "comp-1",
      p_team_id: "team-1",
    });
  });

  it("releases via the RPC — POST to /rpc/release_clinch_claim", async () => {
    const { client, seen } = capturingClient(true);

    expect(await releaseClinchClaim(client, "comp-1", "team-1")).toBe(true);

    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe("POST");
    expect(seen[0].url).toContain("/rpc/release_clinch_claim");
    expect(JSON.parse(seen[0].body ?? "{}")).toEqual({
      p_competition_id: "comp-1",
      p_expected_team_id: "team-1",
    });
  });

  it("NEITHER sends a PATCH, and neither carries an or() filter", async () => {
    // The specific reintroduction this file exists to fail on. A PATCH to
    // /competitions with `or=` is the broken shape regardless of what the
    // select says — both of its variants are wrong, one loudly and one silently.
    for (const run of [
      () => claimClinchNotification,
      () => releaseClinchClaim,
    ]) {
      const { client, seen } = capturingClient(true);
      await (run() as (c: typeof client, a: string, b: string) => Promise<unknown>)(
        client,
        "comp-1",
        "team-1"
      );
      for (const req of seen) {
        expect(req.method, `${req.url} must not be a PostgREST mutation`).not.toBe("PATCH");
        expect(req.url).not.toContain("or=(");
      }
    }
  });

  it("a false return does NOT immediately mean already_claimed — it is confirmed by a read", async () => {
    // `false` covers both "the column already holds this team" and "no such
    // competition". Collapsing them would put back exactly the over-claiming
    // this whole investigation was spent removing.
    const { client, seen } = capturingClient(false);

    const result = await claimClinchNotification(client, "comp-1", "team-1");

    // The RPC, then a confirming read — not a verdict from the RPC alone.
    expect(seen).toHaveLength(2);
    expect(seen[1].method).toBe("GET");
    expect(seen[1].url).toContain("clinch_notified_team_id");
    // The stub read returns `false` (not a row), so the claim is NOT confirmed.
    expect(result.outcome).toBe("claim_no_row");
  });
});
