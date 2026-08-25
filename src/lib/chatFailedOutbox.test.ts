import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  readFailedOutbox,
  putFailedMessage,
  clearFailedMessage,
  type FailedMessage,
} from "./chatFailedOutbox";

/**
 * The failed-message outbox.
 *
 * ── The invariant worth more than the rest ──────────────────────────────────
 * THE ID IS PRESERVED EXACTLY. `messages.id` is the primary key and the router
 * inserts the client's id verbatim, so a retry reusing it cannot duplicate a
 * message that already landed — and a retry with a fresh id WOULD. Everything
 * here that touches `id` is guarding that one property, including the strict
 * rejection of a row missing one: salvaging such a row would hand the caller a
 * message it could only re-send under a new id.
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

const KEY = (trip: string, vis: string) => `bt.chatFailed.v1:${trip}:${vis}`;

const msg = (over: Partial<FailedMessage> = {}): FailedMessage => ({
  id: "m-1",
  text: "on the 12th tee",
  createdAt: "2026-08-25T12:00:00.000Z",
  userId: "u-1",
  ...over,
});

describe("chatFailedOutbox — a failed send is not lost", () => {
  /** The reported bug: send fails, text must still exist somewhere. */
  it("keeps the text", () => {
    putFailedMessage("t1", "crew", msg());
    expect(readFailedOutbox("t1", "crew")).toEqual([msg()]);
  });

  /**
   * "Fail, close the panel, reopen" is simply a second read — the panel
   * unmounts on close and re-seeds from here on its next mount.
   */
  it("survives the panel closing", () => {
    putFailedMessage("t1", "crew", msg({ text: "who has the cart keys" }));
    expect(readFailedOutbox("t1", "crew")[0].text).toBe("who has the cart keys");
  });

  it("is empty when nothing has failed", () => {
    expect(readFailedOutbox("t1", "crew")).toEqual([]);
  });

  it("keeps several failures in the order they happened", () => {
    putFailedMessage("t1", "crew", msg({ id: "a", text: "first" }));
    putFailedMessage("t1", "crew", msg({ id: "b", text: "second" }));
    expect(readFailedOutbox("t1", "crew").map((m) => m.text)).toEqual(["first", "second"]);
  });
});

describe("chatFailedOutbox — the id is what makes retry safe", () => {
  /**
   * A retry re-sends the STORED id. If this round-trip ever altered it, the
   * retry would insert a second row instead of being refused by the primary
   * key — the duplicate this whole design exists to prevent.
   */
  it("returns the id byte-for-byte", () => {
    const id = "9f8c1e2a-0b44-4d1f-9a77-3c5e6b0d8a11";
    putFailedMessage("t1", "crew", msg({ id }));
    expect(readFailedOutbox("t1", "crew")[0].id).toBe(id);
  });

  /**
   * A second failure of the SAME message updates in place. Stacking would put
   * two bubbles on screen for one message, each with its own retry, and tapping
   * both would send the same id twice.
   */
  it("updates a repeated failure instead of stacking it", () => {
    putFailedMessage("t1", "crew", msg({ id: "a", text: "first attempt" }));
    putFailedMessage("t1", "crew", msg({ id: "a", text: "first attempt" }));
    expect(readFailedOutbox("t1", "crew")).toHaveLength(1);
  });

  /**
   * A row without an id cannot be retried safely, so it is refused rather than
   * salvaged — the opposite call from the sibling rows below, and for this exact
   * reason.
   */
  it("refuses a row with no id rather than recovering an un-retryable message", () => {
    store.setItem(
      KEY("t1", "crew"),
      JSON.stringify({ v: 1, messages: [{ text: "no id here", createdAt: "x", userId: "u-1" }] })
    );
    expect(readFailedOutbox("t1", "crew")).toEqual([]);
  });
});

describe("chatFailedOutbox — clearing", () => {
  /**
   * One function for both "it sent" and "I don't want it": the resulting state
   * is identical, and two paths would be two things to keep in step.
   */
  it("removes the entry on success or discard", () => {
    putFailedMessage("t1", "crew", msg({ id: "a" }));
    clearFailedMessage("t1", "crew", "a");
    expect(readFailedOutbox("t1", "crew")).toEqual([]);
  });

  it("removes the key entirely once the last entry goes", () => {
    putFailedMessage("t1", "crew", msg({ id: "a" }));
    clearFailedMessage("t1", "crew", "a");
    expect(store._raw.has(KEY("t1", "crew"))).toBe(false);
  });

  it("clears only the named message", () => {
    putFailedMessage("t1", "crew", msg({ id: "a", text: "keep me" }));
    putFailedMessage("t1", "crew", msg({ id: "b", text: "drop me" }));
    clearFailedMessage("t1", "crew", "b");
    expect(readFailedOutbox("t1", "crew").map((m) => m.text)).toEqual(["keep me"]);
  });

  it("is a no-op for an id that isn't there", () => {
    putFailedMessage("t1", "crew", msg({ id: "a" }));
    clearFailedMessage("t1", "crew", "nope");
    expect(readFailedOutbox("t1", "crew")).toHaveLength(1);
  });

  /** A send that succeeds must leave nothing behind at all. */
  it("leaves no trace of a message that never failed", () => {
    expect(store._raw.size).toBe(0);
    expect(readFailedOutbox("t1", "crew")).toEqual([]);
  });
});

