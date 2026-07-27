import { describe, it, expect, beforeEach } from "vitest";
import { pushMarker, isOwnPop, readDepth, type MarkerOwner } from "./historyMarker";

/**
 * Ownership of a `popstate`, per listener.
 *
 * WHAT THIS PINS. Three hooks push phantom history entries so the back button
 * closes an in-page layer — `useScreenHistory`, `useModalBackButton`,
 * `useGameSettingsOverlay` — plus the game panel / scorecard overlay. Before
 * this, each listener acted on ANY `popstate` without checking the popped entry
 * was theirs, so the wrong layer consumed the event (NAV_AUDIT_2.md §5.4). The
 * four-tab shell's sentinel entry would have walked straight into it.
 *
 * WHY THE TESTS LOOK LIKE THIS. The suite runs `environment: "node"`
 * (vitest.config.mts) — there is no DOM and no renderer, so the hooks cannot be
 * mounted. Instead a faithful fake of the browser history STACK is driven
 * through the exact push/pop sequences each listener performs, and the listener's
 * real guard (`isOwnPop` against the depth it claimed) is asserted. The fake
 * reproduces the property the whole design turns on:
 *
 *     popstate's `event.state` is the entry you land ON, not the one popped.
 *
 * That is why a boolean tag cannot work and the depth exists. A test that let
 * `event.state` describe the popped entry would pass against a broken
 * implementation, so the fake is the load-bearing part here.
 */

// ── A faithful fake of the browser history stack ─────────────────────────────
type Entry = { state: unknown; url: string };

class FakeHistory {
  stack: Entry[] = [{ state: null, url: "/trips/t1/leaderboard" }];
  get state() {
    return this.stack[this.stack.length - 1].state;
  }
  pushState(state: unknown, _title: string, url?: string) {
    this.stack.push({ state, url: url ?? this.stack[this.stack.length - 1].url });
  }
  /** Pop, and return the popstate event — carrying the state of the entry we
   *  LAND ON, exactly as the browser does. */
  back(): { state: unknown } {
    if (this.stack.length > 1) this.stack.pop();
    return { state: this.state };
  }
}

let fake: FakeHistory;

beforeEach(() => {
  fake = new FakeHistory();
  (globalThis as unknown as { window: unknown }).window = { history: fake };
});

/** Push as a given owner and keep the depth it claimed, like the hooks do. */
function open(owner: MarkerOwner, extra?: Record<string, unknown>) {
  return pushMarker(owner, extra);
}

describe("readDepth", () => {
  it("treats anything we did not tag as depth 0 — below every marker", () => {
    // A Next router entry, the initial document, a bare pushState(null).
    expect(readDepth(null)).toBe(0);
    expect(readDepth(undefined)).toBe(0);
    expect(readDepth({ __NA: "next-internal" })).toBe(0);
    expect(readDepth({ btDepth: "3" })).toBe(0); // wrong type, not trusted
    expect(readDepth({ btDepth: 3 })).toBe(3);
  });
});

describe("pushMarker", () => {
  it("numbers entries monotonically from the entry currently on top", () => {
    expect(open("config")).toBe(1);
    expect(open("modal")).toBe(2);
    expect(open("screen")).toBe(3);
  });

  it("re-derives depth after a back, so a truncated forward stack renumbers", () => {
    open("config"); // 1
    open("modal"); // 2
    fake.back(); // back to the config entry
    // The modal entry is gone; the next push must reclaim 2, not jump to 3.
    expect(open("screen")).toBe(2);
  });

  it("preserves each hook's legacy state key", () => {
    open("config", { btCfg: true });
    expect((fake.state as { btCfg?: boolean }).btCfg).toBe(true);
    open("modal", { modal: true });
    expect((fake.state as { modal?: boolean }).modal).toBe(true);
  });
});

// ── Per-listener: a foreign entry above me is NOT my pop ─────────────────────

