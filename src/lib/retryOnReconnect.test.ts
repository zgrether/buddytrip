import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { attachReconnectTriggers, keysToRetry, RETRY_INTERVAL_MS } from "./retryOnReconnect";

/**
 * #1622 — unsynced scores retry on their own when the network is likely back.
 *
 * The suite runs in node (no DOM), so, as with the realtime registries, the
 * part with failure modes is extracted and driven directly: the triggers get
 * Node's own `EventTarget` and a fake timer, and a simulated saver stands in for
 * the status map a real saver keeps. The wiring into the three real savers is
 * pinned by a source guard at the bottom, and was exercised in the running app.
 */

/** A `document` stand-in: an EventTarget whose visibility the test sets. */
function fakeDoc(visibilityState: "visible" | "hidden") {
  const t = new EventTarget() as EventTarget & { visibilityState: string };
  t.visibilityState = visibilityState;
  return t;
}

/** A setInterval that only ticks when the test says so. */
function fakeTimers() {
  let cb: (() => void) | null = null;
  let cleared = false;
  return {
    timers: {
      setInterval: ((fn: () => void) => { cb = fn; return 1 as unknown as ReturnType<typeof setInterval>; }) as unknown as typeof setInterval,
      clearInterval: (() => { cleared = true; cb = null; }) as unknown as typeof clearInterval,
    },
    tick: () => cb?.(),
    get cleared() { return cleared; },
  };
}

describe("keysToRetry — which cells an automatic retry re-sends", () => {
  it("re-sends unsynced cells, skips refused ones, and never touches saving or saved", () => {
    const status = { "a:1": "error", "a:2": "error", "b:1": "saving", "b:2": "saved", "c:1": null };
    // a:2 was refused (a posted round): re-sending it can never succeed (#1230).
    expect(keysToRetry(status, { "a:2": "This round is posted." })).toEqual(["a:1"]);
  });

  it("with no refusals at all, every unsynced cell", () => {
    expect(keysToRetry({ "a:1": "error", "a:2": "error" }, undefined)).toEqual(["a:1", "a:2"]);
  });
});

describe("attachReconnectTriggers — when a retry is attempted", () => {
  it("the `online` event triggers", () => {
    const win = new EventTarget();
    const t = fakeTimers();
    let n = 0;
    attachReconnectTriggers({ win, doc: fakeDoc("visible"), onTrigger: () => n++, timers: t.timers });
    win.dispatchEvent(new Event("online"));
    expect(n).toBe(1);
  });

  it("the page becoming VISIBLE triggers; becoming hidden does not", () => {
    const doc = fakeDoc("hidden");
    const t = fakeTimers();
    let n = 0;
    attachReconnectTriggers({ win: new EventTarget(), doc, onTrigger: () => n++, timers: t.timers });
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(n, "still hidden").toBe(0);
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(n, "back in hand").toBe(1);
  });

  it("the interval triggers while visible and not while hidden — the case `online` never fires for", () => {
    // At one bar `navigator.onLine` can stay true while requests fail, so the
    // browser never goes `offline` and never fires `online`. The interval is
    // what catches the walk back into coverage with the screen on.
    const doc = fakeDoc("visible");
    const t = fakeTimers();
    let n = 0;
    attachReconnectTriggers({ win: new EventTarget(), doc, onTrigger: () => n++, timers: t.timers });
    t.tick();
    expect(n).toBe(1);
    doc.visibilityState = "hidden";
    t.tick();
    expect(n, "a pocketed phone does not keep retrying").toBe(1);
  });

  it("detaching stops every trigger and clears the timer", () => {
    const win = new EventTarget();
    const doc = fakeDoc("visible");
    const t = fakeTimers();
    let n = 0;
    const detach = attachReconnectTriggers({ win, doc, onTrigger: () => n++, timers: t.timers });
    detach();
    win.dispatchEvent(new Event("online"));
    doc.dispatchEvent(new Event("visibilitychange"));
    t.tick();
    expect(n).toBe(0);
    expect(t.cleared).toBe(true);
  });

  it("defaults to a 30-second interval", () => {
    expect(RETRY_INTERVAL_MS).toBe(30_000);
  });
});

describe("a simulated saver: unsynced → reconnect → synced", () => {
  /**
   * The cycle a real saver runs, with its status map and its retryCell reduced
   * to what matters here: a retry moves the cell to `saving`, and the network
   * decides whether it lands. Built from the same two functions the hook uses.
   */
  function saver(network: { up: boolean }) {
    const status: Record<string, string> = {};
    const refusals: Record<string, string> = {};
    const sent: string[] = [];
    const retryKey = (key: string) => {
      sent.push(key);
      status[key] = "saving";
    };
    const settle = () => {
      for (const k of Object.keys(status)) if (status[k] === "saving") status[k] = network.up ? "saved" : "error";
    };
    return { status, refusals, sent, retryKey, settle };
  }

  it("re-sends the unsynced score when the network returns, and it syncs", () => {
    const network = { up: false };
    const s = saver(network);
    s.status["p1:7"] = "error";
    const win = new EventTarget();
    const t = fakeTimers();
    attachReconnectTriggers({
      win, doc: fakeDoc("visible"), timers: t.timers,
      onTrigger: () => { for (const k of keysToRetry(s.status, s.refusals)) s.retryKey(k); },
    });

    network.up = true;
    win.dispatchEvent(new Event("online"));
    s.settle();
    expect(s.sent).toEqual(["p1:7"]);
    expect(s.status["p1:7"]).toBe("saved");
  });

  it("overlapping triggers send a cell ONCE: the first retry moves it to saving", () => {
    const s = saver({ up: true });
    s.status["p1:7"] = "error";
    const win = new EventTarget();
    const doc = fakeDoc("visible");
    const t = fakeTimers();
    attachReconnectTriggers({
      win, doc, timers: t.timers,
      onTrigger: () => { for (const k of keysToRetry(s.status, s.refusals)) s.retryKey(k); },
    });
    win.dispatchEvent(new Event("online"));
    doc.dispatchEvent(new Event("visibilitychange"));
    t.tick();
    expect(s.sent).toEqual(["p1:7"]);
  });

  it("a refused score is never re-sent, however often the network comes back", () => {
    const s = saver({ up: true });
    s.status["p1:7"] = "error";
    s.refusals["p1:7"] = "This round is posted.";
    const win = new EventTarget();
    const t = fakeTimers();
    attachReconnectTriggers({
      win, doc: fakeDoc("visible"), timers: t.timers,
      onTrigger: () => { for (const k of keysToRetry(s.status, s.refusals)) s.retryKey(k); },
    });
    win.dispatchEvent(new Event("online"));
    t.tick();
    expect(s.sent).toEqual([]);
  });
});

describe("source guard — every score saver retries on reconnect", () => {
  // A saver that loses the call keeps working and stops syncing on its own,
  // which no other test would notice. Each must call the hook with its own
  // status and refusals.
  const SAVERS = ["useScoreSaver.ts", "useOutcomeSaver.ts", "useSkinsSaver.ts"];
  for (const file of SAVERS) {
    it(`${file} calls useRetryOnReconnect(saveStatus, refusals, …)`, () => {
      const src = readFileSync(join(__dirname, "..", "hooks", file), "utf8");
      expect(src).toContain("useRetryOnReconnect(saveStatus, refusals, (key) => {");
    });
  }
});
