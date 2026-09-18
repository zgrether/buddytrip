import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { isTerminalRefusal } from "../lib/terminalRefusal";

/**
 * THE CLIENT HALF OF THE SCORE-WRITE CARVE-OUT (#1258) — as a SOURCE GUARD, and
 * this file says so rather than implying coverage it does not have.
 *
 * The property: when a score write fails transiently — which is what an 8s
 * per-call abort produces — the entered value stays on screen and the durable
 * outbox entry survives, so the next mount re-sends it through the idempotent
 * upsert. The database half of that is pinned behaviourally in
 * `scores.abortSafety.test.ts`, against a real Postgres.
 *
 * ── Why a source guard here ────────────────────────────────────────────────
 *
 * `useScoreSaver` is a React hook. This suite runs in `environment: "node"`
 * with no renderer installed (no @testing-library/react, no jsdom), so the hook
 * cannot be driven. The options were: add a renderer and a browser environment
 * for one test, re-implement the hook's decision inside the test (which tests
 * the copy, not the code), or read the source and pin the three structural
 * facts the property rests on. This is the third.
 *
 * WHAT IT CANNOT SEE: whether the hook is actually mounted anywhere, whether
 * the callback fires, or the rendered result. It reads text. Treat it as a
 * tripwire on a deliberate ordering, not as proof the behaviour happens.
 */

const SRC = readFileSync(join(__dirname, "useScoreSaver.ts"), "utf8");

/** The `.catch` arm of the save — everything from the catch to the end of the callback. */
function catchArm(): string {
  const start = SRC.indexOf(".catch((err: unknown) => {");
  expect(start, "the save's catch arm moved — this guard is reading the wrong region").toBeGreaterThan(-1);
  const end = SRC.indexOf("});", start);
  return SRC.slice(start, end);
}

describe("an aborted score write keeps the value and the outbox entry (source guard)", () => {
  it("the outbox is written BEFORE the mutation is sent, not after it settles", () => {
    // Layer 2's whole point: a nav, reload or kill in the gap cannot lose the
    // score. If this ordering flipped, an abort would leave nothing to re-send.
    const put = SRC.indexOf("outboxPut(gameId, participantId, unitLabel, value)");
    const send = SRC.indexOf("upsertEntry\n        .mutateAsync(");
    expect(put).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(-1);
    expect(put, "outboxPut must precede the write it protects").toBeLessThan(send);
  });

  it("a failure marks the cell and does NOT roll the value back", () => {
    const arm = catchArm();
    expect(arm).toContain('mark(key, "error")');
    // The rollback that must never appear: restoring the pre-edit value would
    // erase what the person typed on a failure they can retry.
    expect(arm).not.toMatch(/setValues\s*\(/);
  });

  it("the outbox entry is dropped ONLY for a terminal refusal — never unconditionally", () => {
    const arm = catchArm();
    // An abort surfaces as INTERNAL_SERVER_ERROR, which is not terminal (see
    // the behavioural assertion below), so this branch must not be taken for it.
    expect(arm).toMatch(/if\s*\(isTerminalRefusal\(err\)\)\s*outboxClear\(/);
    const clears = [...arm.matchAll(/outboxClear\(/g)].length;
    expect(clears, "outboxClear appears more than once in the failure arm — one of them is unguarded").toBe(1);
  });

  it("…and the classification that branch depends on treats an abort as transient", () => {
    // Behavioural, not textual: the predicate itself, with the shape an aborted
    // Supabase call produces inside the procedure.
    expect(isTerminalRefusal({ data: { code: "INTERNAL_SERVER_ERROR" }, message: "Failed to save score: The operation was aborted" })).toBe(false);
  });
});
