import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
  keyboardInset,
  sheetKeyboardVars,
  KEYBOARD_MIN_INSET,
  SHEET_TOP_GAP,
  type ViewportMetrics,
} from "./keyboardInset";
import { AddEditSheet } from "@/components/AddEditSheet";

/**
 * The keyboard inset — the arithmetic, and the two things about the sheet that
 * a wrong answer would break.
 *
 * `environment: "node"` means no `visualViewport` and no keyboard, so what is
 * asserted here is the numbers (which is why they are a pure module) and the
 * NO-OP: with nothing to report, the sheet has to render exactly as it did
 * before any of this existed.
 */

/** A phone with nothing covering the window. */
const closed: ViewportMetrics = { innerHeight: 844, viewportHeight: 844, offsetTop: 0 };
/** The same phone with a keyboard up — 336px of it, iPhone-sized. */
const open: ViewportMetrics = { innerHeight: 844, viewportHeight: 508, offsetTop: 0 };

describe("keyboardInset", () => {
  it("measures what is covered below the visible viewport", () => {
    expect(keyboardInset(open)).toBe(336);
  });

  it("counts a visual viewport that has been PANNED, not just shrunk", () => {
    // iOS pans the visual viewport within the layout viewport to reveal a
    // focused input: the height does not change, `offsetTop` does. Reading the
    // height alone would under-report by exactly the pan and let the sheet
    // drift back under the keyboard mid-typing.
    expect(keyboardInset({ innerHeight: 844, viewportHeight: 508, offsetTop: 40 })).toBe(296);
  });

  it("is zero with the keyboard down", () => {
    expect(keyboardInset(closed)).toBe(0);
  });

  it("ignores an inset too small to be a keyboard", () => {
    // An iPad's hardware-keyboard accessory bar and address-bar animation
    // jitter both land here. Moving the sheet for those would be a twitch with
    // no cause the reader can see.
    const bar = { innerHeight: 844, viewportHeight: 844 - (KEYBOARD_MIN_INSET - 1), offsetTop: 0 };
    expect(keyboardInset(bar)).toBe(0);
    const real = { innerHeight: 844, viewportHeight: 844 - KEYBOARD_MIN_INSET, offsetTop: 0 };
    expect(keyboardInset(real)).toBe(KEYBOARD_MIN_INSET);
  });

  it("returns zero rather than a negative or a NaN for unusable numbers", () => {
    // Zero is the "leave the sheet alone" answer, so every input this cannot
    // read has to land on it — an enhancement must never be able to break the
    // thing it enhances.
    expect(keyboardInset({ innerHeight: 508, viewportHeight: 844, offsetTop: 0 })).toBe(0);
    expect(keyboardInset({ innerHeight: NaN, viewportHeight: 844, offsetTop: 0 })).toBe(0);
    expect(keyboardInset({ innerHeight: 844, viewportHeight: NaN, offsetTop: 0 })).toBe(0);
  });
});

describe("sheetKeyboardVars", () => {
  it("lifts the sheet AND caps it, because one without the other is the same bug", () => {
    // Lifting alone pushes the top edge off the screen by the height of the
    // keyboard: the first fields go from below the fold to above it.
    expect(sheetKeyboardVars(open)).toEqual({
      bottom: "336px",
      maxHeight: `${508 - SHEET_TOP_GAP}px`,
    });
  });

  it("keeps the sheet's top edge inside what is visible", () => {
    // The property, rather than the two numbers: bottom + height must fit in
    // the window, or the header is off-screen and there is nothing to read.
    const v = sheetKeyboardVars(open)!;
    expect(parseInt(v.bottom) + parseInt(v.maxHeight)).toBeLessThanOrEqual(open.innerHeight);
  });

  it("says NOTHING when there is no keyboard", () => {
    expect(sheetKeyboardVars(closed)).toBeNull();
  });
});

describe("the sheet reads them, and is untouched without them", () => {
  const html = renderToStaticMarkup(
    <AddEditSheet title="Quick Stroke Play" onClose={() => {}} testId="s">
      <div>body</div>
    </AddEditSheet>
  );

  it("sets no keyboard variables at all when none are reported", () => {
    // The no-op guarantee. SSR and any browser without `visualViewport` land
    // here, and both must get the sheet the CSS alone describes.
    //
    // Anchored to the COLON, and the first version of this was not — it read
    // `not.toContain("--bt-kb-bottom")` and failed against correct code,
    // because the class name `bottom-[var(--bt-kb-bottom,0px)]` contains the
    // variable's name too. Only a style DECLARATION can emit `name:`; the
    // class always writes `name,`. CLAUDE.md's substring corollary, caught by
    // the assertion rather than by reading it.
    expect(html).not.toContain("--bt-kb-bottom:");
    expect(html).not.toContain("--bt-kb-max:");
    // …and proof the anchor can actually appear, so the two lines above are
    // not asserting the absence of a string this markup could never contain.
    expect(html).toContain("--bt-kb-bottom,");
  });

  it("still positions itself from the classes, which carry the defaults", () => {
    expect(html).toContain("bottom-[var(--bt-kb-bottom,0px)]");
    expect(html).toContain("max-h-[var(--bt-kb-max,90vh)]");
  });

  it("lets the desktop drawer's own rules keep winning", () => {
    // The reason the values travel as CSS vars rather than inline styles: an
    // inline `bottom` would beat `sm:bottom-auto` and drag a drawer that has no
    // keyboard in front of it.
    expect(html).toContain("sm:bottom-auto");
    expect(html).toContain("sm:max-h-screen");
  });
});

/**
 * A source read, and weaker than driving a phone — which this suite cannot do.
 * It is here because the failure it guards is silent in every other way: drop
 * the hook and the sheet still renders, still looks right on a desktop, and is
 * wrong only with a keyboard up on a device nobody is testing on.
 */
describe("AddEditSheet subscribes to the keyboard", () => {
  const src = readFileSync("src/components/AddEditSheet.tsx", "utf8");
  it("calls the hook and feeds its result into the sheet's style", () => {
    expect(src).toMatch(/useKeyboardInset\(\)/);
    expect(src).toMatch(/"--bt-kb-bottom": keyboard\.bottom/);
    expect(src).toMatch(/"--bt-kb-max": keyboard\.maxHeight/);
  });
});
