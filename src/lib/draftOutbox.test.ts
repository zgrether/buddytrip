import { describe, it, expect, beforeEach } from "vitest";
import {
  draftOutboxPut,
  draftOutboxClear,
  draftOutboxRecover,
  draftOutboxPeek,
} from "./draftOutbox";

/**
 * draftOutbox (Wave 1 pairings — hard-teardown durability). Tested against an
 * in-memory localStorage polyfill (node env), mirroring scoreOutbox.test. The
 * headline behaviours: a whole-draft snapshot round-trips; recover restores ONLY
 * when the base fingerprint still matches the server (no stale-over-newer
 * clobber); per-(view, game) namespacing keeps match and rack drafts separate.
 */

describe("draftOutbox — localStorage snapshot + no-clobber recover", () => {
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

  const DRAFT = [{ matchNumber: 1, playersPerSide: 2, a: ["u1", "u2"], b: ["u3", "u4"], handicap: 0 }];

  it("put → recover returns the stored draft when the server is unchanged (base matches)", () => {
    draftOutboxPut("match", "g1", DRAFT, "BASE_FP", 111);
    expect(draftOutboxRecover("match", "g1", "BASE_FP")).toEqual(DRAFT);
  });

  it("recover returns null AND clears when the server moved on (base mismatch — no clobber)", () => {
    draftOutboxPut("match", "g1", DRAFT, "BASE_FP", 111);
    // A different current server fingerprint = someone else persisted since.
    expect(draftOutboxRecover("match", "g1", "NEWER_FP")).toBeNull();
    // Stale entry is dropped, so a later matching-base recover can't resurrect it.
    expect(draftOutboxPeek("match", "g1")).toBeNull();
  });

  it("recover on an empty store is null (nothing to restore)", () => {
    expect(draftOutboxRecover("match", "g1", "ANY")).toBeNull();
  });

  it("clear drops the entry (durable persist / discard)", () => {
    draftOutboxPut("rack", "g1", [["u1", "u2"]], "B", 1);
    draftOutboxClear("rack", "g1");
    expect(draftOutboxPeek("rack", "g1")).toBeNull();
  });

  it("is namespaced per (view, gameId) — match and rack drafts never collide", () => {
    draftOutboxPut("match", "g1", DRAFT, "MB", 1);
    draftOutboxPut("rack", "g1", [["u9"]], "RB", 2);
    draftOutboxPut("match", "g2", [{ matchNumber: 1, playersPerSide: 1, a: ["x"], b: ["y"], handicap: 0 }], "MB2", 3);
    expect(draftOutboxRecover("match", "g1", "MB")).toEqual(DRAFT);
    expect(draftOutboxRecover("rack", "g1", "RB")).toEqual([["u9"]]);
    expect(draftOutboxRecover("match", "g2", "MB2")).toEqual([{ matchNumber: 1, playersPerSide: 1, a: ["x"], b: ["y"], handicap: 0 }]);
  });

  it("stores incomplete drafts too (a half-built pairing survives teardown)", () => {
    const incomplete = [{ matchNumber: 1, playersPerSide: 2, a: ["u1"], b: [], handicap: 0 }];
    draftOutboxPut("match", "g1", incomplete, "B", 1);
    expect(draftOutboxRecover("match", "g1", "B")).toEqual(incomplete);
  });

  it("last put wins (the latest teardown snapshot is what recovers)", () => {
    draftOutboxPut("match", "g1", DRAFT, "B", 1);
    const later = [{ matchNumber: 1, playersPerSide: 2, a: ["u1", "u2"], b: ["u3", "u9"], handicap: 2 }];
    draftOutboxPut("match", "g1", later, "B", 2);
    expect(draftOutboxRecover("match", "g1", "B")).toEqual(later);
  });

  it("survives a simulated reload (same backing store, fresh read)", () => {
    draftOutboxPut("rack", "g5", [["a", "b"], ["c"]], "FP", 1);
    // A reload is just another read of the same store.
    expect(draftOutboxRecover("rack", "g5", "FP")).toEqual([["a", "b"], ["c"]]);
  });
});
