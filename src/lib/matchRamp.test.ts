import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * T5 — the match ramp is symmetric in LIGHT, and dark is untouched.
 *
 * The defect was not low contrast. The ramp encoded the winner as VALUE —
 * bright for A, dark for B — so which side you could see depended on what
 * colour the card was. On dark, A was 14.30 : 1 and B was 2.70 : 1. On light
 * that became 1.16 : 1 and 6.18 : 1: A's bar vanished and B's shouted. The two
 * sides swapped which of them was visible.
 *
 * So the assertion is a RATIO OF RATIOS, not a floor. A build that gives both
 * constants light values and clears 4.5 on each still fails if one side reads
 * twice as loud as the other, which is the fix that looks right.
 *
 * D3b scopes this to light. Dark keeps its existing asymmetry deliberately:
 * there it is quiet-vs-loud rather than present-vs-absent, nobody has reported
 * it, and retuning it would put a Cup surface on the dark delta list.
 */

const CSS = readFileSync(resolve(__dirname, "../app/globals.css"), "utf8");
const ROOT = CSS.slice(CSS.indexOf(":root {"), CSS.indexOf(".dark {"));
const DARK = CSS.slice(CSS.indexOf(".dark {"), CSS.indexOf("@theme inline"));

function token(block: string, name: string): string {
  const m = block.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`token --${name} not found in the block`);
  return m[1].trim().replace(/\s*\/\*.*$/, "");
}

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = ([r, g, b]: number[]) => {
  const f = (v: number) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a: number[], b: number[]) =>
  (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

const LIGHT_CARD = hex(token(ROOT, "color-bt-card"));

describe("T5 — the light ramp is symmetric", () => {
  const a = hex(token(ROOT, "color-bt-match-a"));
  const b = hex(token(ROOT, "color-bt-match-b"));

  it("neither side reads louder than the other", () => {
    const ratio = contrast(a, LIGHT_CARD) / contrast(b, LIGHT_CARD);
    // 0.7-1.4 — the band a reader cannot pick a winner from.
    expect(ratio).toBeGreaterThanOrEqual(0.7);
    expect(ratio).toBeLessThanOrEqual(1.4);
  });

  it("both sides are visible at all", () => {
    // Symmetry alone is satisfiable by two invisible marks.
    expect(contrast(a, LIGHT_CARD)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(b, LIGHT_CARD)).toBeGreaterThanOrEqual(4.5);
  });

  it("halved is distinct from BOTH, and quieter than either", () => {
    const h = hex(token(ROOT, "color-bt-match-halved"));
    // Distinct: landing on either member makes "neither won" read as a
    // half-win for that side.
    const dist = (x: number[], y: number[]) =>
      Math.abs(lum(x) - lum(y)) > 0.02 || x.join() !== y.join();
    expect(dist(h, a)).toBe(true);
    expect(dist(h, b)).toBe(true);
    // Quieter: a halved hole is the least significant outcome and must not be
    // the loudest mark on the strip.
    expect(contrast(h, LIGHT_CARD)).toBeLessThanOrEqual(contrast(a, LIGHT_CARD));
    expect(contrast(h, LIGHT_CARD)).toBeLessThanOrEqual(contrast(b, LIGHT_CARD));
    // Still readable as text — `Margin` paints the all-square "AS" with it.
    expect(contrast(h, LIGHT_CARD)).toBeGreaterThanOrEqual(4.5);
  });

  it("halved carries no hue — a cast leans toward one member of a cool/warm pair", () => {
    const h = hex(token(ROOT, "color-bt-match-halved"));
    expect(Math.max(...h) - Math.min(...h)).toBeLessThanOrEqual(6);
  });
});

describe("T3a — dark is unchanged, asserted on the RESOLVED value", () => {
  /**
   * Not "the `.dark` block looks right" — a token defined only in `:root` is
   * INHERITED by dark, so an empty override reads as clean and is precisely
   * the bug. These assert what dark actually resolves to.
   */
  const resolvedDark = (name: string) => {
    const m = DARK.match(new RegExp(`--${name}:\\s*([^;]+);`));
    return m ? m[1].trim().replace(/\s*\/\*.*$/, "") : token(ROOT, name);
  };

  it("keeps the ramp's original dark values", () => {
    expect(resolvedDark("color-bt-match-a")).toBe("#eaeef4");
    expect(resolvedDark("color-bt-match-b")).toBe("#566275");
    expect(resolvedDark("color-bt-match-halved")).toBe("#8c97a8");
  });

  it("keeps dark's original asymmetry — D3b ruled light only", () => {
    const darkCard = hex(resolvedDark("color-bt-card"));
    const ratio =
      contrast(hex(resolvedDark("color-bt-match-a")), darkCard) /
      contrast(hex(resolvedDark("color-bt-match-b")), darkCard);
    // ~5.3x. Asserted so that "fixing" dark too becomes a deliberate act.
    expect(ratio).toBeGreaterThan(4);
  });

  it("each ramp token is overridden in .dark, not left to inherit", () => {
    // The :root trap, asserted directly: if any of these falls out of the
    // `.dark` block, changing its light value silently changes dark.
    for (const n of ["color-bt-match-a", "color-bt-match-b", "color-bt-match-halved"]) {
      expect(DARK).toMatch(new RegExp(`--${n}:`));
    }
  });
});
