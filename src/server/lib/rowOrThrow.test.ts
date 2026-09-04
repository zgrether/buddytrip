import { describe, it, expect, vi, afterEach } from "vitest";
import { TERMINAL_REFUSAL_CODES } from "@/lib/terminalRefusal";
import { rowOrThrow } from "./rowOrThrow";

/**
 * The property under test is not "it throws" — it is WHICH of two
 * indistinguishable states it reports, and whether the code it picks lets the
 * score outbox keep the write.
 */

const ABSENT = { code: "NOT_FOUND" as const, message: "Game not found" };
/** The shape supabase-js actually returned during the 2026-09-04 outage. */
const POOL_TIMEOUT = {
  code: "PGRST003",
  message: "Timed out acquiring connection from connection pool.",
  details: null,
  hint: null,
};

afterEach(() => vi.restoreAllMocks());

describe("rowOrThrow", () => {
  it("returns the row when the query succeeded and found one", () => {
    expect(rowOrThrow({ data: { id: "g1" }, error: null }, ABSENT, "game")).toEqual({ id: "g1" });
  });

  it("REFUSES with the call site's own code and sentence when the row is genuinely absent", () => {
    expect(() => rowOrThrow({ data: null, error: null }, ABSENT, "game")).toThrowError(
      expect.objectContaining({ code: "NOT_FOUND", message: "Game not found" })
    );
  });

  it("does NOT claim absence when the query failed", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let thrown: { code?: string; message?: string } | null = null;
    try {
      rowOrThrow({ data: null, error: POOL_TIMEOUT }, ABSENT, "game");
    } catch (e) {
      thrown = e as { code?: string; message?: string };
    }
    expect(thrown).not.toBeNull();
    expect(thrown?.code).toBe("INTERNAL_SERVER_ERROR");
    expect(thrown?.message).not.toBe(ABSENT.message);
    expect(thrown?.message).not.toMatch(/not found/i);
    expect(thrown?.message).toContain("game");
  });

  /**
   * THE ONE THAT MATTERS. A terminal code here deletes the score:
   * `useScoreSaver` calls `outboxClear` on any code in this set. Asserted
   * against the REAL set rather than a copy of it, so if `INTERNAL_SERVER_ERROR`
   * is ever added to `TERMINAL_REFUSAL_CODES` this fails instead of silently
   * reintroducing the data loss.
   */
  it("throws a NON-TERMINAL code on failure, so the outbox keeps the write", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let code: string | undefined;
    try {
      rowOrThrow({ data: null, error: POOL_TIMEOUT }, ABSENT, "game");
    } catch (e) {
      code = (e as { code?: string }).code;
    }
    expect(code).toBeDefined();
    expect(TERMINAL_REFUSAL_CODES.has(code!)).toBe(false);
  });

  it("keeps the ABSENT case terminal — a real refusal must still stop the retry loop", () => {
    let code: string | undefined;
    try {
      rowOrThrow({ data: null, error: null }, ABSENT, "game");
    } catch (e) {
      code = (e as { code?: string }).code;
    }
    expect(TERMINAL_REFUSAL_CODES.has(code!)).toBe(true);
  });

  it("records the underlying error, as an object rather than [object Object]", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      rowOrThrow({ data: null, error: POOL_TIMEOUT }, ABSENT, "game");
    } catch {
      /* expected */
    }
    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0]?.[0]);
    expect(line).toContain("query-failed");
    expect(line).toContain("PGRST003");
    expect(line).not.toContain("[object Object]");
  });

  it("does not log on the absent path — an absence is not an incident", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      rowOrThrow({ data: null, error: null }, ABSENT, "game");
    } catch {
      /* expected */
    }
    expect(spy).not.toHaveBeenCalled();
  });

  /**
   * `data` can legitimately be falsy without being absent. `== null` is the
   * check, not `!data` — the bug this helper replaces was written with the
   * latter, and a helper that repeated it would be worse than none.
   */
  it("treats a falsy-but-present row as present", () => {
    expect(rowOrThrow({ data: 0 as unknown as number, error: null }, ABSENT, "thing")).toBe(0);
    expect(rowOrThrow({ data: "" as unknown as string, error: null }, ABSENT, "thing")).toBe("");
  });
});
