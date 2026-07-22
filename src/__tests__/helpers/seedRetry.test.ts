import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withSeedRetry, type SeedOpError } from "./seedRetry";

const KONG_502: SeedOpError = { message: "An invalid response was received from the upstream server" };
const UNIQUE_VIOLATION: SeedOpError = { message: "duplicate key value violates unique constraint", code: "23505" };
const FOUR_XX: SeedOpError = { message: "permission denied for table trips", code: "42501" };

// The wrapper's backoff uses real setTimeout; fake timers let the "persistent
// failure" test run instantly instead of burning 250ms+500ms of wall time.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Drives a retry call to completion under fake timers (advances past every backoff). */
async function runToCompletion<T>(promise: Promise<T>): Promise<T> {
  // Pre-attach a no-op handler so a rejection that lands mid-loop (before the
  // caller's `.rejects` is attached below) isn't flagged as unhandled — the
  // caller still observes the real rejection via the same promise object.
  promise.catch(() => {});
  // Bounded loop, not a real sleep: flush microtasks + advance the fake clock
  // until the promise settles or we give up (guards against a hang if the
  // wrapper regresses to not resolving at all).
  for (let i = 0; i < 10; i++) {
    await vi.advanceTimersByTimeAsync(1000);
  }
  return promise;
}

describe("withSeedRetry", () => {
  it("502-then-200 succeeds after retry", async () => {
    const op = vi.fn().mockResolvedValueOnce({ error: KONG_502 }).mockResolvedValueOnce({ error: null });

    await expect(runToCompletion(withSeedRetry(op, "Failed to create trip"))).resolves.toBeUndefined();
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("a non-transient error fails immediately, no retry", async () => {
    const op = vi.fn().mockResolvedValue({ error: FOUR_XX });

    await expect(withSeedRetry(op, "Failed to create trip")).rejects.toThrow(
      /Failed to create trip: permission denied/
    );
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("a persistent 502 fails after exhausting attempts, with a clear error", async () => {
    const op = vi.fn().mockResolvedValue({ error: KONG_502 });

    await expect(runToCompletion(withSeedRetry(op, "Failed to create trip"))).rejects.toThrow(
      /Failed to create trip: .*upstream server.*after 3 attempts/
    );
    expect(op).toHaveBeenCalledTimes(3);
  });

  it("502-then-23505 on retry is treated as success (the original write landed) — no duplicate call", async () => {
    const op = vi.fn().mockResolvedValueOnce({ error: KONG_502 }).mockResolvedValueOnce({ error: UNIQUE_VIOLATION });

    await expect(runToCompletion(withSeedRetry(op, "Failed to create trip"))).resolves.toBeUndefined();
    // Exactly 2 calls — the tell resolves on the retry; a 3rd call would mean
    // we kept going and risked a real duplicate-insert attempt.
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("a first-attempt 23505 (no preceding 502) is a real error, not swallowed", async () => {
    const op = vi.fn().mockResolvedValue({ error: UNIQUE_VIOLATION });

    await expect(withSeedRetry(op, "Failed to create trip")).rejects.toThrow(/Failed to create trip: duplicate key/);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("idempotent mode retries a 502 plainly — no 23505 tell needed", async () => {
    const op = vi.fn().mockResolvedValueOnce({ error: KONG_502 }).mockResolvedValueOnce({ error: null });

    await expect(
      runToCompletion(withSeedRetry(op, "Failed to assign play group", { idempotent: true }))
    ).resolves.toBeUndefined();
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("happy path: no retry, no backoff delay incurred", async () => {
    const op = vi.fn().mockResolvedValue({ error: null });
    const start = Date.now();

    await withSeedRetry(op, "Failed to create trip");

    expect(op).toHaveBeenCalledTimes(1);
    // No fake-timer advance needed at all — if the wrapper waited on the
    // happy path this would hang under fake timers rather than resolve.
    expect(Date.now() - start).toBeLessThan(50);
  });
});