describe("useGameSettingsOverlay — ignores a foreign pop", () => {
  it("does not close when a TAB SENTINEL above it is popped", () => {
    // This is the exact §5.4 scenario the four-tab shell would have hit.
    const cfg = open("config", { btCfg: true });
    open("screen"); // stand-in for the tab sentinel — any entry above the overlay

    const e = fake.back(); // pops the sentinel, lands on the config entry
    expect(isOwnPop(e, cfg)).toBe(false); // → overlay stays open, event passes through
  });

  it("DOES close when its own entry is popped", () => {
    const cfg = open("config", { btCfg: true });
    const e = fake.back();
    expect(isOwnPop(e, cfg)).toBe(true);
  });

  it("does not close when the game panel below it is still there", () => {
    open("panel"); // ?game= — pushed BEFORE the overlay
    const cfg = open("config", { btCfg: true });

    const e = fake.back(); // pops the overlay, lands on the panel entry
    expect(isOwnPop(e, cfg)).toBe(true); // ours: we landed below our marker
  });
});

describe("useModalBackButton — ignores a foreign pop", () => {
  it("does not close when an in-page SCREEN above it is popped", () => {
    const modal = open("modal", { modal: true });
    open("screen", { btScreen: 1 });

    const e = fake.back();
    expect(isOwnPop(e, modal)).toBe(false);
  });

  it("distinguishes NESTED modals, which a boolean tag cannot", () => {
    // Both entries carry `{modal:true}`. Only depth tells them apart — this is
    // the case that proves the tag alone is insufficient.
    const outer = open("modal", { modal: true });
    const inner = open("modal", { modal: true });

    const e = fake.back(); // inner closes
    expect(isOwnPop(e, inner)).toBe(true); // inner: mine
    expect(isOwnPop(e, outer)).toBe(false); // outer: not mine, stay open
    // And the naive boolean check would have been wrong for BOTH:
    expect((e.state as { modal?: boolean }).modal).toBe(true);
  });
});

describe("useScreenHistory — ignores a foreign pop", () => {
  it("does not pop a screen level when the SETTINGS OVERLAY above it is popped", () => {
    const s1 = open("screen", { btScreen: 1 });
    open("config", { btCfg: true });

    const e = fake.back();
    expect(isOwnPop(e, s1)).toBe(false);
  });

  it("steps one level at a time through its own nested screens", () => {
    const s1 = open("screen", { btScreen: 1 });
    const s2 = open("screen", { btScreen: 2 });

    const e2 = fake.back();
    expect(isOwnPop(e2, s2)).toBe(true); // top level is ours
    expect(isOwnPop(e2, s1)).toBe(false); // ...and only ONE level goes

    const e1 = fake.back();
    expect(isOwnPop(e1, s1)).toBe(true);
  });
});

describe("the interleaving that was actually broken", () => {
  it("settings overlay under a panel-pushed entry survives that entry's pop", () => {
    // Regression for the concrete bug: an UNTAGGED panel push (the old
    // `pushState(null, …)`) read as depth 0, so the overlay below it thought it
    // sat above the landing entry and closed. Tagging the panel push fixes it.
    const cfg = open("config", { btCfg: true });
    open("panel"); // ?scorecard= over the top
    open("modal", { modal: true }); // and a sheet over that

    const e = fake.back(); // sheet closes, we land on the panel entry
    expect(isOwnPop(e, cfg)).toBe(false); // overlay must NOT claim this
  });

  it("each layer unwinds in order, one back-press each", () => {
    const cfg = open("config", { btCfg: true });
    const panel = open("panel");
    const modal = open("modal", { modal: true });

    const e1 = fake.back();
    expect([isOwnPop(e1, modal), isOwnPop(e1, panel), isOwnPop(e1, cfg)]).toEqual([
      true,
      false,
      false,
    ]);

    const e2 = fake.back();
    expect([isOwnPop(e2, panel), isOwnPop(e2, cfg)]).toEqual([true, false]);

    const e3 = fake.back();
    expect(isOwnPop(e3, cfg)).toBe(true);
  });
});
