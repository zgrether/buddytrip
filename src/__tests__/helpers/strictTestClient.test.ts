import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { strictTestClient, TestInfrastructureError, KONG_UPSTREAM_502 } from "./strictTestClient";
import { withSeedRetry } from "./seedRetry";

/**
 * The wrapper that makes a test's failed READ throw as infrastructure (#1527),
 * pinned without a database: a fake client whose builders resolve to a chosen
 * result. The cases that must PASS THROUGH matter as much as the ones that
 * throw — a wrapper that threw on every error would break every RLS and
 * constraint test, which assert on `{ error }`.
 */

type Result = { status: number; error: { message: string; code?: string | null } | null; data?: unknown };

function fakeBuilder(result: Result): object {
  const b = {
    select: () => fakeBuilder(result),
    eq: () => fakeBuilder(result),
    then: (onF?: (v: Result) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(result).then(onF, onR),
  };
  return b;
}

function client(result: Result): SupabaseClient {
  return strictTestClient(
    { from: () => fakeBuilder(result), rpc: () => fakeBuilder(result), auth: { marker: "untouched" } } as unknown as SupabaseClient,
    "admin"
  );
}

const KONG: Result = { status: 502, error: { message: KONG_UPSTREAM_502, code: null }, data: null };
const FETCH_FAILED: Result = { status: 0, error: { message: "TypeError: fetch failed", code: "" }, data: null };
const UNAVAILABLE: Result = { status: 503, error: { message: "Could not connect", code: "PGRST000" }, data: null };
const RLS_REFUSAL: Result = { status: 403, error: { message: "permission denied", code: "42501" }, data: null };
const CONSTRAINT: Result = { status: 409, error: { message: "duplicate key", code: "23505" }, data: null };
const OK: Result = { status: 200, error: null, data: [{ id: "x" }] };

describe("strictTestClient — infrastructure failures THROW", () => {
  it("the Kong 502 throws TestInfrastructureError naming the call and the issue", async () => {
    const p = client(KONG).from("games").select("id").eq("id", "g");
    await expect(p).rejects.toBeInstanceOf(TestInfrastructureError);
    await expect(client(KONG).from("games").select("id")).rejects.toThrow(/infrastructure.*#1527.*admin\.from\("games"\)/);
  });

  it("a failed fetch (status 0) throws", async () => {
    await expect(client(FETCH_FAILED).from("games").select("id")).rejects.toBeInstanceOf(TestInfrastructureError);
  });

  it("a 503 throws", async () => {
    await expect(client(UNAVAILABLE).from("games").select("id")).rejects.toBeInstanceOf(TestInfrastructureError);
  });

  it("rpc is wrapped too", async () => {
    await expect(client(KONG).rpc("set_team_captain", {})).rejects.toBeInstanceOf(TestInfrastructureError);
  });
});

describe("strictTestClient — everything else resolves exactly as before", () => {
  it("success resolves unchanged", async () => {
    await expect(client(OK).from("games").select("id").eq("id", "g")).resolves.toEqual(OK);
  });

  it("an RLS refusal still arrives as { error } — tests assert on it", async () => {
    await expect(client(RLS_REFUSAL).from("games").select("id")).resolves.toEqual(RLS_REFUSAL);
  });

  it("a constraint violation still arrives as { error }", async () => {
    await expect(client(CONSTRAINT).rpc("x", {})).resolves.toEqual(CONSTRAINT);
  });

  it("non-query members are untouched", () => {
    expect((client(OK) as unknown as { auth: { marker: string } }).auth.marker).toBe("untouched");
  });
});

describe("withSeedRetry keeps its exact retry decision under the strict client", () => {
  it("a thrown Kong 502 is still retried, then the success counts", async () => {
    let calls = 0;
    await withSeedRetry(() => {
      calls++;
      return calls === 1 ? client(KONG).from("t").select() : client(OK).from("t").select();
    }, "seed");
    expect(calls).toBe(2);
  });

  it("a thrown fetch failure is NOT newly retried — it fails on the first attempt, as before", async () => {
    let calls = 0;
    await expect(
      withSeedRetry(() => {
        calls++;
        return client(FETCH_FAILED).from("t").select();
      }, "seed")
    ).rejects.toThrow(/^seed: TypeError: fetch failed$/);
    expect(calls).toBe(1);
  });
});
