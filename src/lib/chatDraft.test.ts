import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readChatDraft, writeChatDraft, clearChatDraft } from "./chatDraft";

/**
 * The unsent chat draft.
 *
 * ── What is actually under test ─────────────────────────────────────────────
 * The bug is a LOST draft, so the round-trip is the headline. But every other
 * case here is a way for persistence to be worse than the loss it replaces:
 * a draft that arrives in the wrong channel, a draft that outlives the message
 * it became, a draft that leaks between trips, or half a sentence restored from
 * a corrupt entry and offered as something you wrote.
 *
 * The suite is `environment: "node"`, so `localStorage` is stubbed — which is
 * also the honest shape for this module, since it is SSR-safe by contract and
 * that path is asserted rather than assumed.
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

const KEY = (trip: string, vis: string) => `bt.chatDraft.v1:${trip}:${vis}`;

describe("chatDraft — the draft survives the panel closing", () => {
  /**
   * The reported bug, end to end. The panel unmounts on close, so "reopen" is
   * simply a second read — the same thing the component's lazy initializer does
   * on its next mount.
   */
  it("returns what was typed", () => {
    writeChatDraft("t1", "crew", "dinner at 7?");
    expect(readChatDraft("t1", "crew")).toBe("dinner at 7?");
  });

  /**
   * Verbatim, trailing space included. Someone mid-word has a trailing space on
   * purpose, and coming back to a silently trimmed draft is a small wrongness
   * that reads as the app having edited your writing.
   */
  it("preserves the text exactly, including trailing whitespace", () => {
    writeChatDraft("t1", "crew", "  who is driving   ");
    expect(readChatDraft("t1", "crew")).toBe("  who is driving   ");
  });

  it("returns an empty string when nothing was ever typed", () => {
    expect(readChatDraft("t1", "crew")).toBe("");
  });
});

describe("chatDraft — channels are separate conversations", () => {
  /**
   * Crew and Organizers share a composer and nothing else. A draft that crossed
   * between them would be worse than losing it: a half-written Organizers note
   * arriving in the Crew tab is one Enter press from being sent to the whole
   * trip.
   */
  it("keeps a crew draft out of the organizers channel", () => {
    writeChatDraft("t1", "crew", "crew text");
    expect(readChatDraft("t1", "planning")).toBe("");
    expect(readChatDraft("t1", "crew")).toBe("crew text");
  });

  it("holds both at once without either disturbing the other", () => {
    writeChatDraft("t1", "crew", "crew text");
    writeChatDraft("t1", "planning", "organizers text");
    expect(readChatDraft("t1", "crew")).toBe("crew text");
    expect(readChatDraft("t1", "planning")).toBe("organizers text");
  });

  it("clears one channel without touching the other", () => {
    writeChatDraft("t1", "crew", "crew text");
    writeChatDraft("t1", "planning", "organizers text");
    clearChatDraft("t1", "crew");
    expect(readChatDraft("t1", "crew")).toBe("");
    expect(readChatDraft("t1", "planning")).toBe("organizers text");
  });
});

describe("chatDraft — trips are separate", () => {
  /**
   * Two trips open in two tabs is ordinary. A draft leaking between them puts
   * one trip's message in another trip's composer.
   */
  it("does not leak a draft between trips", () => {
    writeChatDraft("t1", "crew", "trip one");
    writeChatDraft("t2", "crew", "trip two");
    expect(readChatDraft("t1", "crew")).toBe("trip one");
    expect(readChatDraft("t2", "crew")).toBe("trip two");
    clearChatDraft("t1", "crew");
    expect(readChatDraft("t2", "crew")).toBe("trip two");
  });
});

describe("chatDraft — a sent message leaves nothing behind", () => {
  /**
   * The panel clears by writing `""` through `setText`, which is the single
   * write path. So the assertion that matters is that an empty write REMOVES
   * the entry rather than storing a blank one — an entry that persists as `""`
   * would be a row per channel per trip, kept forever, describing nothing.
   */
  it("removes the entry when the composer is emptied", () => {
    writeChatDraft("t1", "crew", "about to send this");
    writeChatDraft("t1", "crew", "");
    expect(readChatDraft("t1", "crew")).toBe("");
    expect(store._raw.has(KEY("t1", "crew"))).toBe(false);
  });

  /** A composer holding only whitespace is an empty composer. */
  it("treats a whitespace-only draft as empty and stores nothing", () => {
    writeChatDraft("t1", "crew", "   \n  ");
    expect(store._raw.has(KEY("t1", "crew"))).toBe(false);
    expect(readChatDraft("t1", "crew")).toBe("");
  });
});

describe("chatDraft — a corrupt entry is discarded, never partially restored", () => {
  /**
   * HALF A SENTENCE IS WORSE THAN NONE. An empty composer is obviously empty;
   * a fragment reads as something you typed and forgot, and it is one tap from
   * being sent. Every rejection below therefore asserts the exact empty string,
   * not merely falsy.
   */
  const corrupt: Array<[string, string]> = [
    ["not JSON at all", "half a senten"],
    ["JSON, but not an object", '"half a sentence"'],
    ["null", "null"],
    ["an array", '["half a sentence"]'],
    ["a future schema version", '{"v":2,"text":"half a sentence"}'],
    ["no version tag", '{"text":"half a sentence"}'],
    ["text of the wrong type", '{"v":1,"text":{"0":"half a sentence"}}'],
    ["text missing entirely", '{"v":1}'],
    ["text as a number", '{"v":1,"text":42}'],
  ];

  it.each(corrupt)("discards %s", (_label, raw) => {
    store.setItem(KEY("t1", "crew"), raw);
    expect(readChatDraft("t1", "crew")).toBe("");
  });

  /**
   * The stored fragment must not reach the caller by ANY path — asserted
   * against the text itself rather than against the return value's shape, so a
   * future change that starts salvaging "whatever string it can find" fails
   * here instead of shipping.
   */
  it.each(corrupt)("never returns the fragment from %s", (_label, raw) => {
    store.setItem(KEY("t1", "crew"), raw);
    expect(readChatDraft("t1", "crew")).not.toContain("half a sentence");
  });
});

describe("chatDraft — bounded, and never throws into chat", () => {
  /** Matches `messages.send`'s 5000-char ceiling: a longer draft is unsendable. */
  it("caps what it stores at the server's message limit", () => {
    writeChatDraft("t1", "crew", "x".repeat(6000));
    expect(readChatDraft("t1", "crew").length).toBe(5000);
  });

  /** An oversized entry from another build still comes back usable. */
  it("truncates an oversized stored entry rather than discarding it", () => {
    store.setItem(KEY("t1", "crew"), JSON.stringify({ v: 1, text: "y".repeat(9000) }));
    expect(readChatDraft("t1", "crew").length).toBe(5000);
  });

  /**
   * Storage can be disabled or full. A draft is a convenience; it must never be
   * able to break the composer it belongs to.
   */
  it("survives a storage that throws on every operation", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
        removeItem: () => {
          throw new Error("SecurityError");
        },
      },
    });
    expect(() => writeChatDraft("t1", "crew", "text")).not.toThrow();
    expect(() => clearChatDraft("t1", "crew")).not.toThrow();
    expect(readChatDraft("t1", "crew")).toBe("");
  });

  /** SSR-safe by contract — asserted, not assumed. */
  it("is inert with no window", () => {
    vi.stubGlobal("window", undefined);
    expect(() => writeChatDraft("t1", "crew", "text")).not.toThrow();
    expect(readChatDraft("t1", "crew")).toBe("");
  });
});
