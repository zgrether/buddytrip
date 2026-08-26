import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * The chat text-size control (S/M/L, `chatTextSize.ts`) and the collapsed
 * channel banner — the wiring half of both features, source-guarded for the
 * same reason `chatPanelActive.test.ts` is: this suite is `environment:
 * "node"`, `FloatingChatPanel` needs tRPC/auth/a DOM to actually render, and
 * the regressions worth catching here are DELETIONS a diff review can miss —
 * a prop quietly dropped, a scaled span reverted to a fixed Tailwind class.
 * The pure math (S scales by exactly 1, the 14/21/28 ladder, corrupt-storage
 * fallback) is asserted for real in `chatTextSize.test.ts`; this file only
 * pins that the component actually WIRES that math in, everywhere it must.
 */

const read = (rel: string) => readFileSync(path.resolve(__dirname, rel), "utf8");

describe("ChatView lifts textSize to both mounted panels, not each its own copy", () => {
  const src = read("./shell/ChatView.tsx");

  /**
   * `FloatingChatPanel` mounts Crew and Organizers SIMULTANEOUSLY (see
   * `chatPanelActive.test.ts`'s header) — if each read its own localStorage
   * copy of the size, changing it while looking at one channel would not
   * reach the other until a remount. Counted, like the sibling `active` guard,
   * so a third mounted panel that forgets the prop is caught too.
   */
  it("passes textSize and onChangeTextSize to every FloatingChatPanel it mounts", () => {
    const mounts = src.match(/<FloatingChatPanel\b/g) ?? [];
    const sizes = src.match(/textSize=\{textSize\}/g) ?? [];
    const setters = src.match(/onChangeTextSize=\{setTextSize\}/g) ?? [];
    expect(mounts.length).toBeGreaterThan(1);
    expect(sizes.length).toBe(mounts.length);
    expect(setters.length).toBe(mounts.length);
  });

  /** The setter must actually persist — not just update local state. */
  it("the lifted setter writes through to storage", () => {
    const setter = src.slice(src.indexOf("const setTextSize ="));
    expect(setter.slice(0, setter.indexOf("};"))).toContain("writeChatTextSize(size)");
  });
});

describe("FloatingChatPanel scales the transcript, and only the transcript", () => {
  const src = read("./FloatingChatPanel.tsx");

  /**
   * One computed value per role (message / meta / label), derived once per
   * render of the message loop and reused — not re-derived per element,
   * which would risk one spot being missed.
   */
  it("computes all three scaled sizes from the same textSize", () => {
    expect(src).toContain("const messagePx = chatPx(CHAT_BASE_PX.message, textSize);");
    expect(src).toContain("const metaPx = chatPx(CHAT_BASE_PX.meta, textSize);");
    expect(src).toContain("const labelPx = chatPx(CHAT_BASE_PX.label, textSize);");
  });

  /**
   * Every element the brief named as at-risk of "vanishing relative to the
   * messages" if left unscaled: the system line, timestamp, sender name, and
   * the three failed-message affordances. Counted rather than sampled — the
   * failure mode is exactly ONE of these being missed in a future edit.
   */
  it("applies metaPx to the system line, timestamp, sender name, and all three failed-message strings", () => {
    const uses = src.match(/fontSize: metaPx/g) ?? [];
    // system line, timestamp, sender name, "Not sent", Retry, Discard = 6.
    expect(uses.length).toBe(6);
  });

  it("applies messagePx to the bubble text, and removes the fixed text-sm class from it", () => {
    expect(src).toContain("fontSize: messagePx,");
    expect(src).not.toMatch(/rounded-2xl px-3 py-1\.5 text-sm whitespace-pre-wrap/);
  });

  it("applies labelPx to the day-separator and the 'New' divider labels", () => {
    const uses = src.match(/fontSize: labelPx/g) ?? [];
    expect(uses.length).toBe(2);
  });

  /**
   * THE ONE THAT ENFORCES SCOPE. §2's explicit decision was message-text-only
   * — the composer grows with nothing. If a future edit starts threading
   * `messagePx`/`chatPx` into the composer's style, this is the line that
   * should catch it: the textarea keeps its fixed `text-sm` class and no
   * scaled inline font-size.
   *
   * This is also what makes "composer stays ≥16px at every setting" true
   * independently of `textSize`: the global iOS-zoom rule
   * (`globals.css`, pinned by `inputZoom.test.ts`) already forces every
   * `textarea` to 16px on a touch device regardless of class — a rule this
   * component never overrides here, and STILL wouldn't need to even if it
   * did, since the ladder only goes up from S.
   */
  it("leaves the composer textarea's size untouched by textSize", () => {
    const composer = src.slice(
      src.indexOf("<textarea"),
      src.indexOf("</textarea>") === -1 ? src.indexOf("/>", src.indexOf("<textarea")) : src.indexOf("</textarea>")
    );
    expect(composer).toContain("text-sm");
    expect(composer).not.toMatch(/messagePx|metaPx|chatPx/);
  });
});

describe("the S/M/L control and the collapsed banner share one header strip", () => {
  const src = read("./FloatingChatPanel.tsx");

  it("renders the shared SegmentedToggle over the three chat text sizes", () => {
    expect(src).toContain("<SegmentedToggle<ChatTextSize>");
    expect(src).toContain("CHAT_TEXT_SIZES.map(");
  });

  /** Collapsed is a tap target; expanded content is a separate block gated
   *  the same way — both must exist for the toggle to do anything. */
  it("gates the expanded description block on bannerExpanded", () => {
    expect(src).toMatch(/isPlanningChannel && bannerExpanded/);
    expect(src).toContain('data-testid="chat-banner-toggle"');
    expect(src).toContain('data-testid="chat-banner-expanded"');
  });

  /**
   * §1b's near-decision: only the COUNT survives into the collapsed line,
   * not the description. Pinned so a future edit doesn't quietly restore the
   * description text to the one-line summary.
   */
  it("the collapsed line shows a count, not the description text", () => {
    const strip = src.slice(src.indexOf("HEADER STRIP"), src.indexOf("chat-banner-expanded"));
    expect(strip).toMatch(/in this chat/);
    expect(strip).not.toMatch(/sort out planning away from the full crew/);
  });
});