describe("chatFailedOutbox — channels and trips stay apart", () => {
  it("does not leak between crew and organizers", () => {
    putFailedMessage("t1", "crew", msg({ id: "a", text: "crew text" }));
    expect(readFailedOutbox("t1", "planning")).toEqual([]);
    expect(readFailedOutbox("t1", "crew")).toHaveLength(1);
  });

  it("does not leak between trips", () => {
    putFailedMessage("t1", "crew", msg({ id: "a", text: "trip one" }));
    putFailedMessage("t2", "crew", msg({ id: "b", text: "trip two" }));
    clearFailedMessage("t1", "crew", "a");
    expect(readFailedOutbox("t2", "crew").map((m) => m.text)).toEqual(["trip two"]);
  });
});

describe("chatFailedOutbox — the author is recorded", () => {
  /**
   * Two accounts on one phone share this key. The caller filters recovered
   * bubbles on `userId`, so attributing one person's unsent message to the
   * other is prevented at the point it would matter — but only if the field
   * survives the round-trip.
   */
  it("round-trips the author", () => {
    putFailedMessage("t1", "crew", msg({ userId: "u-zach" }));
    expect(readFailedOutbox("t1", "crew")[0].userId).toBe("u-zach");
  });

  it("refuses a row with no author", () => {
    store.setItem(
      KEY("t1", "crew"),
      JSON.stringify({ v: 1, messages: [{ id: "a", text: "t", createdAt: "x" }] })
    );
    expect(readFailedOutbox("t1", "crew")).toEqual([]);
  });
});

describe("chatFailedOutbox — corrupt storage", () => {
  /**
   * PER-ROW, NOT PER-BATCH — the opposite call from `chatDraft`, deliberately.
   * There a partial value is a fragment that reads as something you wrote and is
   * one tap from being sent. Here the entries are discrete whole messages, so
   * throwing away four good ones because a fifth is malformed loses more than it
   * protects.
   */
  it("keeps the good rows and drops only the bad one", () => {
    store.setItem(
      KEY("t1", "crew"),
      JSON.stringify({
        v: 1,
        messages: [
          { id: "a", text: "good", createdAt: "x", userId: "u-1" },
          { id: "b", text: 42, createdAt: "x", userId: "u-1" },
          { id: "c", text: "also good", createdAt: "x", userId: "u-1" },
        ],
      })
    );
    expect(readFailedOutbox("t1", "crew").map((m) => m.id)).toEqual(["a", "c"]);
  });

  const corrupt: Array<[string, string]> = [
    ["not JSON", "{{{"],
    ["a bare string", '"nope"'],
    ["null", "null"],
    ["an array at the root", "[]"],
    ["a future schema version", '{"v":2,"messages":[]}'],
    ["no version tag", '{"messages":[]}'],
    ["messages of the wrong type", '{"v":1,"messages":"nope"}'],
  ];

  it.each(corrupt)("returns [] for %s", (_label, raw) => {
    store.setItem(KEY("t1", "crew"), raw);
    expect(readFailedOutbox("t1", "crew")).toEqual([]);
  });
});

describe("chatFailedOutbox — bounded, and never throws into chat", () => {
  /**
   * The one outbox whose entries are NOT self-clearing: a failed message waits
   * for a human, where a score cell retries the moment it is touched. An offline
   * stretch would otherwise grow without limit.
   */
  it("keeps the newest 20 and drops the oldest", () => {
    for (let i = 0; i < 25; i++) {
      putFailedMessage("t1", "crew", msg({ id: `m-${i}`, text: `msg ${i}` }));
    }
    const kept = readFailedOutbox("t1", "crew");
    expect(kept).toHaveLength(20);
    expect(kept[0].id).toBe("m-5");
    expect(kept[19].id).toBe("m-24");
  });

  it("caps text at the server's message limit", () => {
    putFailedMessage("t1", "crew", msg({ text: "x".repeat(6000) }));
    expect(readFailedOutbox("t1", "crew")[0].text.length).toBe(5000);
  });

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
    expect(() => putFailedMessage("t1", "crew", msg())).not.toThrow();
    expect(() => clearFailedMessage("t1", "crew", "m-1")).not.toThrow();
    expect(readFailedOutbox("t1", "crew")).toEqual([]);
  });

  it("is inert with no window", () => {
    vi.stubGlobal("window", undefined);
    expect(() => putFailedMessage("t1", "crew", msg())).not.toThrow();
    expect(readFailedOutbox("t1", "crew")).toEqual([]);
  });
});
