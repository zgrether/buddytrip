import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  assertAffected,
  assertAffectedAtLeastOne,
  assertNoError,
} from "./assertAffected";

/**
 * Unit tests — no DB. The helper is pure; what needs pinning is the CONTRACT the
 * 64 call sites depend on, not Postgres behaviour.
 *
 * The load-bearing case is `count: null`. Supabase only returns a count when the
 * caller passes `{ count: "exact" }`, so a site that forgets it would — under a
 * naive implementation — look guarded while asserting nothing. That is the exact
 * failure mode this audit is about, so it throws, and this file is where that
 * decision is pinned.
 */

function codeOf(fn: () => void): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof TRPCError ? e.code : "NOT_A_TRPC_ERROR";
  }
}

function messageOf(fn: () => void): string {
  try {
    fn();
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

describe("assertAffected", () => {
  it("passes when the count matches", () => {
    expect(() =>
      assertAffected({ error: null, count: 1 }, 1, "promote the new owner")
    ).not.toThrow();
  });

  it("throws when the count is short", () => {
    expect(codeOf(() => assertAffected({ error: null, count: 0 }, 1, "promote the new owner")))
      .toBe("INTERNAL_SERVER_ERROR");
  });

  it("throws when the count is HIGH — over-matching is a defect too", () => {
    // A filter that matched more rows than intended is as wrong as one that
    // matched none; an equality assertion catches both directions.
    expect(codeOf(() => assertAffected({ error: null, count: 2 }, 1, "demote the old owner")))
      .toBe("INTERNAL_SERVER_ERROR");
  });

  it("names what the write was FOR in the message", () => {
    const msg = messageOf(() =>
      assertAffected({ error: null, count: 0 }, 1, "promote the new owner")
    );
    expect(msg).toContain("promote the new owner");
    expect(msg).toContain("expected 1");
    expect(msg).toContain("affected 0");
  });

  it("surfaces a real DB error ahead of the count check", () => {
    const msg = messageOf(() =>
      assertAffected({ error: { message: "deadlock detected" }, count: null }, 1, "x")
    );
    // The DB's own message must survive — it's the diagnostic. And the caller
    // must not be told to add { count: "exact" } when the real problem was a
    // failed query.
    expect(msg).toContain("deadlock detected");
    expect(msg).not.toContain("count");
  });

  it("REFUSES a missing count rather than passing vacuously", () => {
    // The whole point: a site that forgot { count: "exact" } must not look
    // guarded. This is the assertion that keeps the idiom honest.
    const msg = messageOf(() => assertAffected({ error: null }, 1, "clear the handicap"));
    expect(msg).toContain('{ count: "exact" }');
    expect(msg).toContain("assertNoError");
  });

  it("never throws UNAUTHORIZED", () => {
    // authExpiry treats 401 as a dead session and hard-navigates to /login, so a
    // wrong code here logs someone out mid-round.
    for (const res of [
      { error: { message: "boom" }, count: null },
      { error: null, count: 0 },
      { error: null },
    ]) {
      expect(codeOf(() => assertAffected(res, 1, "x"))).not.toBe("UNAUTHORIZED");
    }
  });
});

describe("assertNoError", () => {
  it("passes on zero rows — the legitimate no-op case", () => {
    // e.g. games.setBackNine's hole 10-18 clear: a no-op on the first compose.
    expect(() => assertNoError({ error: null, count: 0 }, "clear the old back nine")).not.toThrow();
  });

  it("passes when no count was requested at all", () => {
    expect(() => assertNoError({ error: null }, "clear the old back nine")).not.toThrow();
  });

  it("throws on a real error", () => {
    expect(codeOf(() => assertNoError({ error: { message: "boom" }, count: null }, "x")))
      .toBe("INTERNAL_SERVER_ERROR");
  });
});

describe("assertAffectedAtLeastOne", () => {
  it("passes on any positive count", () => {
    expect(() => assertAffectedAtLeastOne({ error: null, count: 4 }, "stamp the recipients")).not.toThrow();
  });

  it("throws on zero", () => {
    expect(codeOf(() => assertAffectedAtLeastOne({ error: null, count: 0 }, "stamp the recipients")))
      .toBe("INTERNAL_SERVER_ERROR");
  });

  it("refuses a missing count", () => {
    expect(messageOf(() => assertAffectedAtLeastOne({ error: null }, "x")))
      .toContain('{ count: "exact" }');
  });
});
