import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { claimClinchNotification } from "./gameFinishNotify";

/**
 * A SHAPE guard, deliberately — because no behavioural test can catch this one.
 *
 * ── The bug ─────────────────────────────────────────────────────────────────
 * On a MUTATION, PostgREST applies an `or=(…)` filter in the scope of the
 * RETURNING projection. If `select=` omits a column the filter references, the
 * reference resolves against a relation that no longer has it and Postgres
 * raises 42703 — `column competitions.clinch_notified_team_id does not exist` —
 * naming a column that demonstrably DOES exist in `information_schema`,
 * `pg_attribute`, and a plain `GET`.
 *
 * ── Why a shape test and not a real one ─────────────────────────────────────
 * It is PostgREST-VERSION-dependent. The identical request returns `[]` on the
 * local stack's PostgREST 14.5 and 42703 on the deployed one — verified in both
 * directions by hand. So a test that performs the claim and asserts it succeeds
 * passes locally and in CI no matter what, which is exactly what happened: the
 * claim write succeeded ZERO times across 41 competitions in production while
 * every test here was green.
 *
 * Asserting the REQUEST is the only check that transfers between the two
 * environments, so that is what this does: no network, no database — capture
 * what supabase-js builds and hold it to the rule.
 *
 * The chase this ended is worth the file existing: the error names a column that
 * exists, so it reads as a stale schema cache. It is not one. A `NOTIFY pgrst`
 * changed nothing, and migration 106's column was visible through the same cache
 * minutes after being added while this one, a week old, was not.
 */

/** Column names referenced inside a PostgREST `or=(…)` group. */
function orFilterColumns(url: URL): string[] {
  const or = url.searchParams.get("or");
  if (!or) return [];
  return [
    ...new Set(
      or
        .replace(/^\(|\)$/g, "")
        .split(",")
        .map((clause) => clause.split(".")[0]?.trim())
        .filter((c): c is string => !!c)
    ),
  ];
}

/** Columns the mutation asks PostgREST to return. `*` covers everything. */
function selectColumns(url: URL): string[] {
  const sel = url.searchParams.get("select");
  if (!sel) return [];
  return sel.split(",").map((c) => c.trim());
}

/**
 * THE RULE: on a mutation, every column an `or=(…)` filter names must also be in
 * `select=`. Exported in spirit for the next call site — today there is exactly
 * one (`grep '\.or(' src/server` confirms), and a second one gets a case here.
 */
function violations(rawUrl: string): string[] {
  const url = new URL(rawUrl);
  const selected = selectColumns(url);
  if (selected.includes("*")) return [];
  return orFilterColumns(url).filter((c) => !selected.includes(c));
}

/** A client whose fetch records the request and answers without a network. */
function capturingClient() {
  const seen: { method: string; url: string }[] = [];
  const client = createClient("https://example.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        seen.push({ method: init?.method ?? "GET", url: String(input) });
        // One row back → `claimed`, so the function returns without a follow-up
        // read and the capture holds exactly the mutation under test.
        return new Response(JSON.stringify([{ id: "c1" }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  });
  return { client, seen };
}

describe("the clinch claim's PostgREST request shape", () => {
  it("keeps every or()-filtered column inside select — the 42703 fix", async () => {
    const { client, seen } = capturingClient();

    const result = await claimClinchNotification(client, "comp-1", "team-1");
    expect(result.outcome).toBe("claimed");

    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe("PATCH");

    const missing = violations(seen[0].url);
    expect(
      missing,
      `these or() columns are missing from select=, which 42703s on the deployed PostgREST: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("still filters on the claim column — the fix must not have removed the CAS", async () => {
    // The cheapest wrong "fix" is deleting the or() filter to make the error go
    // away. That would turn the claim into an unconditional write and destroy
    // migration 099's exactly-once property, which is the whole point of it.
    const { client, seen } = capturingClient();
    await claimClinchNotification(client, "comp-1", "team-1");

    const url = new URL(seen[0].url);
    expect(orFilterColumns(url)).toEqual(["clinch_notified_team_id"]);
    expect(url.searchParams.get("or")).toContain("is.null");
    expect(url.searchParams.get("or")).toContain("neq.team-1");
  });

  it("the checker itself catches the broken shape", async () => {
    // Guard the guard: a checker that can only ever return [] proves nothing.
    expect(
      violations(
        "https://x.test/rest/v1/competitions?id=eq.c1&or=(clinch_notified_team_id.is.null,clinch_notified_team_id.neq.t1)&select=id"
      )
    ).toEqual(["clinch_notified_team_id"]);

    // …and accepts the two shapes verified to work against production.
    expect(
      violations(
        "https://x.test/rest/v1/competitions?or=(clinch_notified_team_id.is.null)&select=id,clinch_notified_team_id"
      )
    ).toEqual([]);
    expect(
      violations("https://x.test/rest/v1/competitions?or=(clinch_notified_team_id.is.null)&select=*")
    ).toEqual([]);
  });
});
