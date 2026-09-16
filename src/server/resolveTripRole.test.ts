import { describe, it, expect, vi, afterEach } from "vitest";
import {
  resolveTripRole,
  NOT_A_MEMBER_MESSAGE,
  GATE_UNAVAILABLE_MESSAGE,
  type TripRole,
} from "./middleware";

/**
 * The trip membership gate must tell a FAILED CHECK apart from a REFUSAL.
 *
 * Lived 2026-09-04: PostgREST's connection pool was exhausted, this gate's
 * SELECT came back 504, and every player mid-round was told "You are not a
 * member of this trip". The two conditions shared one branch.
 *
 * ── Why this is a unit test with a fake client, not an integration test ─────
 *
 * The condition under test is *the query failed*, and a healthy local Postgres
 * cannot produce one on demand. Against a real DB you can only exercise the two
 * arms that already worked (member / non-member) — which is exactly the
 * coverage that existed while the bug did. The fake is the only way to put the
 * failing case in front of the code.
 *
 * ── The fake deliberately exposes ONLY `maybeSingle` ────────────────────────
 *
 * `.single()` raises an error for zero rows as well as for a real failure, so
 * reverting to it would push every genuine non-member into the "check failed"
 * arm and hide real refusals behind a retry suggestion. A revert therefore
 * fails here with a TypeError rather than passing quietly.
 */

type MaybeSingleResult = { data: { role: TripRole } | null; error: unknown };

function fakeCtx(result: MaybeSingleResult) {
  const calls: string[] = [];
  return {
    calls,
    ctx: {
      supabase: {
        from: (table: string) => {
          calls.push(table);
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => result,
                }),
              }),
            }),
          };
        },
      },
      user: { id: "user-1" },
      membershipCache: new Map<string, Promise<TripRole>>(),
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveTripRole — a failed check is not a refusal", () => {
  it("returns the role when the member row is found", async () => {
    const { ctx } = fakeCtx({ data: { role: "Organizer" }, error: null });
    await expect(resolveTripRole(ctx, "trip-1")).resolves.toBe("Organizer");
  });

  it("REFUSES with the membership message when there is genuinely no row", async () => {
    const { ctx } = fakeCtx({ data: null, error: null });
    await expect(resolveTripRole(ctx, "trip-1")).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: NOT_A_MEMBER_MESSAGE,
    });
  });

  it("does NOT claim non-membership when the query itself failed", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctx } = fakeCtx({
      data: null,
      // The shape PostgREST returned during the outage.
      error: { code: "PGRST003", message: "Timed out acquiring connection from connection pool." },
    });

    await expect(resolveTripRole(ctx, "trip-1")).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: GATE_UNAVAILABLE_MESSAGE,
    });
    void spy;
  });

  /**
   * The property that actually matters, asserted on its own so it cannot be
   * satisfied by the code merely throwing SOMETHING: whatever the gate says
   * when it could not check, it must not accuse the caller of not belonging.
   */
  it("never emits the membership accusation on a failed check", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctx } = fakeCtx({ data: null, error: new Error("fetch failed") });

    const err = await resolveTripRole(ctx, "trip-1").then(
      () => null,
      (e: unknown) => e as { code?: string; message?: string }
    );

    expect(err).not.toBeNull();
    expect(err?.message).not.toBe(NOT_A_MEMBER_MESSAGE);
    expect(err?.message).not.toMatch(/not a member/i);
    expect(err?.code).not.toBe("FORBIDDEN");
  });

  it("records the underlying failure so the next outage is diagnosable", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctx } = fakeCtx({
      data: null,
      error: { code: "PGRST003", message: "Timed out acquiring connection from connection pool." },
    });

    await resolveTripRole(ctx, "trip-1").catch(() => {});

    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0]?.[0]);
    expect(line).toContain("trip-gate-unavailable");
    expect(line).toContain("PGRST003");
  });

  it("caches a resolved role and does not re-query", async () => {
    const { ctx, calls } = fakeCtx({ data: { role: "Owner" }, error: null });
    await resolveTripRole(ctx, "trip-1");
    await resolveTripRole(ctx, "trip-1");
    expect(calls).toEqual(["trip_members"]);
  });

  /**
   * A failure must NOT be cached — the next request may well succeed, and a
   * cached "unknown" would turn one bad second into a dead request context.
   */
  it("does not cache a failed check", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctx, calls } = fakeCtx({ data: null, error: new Error("boom") });
    await resolveTripRole(ctx, "trip-1").catch(() => {});
    await resolveTripRole(ctx, "trip-1").catch(() => {});
    expect(calls).toEqual(["trip_members", "trip_members"]);
  });
});

