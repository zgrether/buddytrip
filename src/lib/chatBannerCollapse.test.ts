import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { hasSeenChatBanner, markChatBannerSeen } from "./chatBannerCollapse";

/**
 * The channel-banner collapse flag.
 *
 * ── What is actually under test ──────────────────────────────────────────
 * Not "does it remember a boolean" — the interesting property is that the
 * READ never inspects the stored VALUE, only its presence. That is what makes
 * "corrupt stored value → collapsed, no crash" true by construction: there is
 * no `JSON.parse` in the read path for a corrupt value to break.
 */

function makeStore() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    _raw: map,
  };
}

let store: ReturnType<typeof makeStore>;

beforeEach(() => {
  store = makeStore();
  vi.stubGlobal("window", { localStorage: store });
});
afterEach(() => vi.unstubAllGlobals());

const KEY = (trip: string, vis: string) => `bt.chatBannerSeen.v1:${trip}:${vis}`;

describe("chatBannerCollapse — expand on first view, collapse after", () => {
  it("has not been seen before anything is written", () => {
    expect(hasSeenChatBanner("t1", "planning")).toBe(false);
  });

  it("is seen once marked, and stays seen across a fresh read", () => {
    markChatBannerSeen("t1", "planning");
    expect(hasSeenChatBanner("t1", "planning")).toBe(true);
    expect(hasSeenChatBanner("t1", "planning")).toBe(true); // reload, effectively
  });

  it("marking twice is harmless", () => {
    markChatBannerSeen("t1", "planning");
    markChatBannerSeen("t1", "planning");
    expect(hasSeenChatBanner("t1", "planning")).toBe(true);
  });
});

describe("chatBannerCollapse — Crew and Organizers collapse independently", () => {
  it("marking planning seen does not mark crew seen", () => {
    markChatBannerSeen("t1", "planning");
    expect(hasSeenChatBanner("t1", "planning")).toBe(true);
    expect(hasSeenChatBanner("t1", "crew")).toBe(false);
  });

  it("both channels can be independently seen", () => {
    markChatBannerSeen("t1", "planning");
    markChatBannerSeen("t1", "crew");
    expect(hasSeenChatBanner("t1", "planning")).toBe(true);
    expect(hasSeenChatBanner("t1", "crew")).toBe(true);
  });
});

describe("chatBannerCollapse — trips are separate", () => {
  it("does not leak seen-state between trips", () => {
    markChatBannerSeen("t1", "planning");
    expect(hasSeenChatBanner("t2", "planning")).toBe(false);
  });
});

describe("chatBannerCollapse — corrupt storage never crashes, and collapses", () => {
  /**
   * THE ASSERTION THIS FILE EXISTS FOR. Any value at all — well-formed,
   * garbage, or a shape from a future version — reads as "seen", because the
   * read never parses it. Collapsed is the safe direction here (see the
   * module header): the cost of being wrong is "shows the explainer once
   * more", never a crash and never a half-rendered banner.
   */
  const corrupt: Array<[string, string]> = [
    ["not JSON at all", "{{{not json"],
    ["a bare string", '"hello"'],
    ["null", "null"],
    ["an array", "[1,2,3]"],
    ["a future schema version", '{"v":99,"unexpectedShape":true}'],
    ["an empty string", ""],
  ];

  it.each(corrupt)("still reads as seen (collapsed) for %s", (_label, raw) => {
    // "" is indistinguishable from absent via getItem in a real browser (both
    // getItem calls return "" only if literally stored, which is exercised
    // here directly against the fake store rather than relying on that quirk).
    store._raw.set(KEY("t1", "planning"), raw);
    expect(() => hasSeenChatBanner("t1", "planning")).not.toThrow();
    expect(hasSeenChatBanner("t1", "planning")).toBe(true);
  });
});

describe("chatBannerCollapse — storage failures fall toward collapsed", () => {
  it("a throwing getItem reads as seen (collapsed), not as first-view", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
    });
    expect(() => hasSeenChatBanner("t1", "planning")).not.toThrow();
    expect(hasSeenChatBanner("t1", "planning")).toBe(true);
    expect(() => markChatBannerSeen("t1", "planning")).not.toThrow();
  });

  it("is inert with no window (SSR) and answers false, not seen", () => {
    vi.stubGlobal("window", undefined);
    expect(hasSeenChatBanner("t1", "planning")).toBe(false);
    expect(() => markChatBannerSeen("t1", "planning")).not.toThrow();
  });
});
