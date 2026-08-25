import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
// Deep import ON PURPOSE: this is the function whose behaviour the shield in
// `FloatingChatPanel` works around, and the package root exports only
// `RemoveScroll`. Testing the thing we actually depend on beats testing a
// re-export of something else.
import { handleScroll } from "react-remove-scroll/dist/es5/handleScroll";

/**
 * Why the chat message list stops `touchmove` from reaching `ScrollLock`.
 *
 * ── The reported bug ────────────────────────────────────────────────────────
 * At the newest message, the first swipe toward older history does nothing.
 * Nudge the other way and immediately reverse and it scrolls fine.
 *
 * ── What this file pins ─────────────────────────────────────────────────────
 * `react-remove-scroll` arbitrates touch gestures inside a lock by reading
 * `scrollTop`/`scrollHeight`/`clientHeight` and deciding whether the element
 * has room to move in the gesture's direction. Its only concession to layout
 * direction is `getDirectionFactor`, which handles `direction: rtl` on the
 * HORIZONTAL axis. It has no notion of `flex-direction: column-reverse`, where
 * `scrollTop` is 0 at the VISUAL BOTTOM and negative toward older content.
 *
 * This is a CROSS-LIBRARY BEHAVIOURAL DEPENDENCY that fails silently — the
 * class CLAUDE.md #23 says gets a runtime test, because nothing else can see
 * it. Our workaround is only correct while the library still gets this wrong.
 *
 * **If this file starts failing, that is good news**: the library has learned
 * about column-reverse, and the `touchmove` shield in `FloatingChatPanel`
 * should be removed rather than the test adjusted.
 *
 * The suite is `environment: "node"`, so the DOM the function walks is stubbed
 * — which is enough, since it only ever reads four numbers and two computed
 * styles per node.
 */

class FakeElement {
  tagName = "DIV";
  scrollTop = 0;
  scrollHeight = 0;
  clientHeight = 0;
  scrollLeft = 0;
  scrollWidth = 0;
  clientWidth = 0;
  overflowY = "visible";
  overflowX = "visible";
  parentNode: FakeElement | null = null;
  /** Only ever asked about nodes in the chain built below. */
  contains(node: unknown): boolean {
    let cur = node as FakeElement | null;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentNode;
    }
    return false;
  }
}

/** lock ▸ scroller ▸ message — the real shape inside `ChatSheet`. */
function buildTree(scroller: Partial<FakeElement>) {
  const body = new FakeElement();
  const lock = new FakeElement();
  const scroll = Object.assign(new FakeElement(), {
    scrollHeight: 2000,
    clientHeight: 500,
    overflowY: "auto",
    overflowX: "hidden",
    ...scroller,
  });
  const message = new FakeElement();
  lock.parentNode = body;
  scroll.parentNode = lock;
  message.parentNode = scroll;
  return { body, lock, scroll, message };
}

let tree: ReturnType<typeof buildTree>;

function stub(t: ReturnType<typeof buildTree>) {
  tree = t;
  vi.stubGlobal("Element", FakeElement);
  vi.stubGlobal("Node", { DOCUMENT_FRAGMENT_NODE: 11 });
  vi.stubGlobal("document", { body: t.body });
  vi.stubGlobal("window", {
    getSelection: () => null,
    getComputedStyle: (n: FakeElement) => ({
      direction: "ltr",
      overflowY: n.overflowY,
      overflowX: n.overflowX,
    }),
  });
}
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => vi.unstubAllGlobals());

/**
 * `deltaY = touchStartY - touchY`, so a finger moving DOWN — the gesture that
 * reveals older messages — is a NEGATIVE delta. Named, because getting this
 * backwards would invert every assertion below while leaving them all passing.
 */
const SWIPE_TOWARD_OLDER = -40;
const SWIPE_TOWARD_NEWER = 40;

/** `noOverscroll` is `true` for the touch path (SideEffect.js). */
const cancels = (delta: number) =>
  handleScroll("v", tree.lock, { target: tree.message }, delta, true);

describe("react-remove-scroll — column-reverse at the visual bottom", () => {
  /**
   * THE BUG, reproduced. Column-reverse pins `scrollTop` to 0 at the newest
   * message, the library reads that as "no room to scroll back", and cancels
   * the move — even though 1500px of older history sits above.
   */
  it("cancels the swipe toward older messages", () => {
    stub(buildTree({ scrollTop: 0 }));
    expect(cancels(SWIPE_TOWARD_OLDER)).toBe(true);
  });

  /**
   * WHY THE TWO-STEP WORKAROUND WORKS. Once the container is a few pixels off
   * the boundary, `scrollTop` is non-zero and the same gesture is allowed.
   */
  it("allows the identical swipe once scrolled a few pixels off the bottom", () => {
    stub(buildTree({ scrollTop: -6 }));
    expect(cancels(SWIPE_TOWARD_OLDER)).toBe(false);
  });

  /** The opposite direction was never blocked — which is the nudge itself. */
  it("never blocked the nudge in the other direction", () => {
    stub(buildTree({ scrollTop: 0 }));
    expect(cancels(SWIPE_TOWARD_NEWER)).toBe(false);
  });
});

describe("react-remove-scroll — the same geometry, laid out normally", () => {
  /**
   * THE CONTRAST THAT NAMES THE CAUSE. A normal (non-reversed) list at its
   * BOTTOM has `scrollTop === maxScroll`, and the swipe is allowed. A
   * column-reverse list at its bottom has `scrollTop === 0`, and it is refused.
   *
   * Same list, same position on screen, same gesture, opposite verdicts — the
   * difference is entirely `flex-direction`, which the library cannot see.
   */
  it("allows the swipe at the bottom of a normal list", () => {
    stub(buildTree({ scrollTop: 1500 }));
    expect(cancels(SWIPE_TOWARD_OLDER)).toBe(false);
  });

  /**
   * And the library is RIGHT here: at the top of a normal list there really is
   * nothing above, so cancelling is correct. It is not broken in general — it
   * is blind to one layout mode, which is why the fix is to keep it away from
   * this one container rather than to stop using it.
   */
  it("correctly cancels at the top of a normal list", () => {
    stub(buildTree({ scrollTop: 0 }));
    expect(cancels(SWIPE_TOWARD_OLDER)).toBe(true);
  });
});
