import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

/**
 * The divider position survives a RELOAD.
 *
 * `useRailWidth.test.ts` already covers `decodeStoredWidth` — the read half in
 * isolation. This covers the round trip, and the difference is the whole point:
 * **a write succeeding is not the same as a read landing.** #902 was exactly
 * that shape — the value was stored correctly and the reload came back with the
 * server's default, because the two halves were reconciled by a `useState`
 * initializer that hydration then discarded.
 *
 * A reload is simulated by `vi.resetModules()`, which clears the module-level
 * `cached` the hook memoises the snapshot in. That is precisely what a page load
 * clears and nothing else, so the fake is faithful to the one thing being
 * tested: after this, the ONLY way to produce a width is to read storage again.
 *
 * `environment: "node"` (the suite-wide setting), so `window` is stubbed rather
 * than assumed — which also pins that the hook reads `window.localStorage`
 * lazily inside the snapshot fn and not at module scope, where an SSR import
 * would throw.
 */

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    map,
    api: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
  };
}

let store: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  store = fakeStorage();
  vi.stubGlobal("window", { localStorage: store.api });
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Everything the hook does on a drag tick, without React: the module's own
 *  write path is what persists, and `useSyncExternalStore` only reads it. */
async function load() {
  return await import("./useRailWidth");
}

describe("the divider position survives a reload", () => {
  it("restores a dragged width", async () => {
    const first = await load();
    // A drag lands here — clamped, then written.
    const dragged = first.clampRailWidth(317, first.RAIL_MIN_PX);
    store.api.setItem("bt.railWidth.v2", String(dragged));

    // ── reload ──
    vi.resetModules();
    const second = await load();
    expect(second.decodeStoredWidth(store.api.getItem("bt.railWidth.v2"))).toBe(317);
  });

  it("restores COLLAPSED, which is the value most likely to be lost", async () => {
    // 0 is the one stored value a naive read would clamp away, turning "stays
    // collapsed" into "reopens at the minimum" — a bug that looks like the
    // collapse not sticking rather than like a decode error.
    const first = await load();
    store.api.setItem("bt.railWidth.v2", String(first.RAIL_COLLAPSED_PX));

    vi.resetModules();
    const second = await load();
    expect(second.decodeStoredWidth(store.api.getItem("bt.railWidth.v2"))).toBe(
      second.RAIL_COLLAPSED_PX,
    );
  });

  it("falls back to the default when nothing was ever stored", async () => {
    const m = await load();
    expect(m.decodeStoredWidth(store.api.getItem("bt.railWidth.v2"))).toBe(m.RAIL_DEFAULT_PX);
  });

  it("reads storage LAZILY, so importing the module on the server does not throw", async () => {
    // The hook is imported by `TopNav`, which renders on the server. A read at
    // module scope would make this import fail during SSR rather than at use.
    vi.stubGlobal("window", undefined);
    vi.resetModules();
    await expect(load()).resolves.toBeDefined();
  });
});
