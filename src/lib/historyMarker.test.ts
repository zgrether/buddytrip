import { describe, it, expect, beforeEach } from "vitest";
import {
  pushMarker,
  replaceMarker,
  isOwnPop,
  readDepth,
  readOwner,
  type MarkerOwner,
} from "./historyMarker";

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
  /** Cursor, not a top-of-stack pop — the browser KEEPS forward entries after a
   *  back until something pushes. Modelling that is what makes the forward
   *  navigation test below meaningful. */
  i = 0;
  get state() {
    return this.stack[this.i].state;
  }
  pushState(state: unknown, _title: string, url?: string) {
    this.stack.length = this.i + 1; // a push truncates the forward entries
    this.stack.push({ state, url: url ?? this.stack[this.i].url });
    this.i = this.stack.length - 1;
  }
  /** Rewrite the current entry in place — no new entry, cursor unmoved. */
  replaceState(state: unknown, _title: string, url?: string) {
    this.stack[this.i] = { state, url: url ?? this.stack[this.i].url };
  }
  /** Go back, and return the popstate event — carrying the state of the entry we
   *  LAND ON, exactly as the browser does. */
  back(): { state: unknown } {
    if (this.i > 0) this.i -= 1;
    return { state: this.state };
  }
  /** Forward also fires popstate. */
  forward(): { state: unknown } {
    if (this.i < this.stack.length - 1) this.i += 1;
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

// ── The tab sentinel (Phase 2) ───────────────────────────────────────────────

describe("the tab sentinel", () => {
  /** What the trip page's `setActiveTab` does: push once, replace thereafter. */
  function switchTab(tab: string, url: string) {
    if (readOwner(fake.state) === "tab") return replaceMarker("tab", { btTab: true }, url);
    return pushMarker("tab", { btTab: true }, url);
  }

  it("costs ONE history entry for a whole excursion, not one per switch", () => {
    const before = fake.stack.length;

    switchTab("crew", "/trips/t1?tab=crew");
    expect(fake.stack.length).toBe(before + 1); // first leave of Home pushes

    switchTab("schedule", "/trips/t1?tab=schedule");
    switchTab("expenses", "/trips/t1?tab=expenses");
    expect(fake.stack.length).toBe(before + 1); // ...and nothing after that does

    // One back returns to where the excursion started, not three.
    fake.back();
    expect(fake.stack[fake.i].url).toBe("/trips/t1/leaderboard");
  });

  it("keeps a stable depth across replaces, so layers above stay comparable", () => {
    const d1 = switchTab("crew", "/trips/t1?tab=crew");
    const d2 = switchTab("expenses", "/trips/t1?tab=expenses");
    expect(d2).toBe(d1); // same entry, same position in the stack

    // A modal opened over a tab still resolves ownership correctly.
    const modal = pushMarker("modal", { modal: true });
    const e = fake.back();
    expect(isOwnPop(e, modal)).toBe(true); // modal closes...
    expect(isOwnPop(e, d2)).toBe(false); // ...and the tab does NOT change
  });

  it("a modal's pop never changes the tab, because the URL is untouched", () => {
    switchTab("crew", "/trips/t1?tab=crew");
    pushMarker("modal", { modal: true }); // modals push the SAME url
    const urlWithModalOpen = fake.stack[fake.i].url;
    fake.back();
    expect(fake.stack[fake.i].url).toBe(urlWithModalOpen); // still ?tab=crew
  });
});

// ── Lifecycle semantics Phase 2's sentinel depends on ────────────────────────

describe("reload while nested", () => {
  it("continues numbering from HISTORY, not from zero", () => {
    // Drill in, then reload. History is untouched by a reload; every hook's
    // in-memory claimed depth is gone.
    open("panel"); // 1
    open("config", { btCfg: true }); // 2
    open("modal", { modal: true }); // 3
    expect(readDepth(fake.state)).toBe(3);

    // The remounting layer pushes again. `pushMarker` reads the CURRENT entry
    // rather than a module counter, so it claims 4 — above everything already in
    // history — and its own pop is claimable.
    const afterReload = open("modal", { modal: true });
    expect(afterReload).toBe(4);
    expect(isOwnPop(fake.back(), afterReload)).toBe(true);
  });

  it("is why depth is derived per-push and not held in a module counter", () => {
    // Pins the failure mode a module-level counter would produce, so nobody
    // "simplifies" pushMarker into one later. A fresh page would restart the
    // counter at 0 and claim 1, while history still holds entries at 1..2.
    open("panel"); // 1
    open("config", { btCfg: true }); // 2

    const whatAModuleCounterWouldClaim = 1;
    const e = fake.back(); // lands on depth 1

    // 1 < 1 is false → nothing claims a real back-press → the browser navigates
    // away and the open layer is lost with the page.
    expect(isOwnPop(e, whatAModuleCounterWouldClaim)).toBe(false);
    // What the current implementation claims instead:
    expect(isOwnPop(e, 2)).toBe(true);
  });
});

describe("forward navigation", () => {
  it("is claimed by nobody — landing DEEPER is never an owner's pop", () => {
    const cfg = open("config", { btCfg: true }); // 1
    const modal = open("modal", { modal: true }); // 2

    fake.back(); // modal closes; the depth-2 entry is still ahead of us
    const e = fake.forward(); // re-enter it

    // Both tests are false because the landing depth (2) is >= every claim.
    // Nothing re-opens, which is correct: forward-into-a-layer is not a
    // supported flow — the layer's React state was already torn down on the way
    // back, so re-opening from the history entry alone would restore chrome
    // without content.
    expect(isOwnPop(e, cfg)).toBe(false);
    expect(isOwnPop(e, modal)).toBe(false);
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
