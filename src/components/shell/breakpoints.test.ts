import { describe, it, expect } from "vitest";
import { chatMountLocation, type ChatMountLocation } from "./breakpoints";

// The historical bug (AppShell.tsx comment): Chat mounting at more than one
// location at once wasn't just a double-paint — the floating panel's
// `position: fixed` meant an "invisible" duplicate still sat over the whole
// app and swallowed every click, breaking four merge-blocking E2E specs.
// These pin the exactly-one-location contract across the full state space.

describe("chatMountLocation", () => {
  const VIEWS = ["home", "trip", "cup", "chat"] as const;

  it("never mounts anywhere when Chat isn't the active view, on any viewport", () => {
    for (const view of VIEWS.filter((v) => v !== "chat")) {
      expect(chatMountLocation(view, false)).toBe("none");
      expect(chatMountLocation(view, true)).toBe("none");
    }
  });

  it("mounts inline (owns the view) when Chat is active below the chat-column breakpoint", () => {
    expect(chatMountLocation("chat", false)).toBe("inline");
  });

  it("mounts as the aside column when Chat is active at/above the chat-column breakpoint", () => {
    expect(chatMountLocation("chat", true)).toBe("aside");
  });

  it("is exhaustive and mutually exclusive across the full (view × breakpoint) state space", () => {
    for (const view of VIEWS) {
      for (const chatIsColumn of [false, true]) {
        const location: ChatMountLocation = chatMountLocation(view, chatIsColumn);
        expect(["inline", "aside", "none"]).toContain(location);
        // At most one of "inline"/"aside" is ever true — never both.
        const isInline = location === "inline";
        const isAside = location === "aside";
        expect(isInline && isAside).toBe(false);
      }
    }
  });
});
