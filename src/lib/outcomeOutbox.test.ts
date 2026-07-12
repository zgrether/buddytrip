import { describe, it, expect, beforeEach } from "vitest";
import {
  putIn,
  clearIn,
  entriesOf,
  outcomeOutboxPut,
  outcomeOutboxClear,
  outcomeOutboxEntries,
  type OutcomeOutboxMap,
} from "./outcomeOutbox";

/**
 * outcomeOutbox (Refactor B2 — durable WAL, forked from scoreOutbox per the B
 * Phase-0 finding). Same test shape as scoreOutbox.test.ts, keyed by
 * matchId:holeNumber instead of participantId:unitLabel, values are the
 * HoleOutcomeResult enum instead of a number.
 */

describe("outcomeOutbox — pure map ops", () => {
  it("putIn adds a keyed entry (key = matchId:holeNumber)", () => {
    const m = putIn({}, "m1", 3, "side_a");
    expect(m).toEqual({ "m1:3": "side_a" });
  });

  it("putIn overwrites the same cell (last-write-wins)", () => {
    let m: OutcomeOutboxMap = putIn({}, "m1", 3, "side_a");
    m = putIn(m, "m1", 3, "halved");
    expect(m).toEqual({ "m1:3": "halved" });
  });

  it("clearIn removes only the target cell; no-ops when absent", () => {
    const m = { "m1:3": "side_a" as const, "m2:3": "side_b" as const };
    expect(clearIn(m, "m1", 3)).toEqual({ "m2:3": "side_b" });
    expect(clearIn(m, "mX", 9)).toBe(m); // unchanged reference when absent
  });

  it("entriesOf round-trips keys back to {matchId, holeNumber, result}", () => {
    const m = { "m1:3": "side_a" as const, "m2:12": "halved" as const };
    expect(entriesOf(m).sort((a, b) => a.matchId.localeCompare(b.matchId))).toEqual([
      { matchId: "m1", holeNumber: 3, result: "side_a" },
      { matchId: "m2", holeNumber: 12, result: "halved" },
    ]);
  });
});

describe("outcomeOutbox — localStorage wrappers", () => {
  beforeEach(() => {
    // Minimal in-memory localStorage polyfill for the node test env.
    const store = new Map<string, string>();
    (globalThis as unknown as { window: unknown; localStorage: unknown }).window = globalThis;
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  });

  it("persist → read an unconfirmed outcome", () => {
    outcomeOutboxPut("g1", "m1", 3, "side_a");
    expect(outcomeOutboxEntries("g1")).toEqual([{ matchId: "m1", holeNumber: 3, result: "side_a" }]);
  });

  it("clear-on-confirm removes the entry; emptied game clears its key", () => {
    outcomeOutboxPut("g1", "m1", 3, "side_a");
    outcomeOutboxClear("g1", "m1", 3);
    expect(outcomeOutboxEntries("g1")).toEqual([]);
  });

  it("is per-game namespaced (one game's outbox never leaks into another)", () => {
    outcomeOutboxPut("g1", "m1", 3, "side_a");
    outcomeOutboxPut("g2", "m9", 1, "halved");
    expect(outcomeOutboxEntries("g1")).toEqual([{ matchId: "m1", holeNumber: 3, result: "side_a" }]);
    expect(outcomeOutboxEntries("g2")).toEqual([{ matchId: "m9", holeNumber: 1, result: "halved" }]);
  });

  it("is namespaced SEPARATELY from the score outbox (no key collision, different NS)", () => {
    outcomeOutboxPut("g1", "m1", 3, "side_a");
    // The score outbox's storeKey would be `bt.scoreOutbox.v1:g1` — a different
    // localStorage key entirely, so a game with BOTH mid-migration data (unlikely
    // in practice, since a game is one mode) can never cross-contaminate.
    const raw = window.localStorage.getItem("bt.outcomeOutbox.v1:g1");
    expect(raw).not.toBeNull();
    expect(window.localStorage.getItem("bt.scoreOutbox.v1:g1")).toBeNull();
  });

  it("survives a simulated reload (same backing store, fresh reads)", () => {
    outcomeOutboxPut("g1", "m1", 3, "side_a");
    outcomeOutboxPut("g1", "m2", 3, "side_b");
    // A 'reload' is just another read of the same store.
    expect(outcomeOutboxEntries("g1")).toHaveLength(2);
  });
});
