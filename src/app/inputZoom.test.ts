import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
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
 *
 * ── And "mechanism" means the one that DECIDES, which this file got wrong ───
 * This guard was green while the bug was live on a real iPhone. Every check it
 * made was about winning against a class — unlayered, outranks `text-sm` — and
 * an inline `style` attribute never enters that contest at all; it is a higher
 * cascade origin. So the file asserted a true thing ADJACENT to the one that
 * mattered, which is worse than asserting nothing: it reported coverage of a
 * case it did not test. The `!important` assertion below is the repair.
 *
 * The general form, worth carrying to any guard: ask what would have to be
 * true for this to pass while the bug ships. Here the answer was "an inline
 * style anywhere", and that is the house style.
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

  /**
   * THE ONE THIS GUARD USED TO MISS, and the reason the bug came back green.
   *
   * Every other assertion here is about beating a CLASS — being unlayered,
   * outranking `text-sm`. All true, all irrelevant to an inline `style`
   * attribute, which is a different cascade ORIGIN and outranks every normal
   * author declaration however it is written. The rule was intact, the guard
   * was green, and 13 text-entry elements carrying an inline sub-16px size
   * zoomed anyway — Quick Play's name field among them.
   *
   * Only an important author declaration reaches that case. So the guard has
   * to assert the mechanism that decides the outcome, not the one that decides
   * the argument with Tailwind.
   */
  it("is !important, the only thing that outranks an inline style", () => {
    const decls = [...block.matchAll(/font-size:\s*[\d.]+px\s*(!important)?/g)];
    expect(decls.length).toBeGreaterThan(0);
    for (const d of decls) {
      expect(
        d[1],
        "font-size here is not !important — every inline `style={{ fontSize }}` beats it and zooms"
      ).toBe("!important");
    }
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

describe("input zoom — the opt-out cannot reopen the hole", () => {
  /**
   * `data-font-size-ok` exempts an element from the global rule, which exists
   * for exactly one reason: `!important` overrides downward too, and would
   * shrink the 22px game-name field.
   *
   * An exemption is only safe while every user of it is already at or above
   * 16px — the threshold below which iOS zooms. That is checkable, so it is
   * checked: an opt-out carrying `fontSize: 14` would be indistinguishable
   * from the original bug, and this is what stops it being written.
   */
  const files: string[] = [];
  (function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".tsx")) files.push(full);
    }
  })(path.join(ROOT, "src"));

  it("is used only by elements already at 16px or larger", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const m of [...src.matchAll(/<(input|textarea|select)\b/gi)]) {
        // Walk to the end of the opening tag, tracking braces so nested {} are fine.
        let i = m.index! + m[0].length;
        let depth = 0;
        while (i < src.length) {
          const c = src[i];
          if (c === "{") depth++;
          else if (c === "}") depth--;
          else if (c === ">" && depth === 0) break;
          i++;
        }
        const tag = src.slice(m.index!, i);
        if (!/data-font-size-ok/.test(tag)) continue;
        const sizes = [
          ...[...tag.matchAll(/fontSize:\s*([\d.]+)/g)].map((x) => Number(x[1])),
          ...[...tag.matchAll(/text-\[(\d+)px\]/g)].map((x) => Number(x[1])),
        ];
        const line = src.slice(0, m.index!).split("\n").length;
        if (sizes.length === 0) {
          offenders.push(`${path.relative(ROOT, file)}:${line} opts out but sets no size`);
        } else if (Math.min(...sizes) < 16) {
          offenders.push(`${path.relative(ROOT, file)}:${line} opts out at ${Math.min(...sizes)}px`);
        }
      }
    }
    expect(offenders, `data-font-size-ok on sub-16px input(s) — these will zoom on iOS:\n${offenders.join("\n")}`).toEqual([]);
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
