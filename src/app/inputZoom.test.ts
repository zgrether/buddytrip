import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * iOS zooms the viewport when an input's computed `font-size` is under 16px,
 * and does not reliably zoom back out. The fix is one unlayered rule in
 * `globals.css`; this is the guard that it stays intact and stays effective.
 *
 * ── Why THIS is the guard, and not a scan for small inputs ──────────────────
 * The obvious guard — fail any `<input>` carrying `text-sm` — would be the
 * WRONG one under a global rule: it would fail 47 surfaces that behave
 * perfectly, and the pressure to silence it would be pressure to delete the
 * thing keeping them correct. The rule is what makes a new input right by
 * default, so the rule is what gets guarded.
 *
 * ── The assertions are about MECHANISM, not the presence of a string ────────
 * "`font-size: 16px` appears in globals.css" would pass with the rule inside an
 * `@layer`, behind the wrong media query, or applied to `div`. Each of those
 * ships the bug with the guard green, so each is checked directly.
 */

const ROOT = path.resolve(__dirname, "../..");
const css = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
const layout = readFileSync(path.join(ROOT, "src/app/layout.tsx"), "utf8");

/** The rule's own block, located by its media query. */
function inputZoomBlock(): string {
  const at = css.search(/@media[^{]*pointer:\s*coarse[^{]*\{/);
  expect(at, "no @media block mentioning `pointer: coarse` in globals.css").toBeGreaterThan(-1);
  // Walk braces from the media query's `{` to its match.
  const open = css.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(at, i + 1);
    }
  }
  throw new Error("unterminated media block");
}

describe("input zoom — the rule exists and can actually win", () => {
  const block = inputZoomBlock();

  it("sets at least 16px", () => {
    const sizes = [...block.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    for (const px of sizes) expect(px).toBeGreaterThanOrEqual(16);
  });

  it("covers all three text-entry elements", () => {
    for (const el of ["input", "textarea", "select"]) {
      expect(block).toMatch(new RegExp(`(^|[\\s,])${el}\\b`, "m"));
    }
  });

  /**
   * THE ONE THAT MATTERS MOST, and the one a reader would not think to check.
   *
   * Tailwind v4 puts its utilities in `@layer utilities`. Layer order beats
   * specificity, so an unlayered rule wins over every utility — and a LAYERED
   * one loses to `text-sm` no matter how specific it is. Wrapping this file's
   * contents in a layer (a plausible tidy-up) would silently restore the bug on
   * all 47 `text-sm` inputs while every other assertion here still passed.
   */
  it("is NOT inside an @layer, or Tailwind's utilities would outrank it", () => {
    const at = css.indexOf(block);
    const before = css.slice(0, at);
    // Any unclosed `@layer <name> {` above this point would enclose the rule.
    let depth = 0;
    let insideLayer = false;
    const layerOpens: number[] = [];
    for (let i = 0; i < before.length; i++) {
      if (before[i] === "{") {
        depth++;
        if (/@layer[^{]*$/.test(before.slice(Math.max(0, i - 80), i))) layerOpens.push(depth);
      } else if (before[i] === "}") {
        if (layerOpens[layerOpens.length - 1] === depth) layerOpens.pop();
        depth--;
      }
    }
    insideLayer = layerOpens.length > 0;
    expect(insideLayer, "the input rule is inside an @layer and will lose to Tailwind").toBe(
      false
    );
  });

  /**
   * The width half alone misses iPad — 768px+ in portrait, and it zooms
   * identically. This is the clause most likely to be "simplified" away by
   * someone who reads the media query as redundant.
   */
  it("matches touch devices at ANY width, not just narrow ones", () => {
    expect(block).toMatch(/pointer:\s*coarse/);
    expect(block).toMatch(/max-width/);
  });

  /** Inputs only — the non-input type scale is not this rule's business. */
  it("does not reach past text-entry elements", () => {
    const selectors = block.slice(block.indexOf("{") + 1, block.lastIndexOf("}"));
    const head = selectors.slice(0, selectors.indexOf("{"));
    expect(head).not.toMatch(/(^|[\s,>])(div|span|p|body|html|\*)\b/);
  });
});

describe("input zoom — pinch-zoom stays available", () => {
  /**
   * THE REJECTED ALTERNATIVE, pinned. `maximum-scale=1` fixes the zoom in one
   * line and disables pinch-zoom for the whole app. Several BBMI crew are older
   * and will want to enlarge a scorecard; someone who needs the board bigger
   * must not lose that so an input behaves.
   *
   * This is a real risk rather than a hypothetical: it is the first result for
   * the symptom, and it would look like a tidy simplification of the rule
   * above — deleting a media query and adding a meta property.
   */
  it("sets no maximum-scale and no user-scalable in the viewport export", () => {
    expect(layout).not.toMatch(/maximumScale/);
    expect(layout).not.toMatch(/userScalable/);
    expect(layout).not.toMatch(/maximum-scale/);
    expect(layout).not.toMatch(/user-scalable/);
  });
});
