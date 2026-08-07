import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  coalesceInvalidation,
  COALESCE_WINDOW_MS,
  __resetInvalidationCoalescer,
} from "./invalidationCoalescer";

/**
 * The coalescer's OWN failure modes, separate from how the score-events hook
 * uses it. This is a blast-radius cap that runs during exactly the conditions
 * nobody is watching — a storm — so the properties that matter are the ones a
 * casual reading assumes and does not check.
 */

beforeEach(() => {
  vi.useFakeTimers();
  __resetInvalidationCoalescer();
});
afterEach(() => {
  __resetInvalidationCoalescer();
  vi.useRealTimers();
});

describe("invalidationCoalescer", () => {
  it("runs queued work once the window closes, not before", () => {
    const run = vi.fn();
    coalesceInvalidation("k", run);
    expect(run).not.toHaveBeenCalled();

    vi.advanceTimersByTime(COALESCE_WINDOW_MS - 1);
    expect(run).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("collapses many enqueues of the SAME key into one run", () => {
    const run = vi.fn();
    for (let i = 0; i < 500; i++) coalesceInvalidation("k", run);
    vi.advanceTimersByTime(COALESCE_WINDOW_MS);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("keeps DIFFERENT keys as separate work", () => {
    const a = vi.fn();
    const b = vi.fn();
    coalesceInvalidation("a", a);
    coalesceInvalidation("b", b);
    vi.advanceTimersByTime(COALESCE_WINDOW_MS);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  /**
   * THE STARVATION PROPERTY — why this is a fixed window and not a resetting
   * debounce. A debounce that restarts on every event never fires while events
   * keep arriving, which is precisely the storm condition: the flood would turn
   * into silence, and the board would stop updating exactly when it matters.
   */
  it("still flushes under a SUSTAINED stream — a fixed window cannot be starved", () => {
    const run = vi.fn();
    // An event every 10ms for ten windows' worth of time.
    for (let t = 0; t < COALESCE_WINDOW_MS * 10; t += 10) {
      coalesceInvalidation("k", run);
      vi.advanceTimersByTime(10);
    }
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(9);
    // ...and bounded: roughly one per window, not one per event (100 events).
    expect(run.mock.calls.length).toBeLessThanOrEqual(12);
  });

  it("bounds added latency at one window, however long the stream runs", () => {
    const at: number[] = [];
    let now = 0;
    for (let i = 0; i < 50; i++) {
      coalesceInvalidation("k", () => at.push(now));
      vi.advanceTimersByTime(5);
      now += 5;
    }
    vi.advanceTimersByTime(COALESCE_WINDOW_MS);
    // Every flush landed within a window of the enqueue that opened it.
    expect(at.length).toBeGreaterThan(0);
    for (let i = 1; i < at.length; i++) {
      expect(at[i] - at[i - 1]).toBeLessThanOrEqual(COALESCE_WINDOW_MS + 5);
    }
  });

  it("one throwing task does not strand the rest of the batch", () => {
    const ok = vi.fn();
    coalesceInvalidation("bad", () => {
      throw new Error("invalidate blew up");
    });
    coalesceInvalidation("good", ok);
    expect(() => vi.advanceTimersByTime(COALESCE_WINDOW_MS)).not.toThrow();
    expect(ok).toHaveBeenCalledTimes(1);
  });

  /**
   * A task may synchronously enqueue more work (an invalidation can settle a
   * query that triggers another). That belongs to the NEXT window — if the drain
   * read the live map it could loop forever inside one flush.
   */
  it("work enqueued DURING a flush lands in the next window, not this one", () => {
    const second = vi.fn();
    let enqueued = false;
    coalesceInvalidation("first", () => {
      if (enqueued) return;
      enqueued = true;
      coalesceInvalidation("second", second);
    });

    vi.advanceTimersByTime(COALESCE_WINDOW_MS);
    expect(second).not.toHaveBeenCalled();

    vi.advanceTimersByTime(COALESCE_WINDOW_MS);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("the last enqueue for a key wins", () => {
    const stale = vi.fn();
    const fresh = vi.fn();
    coalesceInvalidation("k", stale);
    coalesceInvalidation("k", fresh);
    vi.advanceTimersByTime(COALESCE_WINDOW_MS);
    expect(stale).not.toHaveBeenCalled();
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it("goes idle after flushing — no timer left spinning on an empty queue", () => {
    const run = vi.fn();
    coalesceInvalidation("k", run);
    vi.advanceTimersByTime(COALESCE_WINDOW_MS);
    expect(run).toHaveBeenCalledTimes(1);

    // Nothing further should fire, and a later enqueue must still work.
    vi.advanceTimersByTime(COALESCE_WINDOW_MS * 5);
    expect(run).toHaveBeenCalledTimes(1);

    coalesceInvalidation("k", run);
    vi.advanceTimersByTime(COALESCE_WINDOW_MS);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
