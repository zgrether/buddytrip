import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  readChatTextSize,
  writeChatTextSize,
  chatTextScale,
  chatPx,
  CHAT_BASE_PX,
  DEFAULT_CHAT_TEXT_SIZE,
} from "./chatTextSize";

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

const KEY = "bt.chatTextSize.v1";

describe("chatTextSize — S is the default, and the default is a no-op", () => {
  it("defaults to S with nothing stored", () => {
    expect(readChatTextSize()).toBe("S");
    expect(DEFAULT_CHAT_TEXT_SIZE).toBe("S");
  });

  /**
   * THE ASSERTION THAT MAKES "S is byte-identical to today" MORE THAN A
   * CLAIM. If this ever returns anything but 1, every derived pixel value in
   * `CHAT_BASE_PX` changes for someone who never touched the control.
   */
  it("S scales by exactly 1", () => {
    expect(chatTextScale("S")).toBe(1);
    expect(chatPx(CHAT_BASE_PX.message, "S")).toBe(CHAT_BASE_PX.message);
    expect(chatPx(CHAT_BASE_PX.meta, "S")).toBe(CHAT_BASE_PX.meta);
    expect(chatPx(CHAT_BASE_PX.label, "S")).toBe(CHAT_BASE_PX.label);
  });
});

describe("chatTextSize — M and L persist across reload", () => {
  it("round-trips M", () => {
    writeChatTextSize("M");
    expect(readChatTextSize()).toBe("M");
  });

  it("round-trips L", () => {
    writeChatTextSize("L");
    expect(readChatTextSize()).toBe("L");
  });

  it("a later write overwrites an earlier one", () => {
    writeChatTextSize("L");
    writeChatTextSize("M");
    expect(readChatTextSize()).toBe("M");
  });
});

describe("chatTextSize — the ladder", () => {
  it("M is halfway (1.5x), L is double (2x)", () => {
    expect(chatTextScale("M")).toBe(1.5);
    expect(chatTextScale("L")).toBe(2);
  });

  it("message text: 14 / 21 / 28", () => {
    expect(chatPx(CHAT_BASE_PX.message, "S")).toBe(14);
    expect(chatPx(CHAT_BASE_PX.message, "M")).toBe(21);
    expect(chatPx(CHAT_BASE_PX.message, "L")).toBe(28);
  });

  it("meta text (timestamp/sender): 10 / 15 / 20", () => {
    expect(chatPx(CHAT_BASE_PX.meta, "S")).toBe(10);
    expect(chatPx(CHAT_BASE_PX.meta, "M")).toBe(15);
    expect(chatPx(CHAT_BASE_PX.meta, "L")).toBe(20);
  });

  /**
   * One ratio, applied uniformly — the day-separator label and the
   * per-message timestamp must scale IDENTICALLY at every size, or a
   * separator could visually outrun (or lag) the stamps beneath it despite
   * both being nominally "10px, scaled".
   */
  it("meta and label scale identically at every size", () => {
    for (const size of ["S", "M", "L"] as const) {
      expect(chatPx(CHAT_BASE_PX.label, size)).toBe(chatPx(CHAT_BASE_PX.meta, size));
    }
  });
});

describe("chatTextSize — a corrupt stored value falls back to S", () => {
  const corrupt: Array<[string, string]> = [
    ["not JSON", "{{{"],
    ["a bare string", '"L"'],
    ["null", "null"],
    ["an array", '["L"]'],
    ["a future schema version", '{"v":2,"size":"L"}'],
    ["no version tag", '{"size":"L"}'],
    ["an invalid size value", '{"v":1,"size":"XL"}'],
    ["size of the wrong type", '{"v":1,"size":42}'],
    ["size missing entirely", '{"v":1}'],
  ];

  it.each(corrupt)("discards %s and returns S", (_label, raw) => {
    store.setItem(KEY, raw);
    expect(readChatTextSize()).toBe("S");
  });
});

describe("chatTextSize — bounded, and never throws into chat", () => {
  it("survives a storage that throws on every operation", () => {
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
    expect(() => writeChatTextSize("L")).not.toThrow();
    expect(readChatTextSize()).toBe("S");
  });

  it("is inert with no window", () => {
    vi.stubGlobal("window", undefined);
    expect(() => writeChatTextSize("L")).not.toThrow();
    expect(readChatTextSize()).toBe("S");
  });
});