/**
 * The batch race. tRPC resolves a batch's calls CONCURRENTLY, so the property
 * that matters is what happens when several gate checks start before the first
 * SELECT has returned. Each fake query is held open until the test releases it,
 * so "concurrent" is guaranteed by construction rather than by timing.
 */
function heldCtx() {
  const pending: Array<(r: MaybeSingleResult) => void> = [];
  const tripsQueried: string[] = [];
  const ctx = {
    supabase: {
      from: () => ({
        select: () => ({
          eq: (_c: string, tripId: string) => ({
            eq: () => ({
              maybeSingle: () => {
                tripsQueried.push(tripId);
                return new Promise<MaybeSingleResult>((res) => pending.push(res));
              },
            }),
          }),
        }),
      }),
    },
    user: { id: "user-1" },
    membershipCache: new Map<string, Promise<TripRole>>(),
  };
  const releaseAll = (r: MaybeSingleResult) => pending.splice(0).forEach((res) => res(r));
  return { ctx, tripsQueried, releaseAll };
}

describe("resolveTripRole — concurrent checks in one request share one query", () => {
  it("five gate checks started together run ONE SELECT and all get the role", async () => {
    const { ctx, tripsQueried, releaseAll } = heldCtx();
    const checks = Array.from({ length: 5 }, () => resolveTripRole(ctx, "trip-1"));
    // All five have started and none has an answer yet — the race the old
    // resolved-value cache lost, since each would have missed and queried.
    expect(tripsQueried).toEqual(["trip-1"]);
    releaseAll({ data: { role: "Member" }, error: null });
    await expect(Promise.all(checks)).resolves.toEqual(["Member", "Member", "Member", "Member", "Member"]);
    expect(tripsQueried).toEqual(["trip-1"]);
  });

  it("different trips in one batch are still checked separately", async () => {
    const { ctx, tripsQueried, releaseAll } = heldCtx();
    const a = resolveTripRole(ctx, "trip-a");
    const b = resolveTripRole(ctx, "trip-b");
    const a2 = resolveTripRole(ctx, "trip-a");
    expect(tripsQueried).toEqual(["trip-a", "trip-b"]);
    releaseAll({ data: { role: "Owner" }, error: null });
    await Promise.all([a, b, a2]);
  });

  it("a FAILED check is shared by the callers already waiting, then EVICTED", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctx, tripsQueried, releaseAll } = heldCtx();
    const first = resolveTripRole(ctx, "trip-1");
    const second = resolveTripRole(ctx, "trip-1");
    releaseAll({ data: null, error: { code: "PGRST003", message: "pool timeout" } });

    // Both waiters get the gate-unavailable answer, never a membership accusation.
    for (const p of [first, second]) {
      await expect(p).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: GATE_UNAVAILABLE_MESSAGE });
    }
    expect(tripsQueried).toEqual(["trip-1"]);

    // Eviction: the rejected promise is gone, so the next check asks again
    // and can succeed rather than replaying the failure for the whole request.
    expect(ctx.membershipCache.has("trip-1")).toBe(false);
    const retry = resolveTripRole(ctx, "trip-1");
    expect(tripsQueried).toEqual(["trip-1", "trip-1"]);
    releaseAll({ data: { role: "Organizer" }, error: null });
    await expect(retry).resolves.toBe("Organizer");
  });

  it("a genuine refusal is evicted too — only a successful answer is reused", async () => {
    const { ctx, tripsQueried, releaseAll } = heldCtx();
    const refused = resolveTripRole(ctx, "trip-1");
    releaseAll({ data: null, error: null });
    await expect(refused).rejects.toMatchObject({ code: "FORBIDDEN", message: NOT_A_MEMBER_MESSAGE });
    expect(ctx.membershipCache.has("trip-1")).toBe(false);
    void resolveTripRole(ctx, "trip-1").catch(() => {});
    expect(tripsQueried).toEqual(["trip-1", "trip-1"]);
    releaseAll({ data: null, error: null });
  });
});
