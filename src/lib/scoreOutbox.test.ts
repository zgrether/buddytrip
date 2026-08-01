import { describe, it, expect, beforeEach } from "vitest";
import {
  putIn,
  clearIn,
  entriesOf,
  outboxPut,
  outboxClear,
  outboxEntries,
  outboxClearAll,
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

// ── #744: the outbox across a game swap in the board's pane ─────────────────
// At `lg+` the board is `[game list | game pane]` and the list stays interactive,
// so `?game=` can move A→B without a route change. The pane is now KEYED by the
// game id (`gamePanelView`), so a swap unmounts the old view and mounts a fresh
// one — which is what re-runs `useScoreSaver`'s recover-on-mount against the NEW
// game. These lock the store semantics that recovery depends on.
describe("scoreOutbox — survives a keyed remount on a game swap (#744)", () => {
  beforeEach(() => {
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

  /**
   * THE HAZARD THAT DECIDED THE FIX. A participant id for a 1v1 side IS a user id,
   * and two match games in one competition share their users — so "same cell key,
   * different game" is the NORMAL case here, not a corner. The outbox is namespaced
   * by game, so an unconfirmed 4 on game A's hole 3 for user U must not be visible
   * as game B's hole 3 for user U.
   *
   * This is precisely what a live-derived `gameId` would NOT have protected: the
   * outbox would have been fine, but the in-memory `values` map (keyed by the same
   * user id, and spread OVER the server snapshot by `mergedFor`) would have carried
   * game A's score onto game B's card. The remount is what clears that.
   */
  it("the same user id in two games does not cross over", () => {
    outboxPut("game-a", "user-U", "3", 4);
    outboxPut("game-b", "user-U", "3", 6);
    expect(outboxEntries("game-a")).toEqual([{ participantId: "user-U", unitLabel: "3", value: 4 }]);
    expect(outboxEntries("game-b")).toEqual([{ participantId: "user-U", unitLabel: "3", value: 6 }]);
  });

  it("an unconfirmed cell on game A survives a swap to B and is still there on return", () => {
    outboxPut("game-a", "user-U", "7", 5); // typed, never confirmed
    // Swap to B: the pane remounts and recovers against B, which has nothing pending.
    expect(outboxEntries("game-b")).toEqual([]);
    // Swap back to A: the remount recovers A's survivor, unchanged.
    expect(outboxEntries("game-a")).toEqual([{ participantId: "user-U", unitLabel: "7", value: 5 }]);
  });

  /**
   * A save that CONFIRMS after its view unmounted still clears the right game's
   * entry: `outboxClear` is a module-level function closing over the gameId passed
   * to `useScoreSaver`, not component state, so the in-flight `mutateAsync().then()`
   * clears game A even though the pane now shows B. Only the `setSaveStatus` UI
   * update is dropped (React 18 no-ops a setState on an unmounted component).
   */
  it("a confirm landing after the swap clears the ORIGINATING game, not the visible one", () => {
    outboxPut("game-a", "user-U", "7", 5);
    outboxPut("game-b", "user-U", "7", 9);
    outboxClear("game-a", "user-U", "7"); // A's in-flight save confirms post-swap
    expect(outboxEntries("game-a")).toEqual([]);
    expect(outboxEntries("game-b")).toEqual([{ participantId: "user-U", unitLabel: "7", value: 9 }]);
  });
});

describe("outboxClearAll — the Danger-zone reset", () => {
  it("wipes the whole game's outbox, so a reset is not undone on remount", () => {
    // Without this, `outboxEntries` re-sends the survivors on the next mount and
    // quietly re-creates the scores the reset just deleted.
    outboxPut("g1", "p1", "1", 4);
    outboxPut("g1", "p2", "1", 5);
    expect(outboxEntries("g1")).toHaveLength(2);

    outboxClearAll("g1");
    expect(outboxEntries("g1")).toEqual([]);
  });

  it("leaves other games alone", () => {
    outboxPut("g1", "p1", "1", 4);
    outboxPut("g2", "p1", "1", 4);
    outboxClearAll("g1");
    expect(outboxEntries("g1")).toEqual([]);
    expect(outboxEntries("g2")).toHaveLength(1);
  });
});
