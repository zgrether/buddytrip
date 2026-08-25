import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * MOUNTED IS NOT VISIBLE.
 *
 * `ChatView` mounts the Crew and Organizers panels at the SAME TIME and hides
 * one with the `hidden` attribute, so each keeps its own scroll position and
 * composer. Both are live components running live effects — and two of those
 * effects assert something about a person's ATTENTION:
 *
 *   markRead     "they have read this channel"
 *   markViewing  "they are looking at this channel right now"
 *
 * Both are false for the hidden panel, and both failures are silent. Measured in
 * production: the same account's `viewing_at` for crew and planning written
 * **2 milliseconds apart**, which no human can do. Opening Crew was marking
 * Organizers viewed — suppressing its notifications — and marking it read,
 * clearing an unread badge for messages nobody had seen.
 *
 * ── Why a SOURCE guard ──────────────────────────────────────────────────────
 * The honest answer is that the real test is a render test, and this suite is
 * `environment: "node"` with no renderer, no tRPC and no session. A source guard
 * is weaker: it checks the wiring exists, not that it works.
 *
 * It is still worth having, because the regression it guards is a DELETION —
 * someone removing a prop that looks redundant next to `hidden`, or adding a
 * third panel and not passing it. Both are visible in the source, and neither
 * produces any symptom a person would notice for weeks.
 */

const read = (rel: string) => readFileSync(path.resolve(__dirname, rel), "utf8");

describe("ChatView tells each panel whether it is the visible one", () => {
  const src = read("./shell/ChatView.tsx");

  /**
   * Counted rather than spot-checked: adding a third segment and forgetting
   * `active` on it is the likeliest way this comes back, and a test that only
   * looks at the two panels present today would not see it.
   */
  it("passes `active` to every FloatingChatPanel it mounts", () => {
    const mounts = src.match(/<FloatingChatPanel\b/g) ?? [];
    const actives = src.match(/active=\{activeSegment === "/g) ?? [];
    expect(mounts.length).toBeGreaterThan(1); // both panels are mounted at once
    expect(actives.length).toBe(mounts.length);
  });

  /**
   * `hidden` is CSS. If a panel is ever gated by unmounting instead, this test
   * should be deleted along with the prop — but silently swapping one for the
   * other would leave the prop present and inert.
   */
  it("still mounts both panels rather than unmounting the hidden one", () => {
    expect(src).toMatch(/hidden=\{activeSegment !== "crew"\}/);
    expect(src).toMatch(/hidden=\{activeSegment !== "planning"\}/);
  });
});

describe("the panel refuses to claim attention it does not have", () => {
  const src = read("./FloatingChatPanel.tsx");

  /**
   * Both effects must bail on `!active`. Asserted separately because they fail
   * differently: the heartbeat wrongly SILENCES notifications, and markRead
   * wrongly CLEARS an unread badge. Fixing one and not the other is a plausible
   * partial regression.
   */
  it("gates the viewing heartbeat on active", () => {
    const beat = src.slice(src.indexOf("── Viewing heartbeat"));
    const effect = beat.slice(0, beat.indexOf("markViewingMutate({"));
    expect(effect).toMatch(/if \(!active\) return;/);
  });

  it("gates the read mark on active", () => {
    const start = src.indexOf("// Mark the active channel read");
    const effect = src.slice(start, src.indexOf("markReadMutate({", start));
    expect(effect).toMatch(/if \(!active\) return;/);
  });

  /**
   * `document.visibilityState` answers "is this TAB in front", which BOTH
   * mounted panels answer yes to — so it can never distinguish them. It stays
   * (a backgrounded tab is genuinely not being viewed), but it must not be the
   * only check, and that is exactly the mistake that shipped.
   */
  it("does not rely on document.visibilityState alone", () => {
    const beat = src.slice(src.indexOf("── Viewing heartbeat"));
    const effect = beat.slice(0, beat.indexOf("markViewingMutate({"));
    expect(effect).toContain("visibilityState");
    expect(effect).toMatch(/if \(!active\) return;/);
  });
});
