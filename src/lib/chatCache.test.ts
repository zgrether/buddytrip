import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { readChatCache, writeChatCache, clearChatCache, type CachedMessage } from "./chatCache";
import { CHAT_PAGE_SIZE } from "@/components/chatPaging";

/**
 * The chat cache, with particular attention to the ways it must FAIL.
 *
 * ── The distinction this module exists to protect ──────────────────────────
 * `null` and `[]` mean different things and must never be confused: null is "no
 * usable cache", which makes the panel render its loading placeholder, while
 * `[]` would render the "No messages yet" card. Every rejection path below is
 * asserted to return NULL specifically, not merely falsy — `expect(x).toBeFalsy()`
 * would pass for `[]` and let exactly the collapse this guards against through.
 *
 * The suite is `environment: "node"`, so `localStorage` is stubbed. That is also
 * the honest shape for this module: it is SSR-safe by contract, and the
 * no-window path is asserted rather than assumed.
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

const msg = (i: number): CachedMessage => ({
  id: `m${i}`,
  trip_id: "t1",
  user_id: "u1",
  channel: "trip",
  team_id: null,
  text: `message ${i}`,
  created_at: new Date(Date.parse("2026-01-01T00:00:00Z") + i * 1000).toISOString(),
  visibility: "crew",
  message_type: "user",
});

const KEY = "bt.chatCache.v1:t1:crew";

describe("chatCache — round trip", () => {
  it("returns what was written, in order", () => {
    writeChatCache("t1", "crew", [msg(3), msg(2), msg(1)]);
    const out = readChatCache("t1", "crew");
    expect(out?.map((m) => m.id)).toEqual(["m3", "m2", "m1"]);
  });

  it("keeps channels separate", () => {
    writeChatCache("t1", "crew", [msg(1)]);
    writeChatCache("t1", "planning", [msg(2)]);
    expect(readChatCache("t1", "crew")?.map((m) => m.id)).toEqual(["m1"]);
    expect(readChatCache("t1", "planning")?.map((m) => m.id)).toEqual(["m2"]);
  });

  it("keeps trips separate", () => {
    writeChatCache("t1", "crew", [msg(1)]);
    expect(readChatCache("t2", "crew")).toBeNull();
  });

  it("returns null when nothing was ever written", () => {
    expect(readChatCache("t1", "crew")).toBeNull();
  });

  it("clears", () => {
    writeChatCache("t1", "crew", [msg(1)]);
    clearChatCache("t1", "crew");
    expect(readChatCache("t1", "crew")).toBeNull();
  });
});

describe("chatCache — bounded by construction", () => {
  /**
   * One page, the same number the first fetch asks for. Asserted on both sides
   * so the bound cannot be defeated by writing more and trimming on read, or
   * vice versa — either alone would leave unbounded data in localStorage or an
   * unbounded array in memory.
   */
  it("never stores more than one page", () => {
    const many = Array.from({ length: CHAT_PAGE_SIZE * 3 }, (_, i) => msg(i));
    writeChatCache("t1", "crew", many);

    const stored = JSON.parse(store.getItem(KEY)!) as { messages: unknown[] };
    expect(stored.messages.length).toBe(CHAT_PAGE_SIZE);
    expect(readChatCache("t1", "crew")!.length).toBe(CHAT_PAGE_SIZE);
  });

  it("keeps the NEWEST page — the head, since the list is newest-first", () => {
    const many = Array.from({ length: CHAT_PAGE_SIZE * 2 }, (_, i) => msg(i));
    writeChatCache("t1", "crew", many);
    const out = readChatCache("t1", "crew")!;
    expect(out[0].id).toBe("m0");
    expect(out[out.length - 1].id).toBe(`m${CHAT_PAGE_SIZE - 1}`);
  });

  it("removes the entry rather than storing an empty channel", () => {
    writeChatCache("t1", "crew", [msg(1)]);
    writeChatCache("t1", "crew", []);
    // Not an entry that reads as a cached silence — no entry at all.
    expect(store.getItem(KEY)).toBeNull();
    expect(readChatCache("t1", "crew")).toBeNull();
  });
});

describe("chatCache — a bad cache is DISCARDED, never rendered partially", () => {
  /**
   * Each of these asserts NULL rather than falsiness, deliberately. Returning
   * `[]` would render "No messages yet" for a conversation that exists, and
   * returning a filtered subset would render three of fifty messages as though
   * it were the whole conversation — which is worse than an empty panel, since
   * an empty panel is obviously provisional and a short one is not.
   */
  it("discards an entry from a different schema version", () => {
    store.setItem(KEY, JSON.stringify({ v: 99, messages: [msg(1)] }));
    expect(readChatCache("t1", "crew")).toBeNull();
  });

  it("discards a pre-versioning entry (a bare array)", () => {
    store.setItem(KEY, JSON.stringify([msg(1), msg(2)]));
    expect(readChatCache("t1", "crew")).toBeNull();
  });

  it("discards unparseable JSON", () => {
    store.setItem(KEY, "{not json");
    expect(readChatCache("t1", "crew")).toBeNull();
  });

  /**
   * The case a version tag CANNOT catch: the row shape drifted and nobody
   * bumped the version. Forgetting to bump is the whole failure mode of a
   * version tag, which is why the fields are checked independently.
   */
  it("discards rows missing a required field, even at the right version", () => {
    const broken = { ...msg(1) } as Record<string, unknown>;
    delete broken.created_at;
    store.setItem(KEY, JSON.stringify({ v: 1, messages: [broken] }));
    expect(readChatCache("t1", "crew")).toBeNull();
  });

  it("discards rows with a wrong-typed field", () => {
    store.setItem(KEY, JSON.stringify({ v: 1, messages: [{ ...msg(1), text: 42 }] }));
    expect(readChatCache("t1", "crew")).toBeNull();
  });

  /**
   * ALL OR NOTHING. One bad row poisons the entry rather than being filtered
   * out — a filtered read is precisely how a partial conversation reaches the
   * screen looking complete.
   */
  it("discards the WHOLE entry when a single row is bad", () => {
    store.setItem(
      KEY,
      JSON.stringify({ v: 1, messages: [msg(1), { id: "x" }, msg(3)] })
    );
    expect(readChatCache("t1", "crew")).toBeNull();
  });

  it("accepts the nullable fields actually being null", () => {
    // System messages have no author; team_id is null on the trip channel.
    const system: CachedMessage = {
      ...msg(1),
      user_id: null,
      team_id: null,
      message_type: "system",
    };
    writeChatCache("t1", "crew", [system]);
    expect(readChatCache("t1", "crew")?.[0].user_id).toBeNull();
  });
});

describe("chatCache — SSR and hostile storage", () => {
  it("reads null and writes nothing when there is no window", () => {
    vi.stubGlobal("window", undefined);
    expect(readChatCache("t1", "crew")).toBeNull();
    expect(() => writeChatCache("t1", "crew", [msg(1)])).not.toThrow();
    expect(() => clearChatCache("t1", "crew")).not.toThrow();
  });

  /**
   * Private-mode quota errors and disabled storage must never reach the chat
   * panel. The cache is an optimisation; a failure to persist has to degrade to
   * the old cold-open behaviour, not to a broken conversation.
   */
  it("swallows a throwing setItem", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
        removeItem: () => {},
      },
    });
    expect(() => writeChatCache("t1", "crew", [msg(1)])).not.toThrow();
  });

  it("swallows a throwing getItem", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {},
        removeItem: () => {},
      },
    });
    expect(readChatCache("t1", "crew")).toBeNull();
  });
});
