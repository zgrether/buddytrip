import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * The header-space reclaim (§1a): the ~60px between the mobile sheet's grip
 * and the first pixel of tab content, broken down and partly cut.
 *
 * ── Why a SOURCE guard ───────────────────────────────────────────────────
 * Same trade as `chatPanelActive.test.ts` / `chatNotificationOpen.test.ts`:
 * a real layout measurement needs a browser, and this suite is
 * `environment: "node"`. What this CAN and does pin is the one distinction
 * that matters — which piece is a protected touch target and which piece was
 * free padding — so a future edit that shrinks the wrong one fails here
 * rather than silently reintroducing an unhittable grip.
 */

const chatSheetSrc = readFileSync(
  path.resolve(__dirname, "./ChatSheet.tsx"),
  "utf8"
);
const chatViewSrc = readFileSync(path.resolve(__dirname, "./ChatView.tsx"), "utf8");

describe("the grip's 44px touch target is untouched", () => {
  /**
   * `h-11` = 2.75rem = 44px, the platform-minimum touch target #1046 fixed
   * once already (was 22px, half the guideline). This is the piece explicitly
   * NOT to shrink — pinned here so it can't regress back toward that bug
   * while someone is trying to solve a DIFFERENT problem (reclaiming space).
   */
  it("keeps the grip box at h-11", () => {
    const grip = chatSheetSrc.slice(chatSheetSrc.indexOf('data-testid="chat-sheet-grip"') - 400);
    expect(grip).toContain('className="flex h-11 flex-shrink-0 items-start justify-center pt-1.5"');
  });
});

describe("the tab row's own top padding is what was actually cut", () => {
  /**
   * Measured breakdown (see the comment on this line in ChatView.tsx):
   * grip 44px (protected) + this row's OWN pt (was 12px, now 4px) + the tab
   * button's own pt-1 (4px, untouched) = 60px before, 52px after. The 8px
   * recovered here is the entire cut — nothing else in the stack changed.
   */
  it("uses pt-1, not the old pt-3", () => {
    const tabRow = chatViewSrc.slice(
      chatViewSrc.indexOf('role="tablist"') - 200,
      chatViewSrc.indexOf('role="tablist"') + 20
    );
    expect(tabRow).toContain("pt-1 pb-3");
    expect(tabRow).not.toMatch(/\bpt-3\b/);
  });

  /** The tab BUTTON's own padding is a separate concern (its own tap
   *  cushion) and was deliberately left alone — pinned so the two don't get
   *  conflated in a future "tidy up the spacing" pass. */
  it("leaves the individual tab button's own padding alone", () => {
    expect(chatViewSrc).toContain("px-3 pb-1.5 pt-1 text-[12.5px]");
  });
});
