import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createGraceGate } from "./graceGate";

/**
 * #1437 — the grace window must not STRAND a cell.
 *
 * The case that failed on #1439's preview (hole 6): this device confirmed a tap,
 * the other device's conflicting write arrived 2s later — inside the grace —
 * and the cell was protected, correctly. Then nothing ever revisited it, because
 * the reconcile only re-ran when the server data changed. These pin that the
 * gate re-runs with the same snapshot once the grace ends, using the real
 * timeline rather than the code's shape (fake timers).
 */

const GRACE = 10_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-25T21:13:28Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

function recorder<S>() {
  const calls: { server: S; grace: string[] }[] = [];
  const apply = (server: S, graceKeys: ReadonlySet<string>) => {
    calls.push({ server, grace: [...graceKeys].sort() });
  };
  return { calls, apply };
}

describe("createGraceGate", () => {
  it("THE HOLE-6 CASE: a cell protected when the conflicting snapshot arrives is revisited when its grace ends", () => {
    const gate = createGraceGate<string>({ graceMs: GRACE });
    const { calls, apply } = recorder<string>();
    gate.confirm("m1:6"); // this device's losing tap, confirmed at 21:13:28

    vi.advanceTimersByTime(4_000); // the winning write's refetch lands at ~21:13:32
    gate.run("server-with-grether's-hole-6", apply);
    expect(calls).toEqual([{ server: "server-with-grether's-hole-6", grace: ["m1:6"] }]);

    // No new data will ever arrive (identical polls). Just before the grace ends: nothing.
    vi.advanceTimersByTime(GRACE - 4_000 - 1);
    expect(calls).toHaveLength(1);

    // The grace ends: the SAME snapshot is applied again, now unprotected — this is what converges.
    vi.advanceTimersByTime(2);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ server: "server-with-grether's-hole-6", grace: [] });
  });

  it("schedules nothing when no cell is in grace", () => {
    const gate = createGraceGate<string>({ graceMs: GRACE });
    const { calls, apply } = recorder<string>();
    gate.run("s", apply);
    vi.advanceTimersByTime(GRACE * 3);
    expect(calls).toEqual([{ server: "s", grace: [] }]);
  });

  it("a newer run replaces the pending rerun — it uses the LATEST snapshot and fires once", () => {
    const gate = createGraceGate<string>({ graceMs: GRACE });
    const { calls, apply } = recorder<string>();
    gate.confirm("m1:6");
    gate.run("old", apply);
    vi.advanceTimersByTime(3_000);
    gate.run("new", apply);
    vi.advanceTimersByTime(GRACE);
    expect(calls.map((c) => c.server)).toEqual(["old", "new", "new"]);
    expect(calls[2].grace).toEqual([]);
  });

  it("the rerun waits for the EARLIEST grace, and keeps re-running until none is left", () => {
    const gate = createGraceGate<string>({ graceMs: GRACE });
    const { calls, apply } = recorder<string>();
    gate.confirm("m1:5");
    vi.advanceTimersByTime(4_000);
    gate.confirm("m1:6");
    gate.run("s", apply); // both in grace; 5 ends in 6s, 6 in 10s
    vi.advanceTimersByTime(6_001);
    expect(calls[1].grace).toEqual(["m1:6"]); // 5 released first
    vi.advanceTimersByTime(4_000);
    expect(calls[2].grace).toEqual([]); // then 6
    vi.advanceTimersByTime(GRACE);
    expect(calls).toHaveLength(3); // and then it stops
  });

  it("forget releases a cell at once — a cleared hole is not protected", () => {
    const gate = createGraceGate<string>({ graceMs: GRACE });
    const { calls, apply } = recorder<string>();
    gate.confirm("m1:6");
    gate.forget("m1:6");
    gate.run("s", apply);
    expect(calls).toEqual([{ server: "s", grace: [] }]);
  });

  it("dispose cancels a pending rerun (unmount)", () => {
    const gate = createGraceGate<string>({ graceMs: GRACE });
    const { calls, apply } = recorder<string>();
    gate.confirm("m1:6");
    gate.run("s", apply);
    gate.dispose();
    vi.advanceTimersByTime(GRACE * 2);
    expect(calls).toHaveLength(1);
  });
});
