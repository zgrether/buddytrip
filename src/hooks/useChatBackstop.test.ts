import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chatBackstopStale, CHAT_BACKSTOP_INTERVAL_MS } from "./useChatBackstop";

/**
 * #1396 — the chat backstop: an open room that misses a realtime event catches
 * up, and a current one costs one row per check.
 *
 * What the probe decides is pure (`chatBackstopStale`), so it is tested as a
 * function. What it is wired to is asserted over the panel's source, because
 * this suite is `environment: "node"` and cannot mount the panel; the
 * behaviour was also checked in a running app (see the PR).
 */

describe("chatBackstopStale", () => {
  it("is stale when the server's newest row is not the newest one on screen", () => {
    expect(chatBackstopStale("m2", "m1")).toBe(true);
  });

  it("is stale when the server has a row and the screen has none", () => {
    expect(chatBackstopStale("m1", null)).toBe(true);
    expect(chatBackstopStale("m1", undefined)).toBe(true);
  });

  it("is current when the ids match", () => {
    expect(chatBackstopStale("m1", "m1")).toBe(false);
  });

  it("is current when the server has nothing (an empty room, or the probe has not answered)", () => {
    expect(chatBackstopStale(null, null)).toBe(false);
    expect(chatBackstopStale(undefined, "m1")).toBe(false);
  });
});

describe("the backstop is wired to the room on screen", () => {
  const panel = readFileSync(join(__dirname, "..", "components", "FloatingChatPanel.tsx"), "utf8");
  const call = panel.slice(panel.indexOf("useChatBackstop({"), panel.indexOf("});", panel.indexOf("useChatBackstop({")));

  it("the panel calls it", () => {
    expect(call.length).toBeGreaterThan(0);
  });

  it("only while the room is ACTIVE: a hidden, mounted panel must not poll", () => {
    // ChatView mounts every room and hides the others with CSS, so without this
    // term every hidden room would probe too.
    expect(call).toMatch(/enabled:\s*active &&/);
  });

  it("compares against the room's own newest LOADED row", () => {
    expect(call).toContain("newestLoadedId: activeQuery.data?.pages[0]?.[0]?.id ?? null");
  });

  it("checks every 30s (Zach, 2026-10-15)", () => {
    expect(CHAT_BACKSTOP_INTERVAL_MS).toBe(30_000);
  });
});
