import { describe, it, expect, beforeEach } from "vitest";
import {
  putIn,
  clearIn,
  entriesOf,
  outboxPut,
  outboxClear,
  outboxEntries,
  type OutboxMap,
} from "./scoreOutbox";

/**
 * scoreOutbox (Spec 1a — durable WAL). Pure map ops are tested directly; the
 * localStorage wrappers are tested against an in-memory localStorage polyfill so
 * persist → read → clear round-trips and the per-game namespacing hold.
 */

describe("scoreOutbox — pure map ops", () => {
  it("putIn adds a keyed entry (idempotent id gameId-agnostic key = pid:unit)", () => {
    const m = putIn({}, "p1", "3", 4);
    expect(m).toEqual({ "p1:3": 4 });
  });

  it("putIn overwrites the same cell (last-write-wins)", () => {
    let m: OutboxMap = putIn({}, "p1", "3", 4);
    m = putIn(m, "p1", "3", 5);
    expect(m).toEqual({ "p1:3": 5 });
  });

  it("clearIn removes only the target cell; no-ops when absent", () => {
    const m = { "p1:3": 4, "p2:3": 5 };
    expect(clearIn(m, "p1", "3")).toEqual({ "p2:3": 5 });
    expect(clearIn(m, "pX", "9")).toBe(m); // unchanged reference when absent
  });

  it("entriesOf round-trips keys back to {participantId, unitLabel, value}", () => {
    const m = { "p1:3": 4, "p2:12": 6 };
    expect(entriesOf(m).sort((a, b) => a.participantId.localeCompare(b.participantId))).toEqual([
      { participantId: "p1", unitLabel: "3", value: 4 },
      { participantId: "p2", unitLabel: "12", value: 6 },
    ]);
  });
});

describe("scoreOutbox — localStorage wrappers", () => {
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

  it("persist → read an unconfirmed score", () => {
    outboxPut("g1", "p1", "3", 4);
    expect(outboxEntries("g1")).toEqual([{ participantId: "p1", unitLabel: "3", value: 4 }]);
  });

  it("clear-on-confirm removes the entry; emptied game clears its key", () => {
    outboxPut("g1", "p1", "3", 4);
    outboxClear("g1", "p1", "3");
    expect(outboxEntries("g1")).toEqual([]);
  });

  it("is per-game namespaced (one game's outbox never leaks into another)", () => {
    outboxPut("g1", "p1", "3", 4);
    outboxPut("g2", "p9", "1", 7);
    expect(outboxEntries("g1")).toEqual([{ participantId: "p1", unitLabel: "3", value: 4 }]);
    expect(outboxEntries("g2")).toEqual([{ participantId: "p9", unitLabel: "1", value: 7 }]);
  });

  it("survives a simulated reload (same backing store, fresh reads)", () => {
    outboxPut("g1", "p1", "3", 4);
    outboxPut("g1", "p2", "3", 5);
    // A 'reload' is just another read of the same store.
    expect(outboxEntries("g1")).toHaveLength(2);
  });
});
