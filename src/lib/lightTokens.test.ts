import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";

/**
 * T2 / T3a / T4 / T6 for PR B — the token-value sweep.
 *
 * The class this file guards is the one no grep can find: a token resolving
 * correctly to a value that is wrong for the theme. The eight domain hues were
 * declared once in `:root`, inherited by dark, and every one of them picked
 * against a dark card — 1.55–3.42 : 1 on the light base, seven of eight below
 * 3 : 1. There was no literal to search for, which is why the survey's first
 * pass put them in the "visually correct" column.
 */

const CSS = readFileSync(resolve(__dirname, "../app/globals.css"), "utf8");
const ROOT = CSS.slice(CSS.indexOf(":root {"), CSS.indexOf(".dark {"));
const DARK = CSS.slice(CSS.indexOf(".dark {"), CSS.indexOf("@theme inline"));

const declared = (block: string, name: string) => {
  const m = block.match(new RegExp(`--${name}:\\s*([^;]+);`));
  return m ? m[1].trim().replace(/\s*\/\*.*$/, "") : null;
};
/** What the theme ACTUALLY resolves — dark falls through to `:root` when it has
 *  no override, which is the whole trap. Never inspect the block alone. */
const resolveDark = (name: string) => declared(DARK, name) ?? declared(ROOT, name);
const light = (name: string) => {
  const v = declared(ROOT, name);
  if (!v) throw new Error(`--${name} not declared in :root`);
  return v;
};

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = ([r, g, b]: number[]) => {
  const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a: number[], b: number[]) =>
  (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

const LIGHT_CARD = hex(light("color-bt-card"));
const LIGHT_BASE = hex(light("color-bt-base"));

const DOMAINS = ["home", "crew", "lodging", "agenda", "travel", "events", "receipts", "competition"];

/**
 * The bar. 4.5 : 1 is WCAG AA for normal text, and these hues are used at
 * 10–13px — tab labels, eyebrows, step numbers. If an approved value ever
 * lands below it for brand reasons, this constant is amended in the same PR so
 * the diff carries the decision rather than the suite quietly passing lower.
 */
const BAR = 4.5;

describe("T2 — every domain hue clears the bar in light", () => {
  for (const d of DOMAINS) {
    it(`${d} is legible on both the card and the base`, () => {
      const c = hex(light(`color-bt-domain-${d}`));
      expect(contrast(c, LIGHT_CARD)).toBeGreaterThanOrEqual(BAR);
      expect(contrast(c, LIGHT_BASE)).toBeGreaterThanOrEqual(BAR);
    });
  }

  it("the faint tint follows its own hue, so ink and wash stay a family", () => {
    // A hue that moved while its faint stayed behind would put a darkened ink
    // on a tint of the colour it used to be.
    for (const d of DOMAINS) {
      const [r, g, b] = hex(light(`color-bt-domain-${d}`));
      expect(light(`color-bt-domain-${d}-faint`)).toBe(`rgba(${r}, ${g}, ${b}, 0.13)`);
    }
  });
});

describe("T3a — dark's RESOLVED values are unchanged", () => {
  /** Every token PR B touches, with the value dark had before it. */
  const UNCHANGED: Record<string, string> = {
    "color-bt-domain-home": "#2dd4bf",
    "color-bt-domain-crew": "#fb7185",
    "color-bt-domain-lodging": "#3b82f6",
    "color-bt-domain-agenda": "#f97316",
    "color-bt-domain-travel": "#fb7185",
    "color-bt-domain-events": "#fbbf24",
    "color-bt-domain-receipts": "#22c55e",
    "color-bt-domain-competition": "#fbbf24",
    "color-bt-score-eagle": "#fcd34d",
    "color-bt-score-birdie": "#fca5a5",
    "color-bt-score-bogey": "#93c5fd",
    "color-bt-score-double": "#c4b5fd",
    "color-bt-zebra": "rgba(255, 255, 255, 0.025)",
  };

  for (const [name, was] of Object.entries(UNCHANGED)) {
    it(`${name} still resolves to ${was} in dark`, () => {
      expect(resolveDark(name)).toBe(was);
    });
  }

  it("every touched token is OVERRIDDEN in .dark, not left to inherit", () => {
    // The trap itself. A token declared only in `:root` is inherited by dark,
    // so an empty `.dark` block looks clean and is precisely the bug — the
    // light change would silently be a dark change too.
    const missing = Object.keys(UNCHANGED).filter((n) => declared(DARK, n) === null);
    expect(missing).toEqual([]);
  });
});

// ── T4 / T6 — source guards ────────────────────────────────────────────────
const SRC = resolve(__dirname, "..");
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) out.push(...walk(f));
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(f);
  }
  return out;
}
const APP_FILES = walk(SRC).filter((f) => !f.includes(`${"marketing"}`));
const codeOf = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("T4 — the score family is gone from app src/", () => {
  /**
   * Scoped to the WHOLE `GOLF_STYLE` object — the four `fg` hexes AND the four
   * dark-tuned `bg` tints. Scoping to the foregrounds alone lets a build that
   * fixes the numbers and leaves the chips behind pass green.
   *
   * `marketing/` is excluded: STYLE_GUIDE §7 marks it an open question and
   * explicitly do-not-migrate.
   */
  const FG = /#(?:fcd34d|fca5a5|93c5fd|c4b5fd)\b/i;

  /**
   * The four ACTUAL pairs, not a cross-product of the triples and the alphas.
   *
   * The first draft of this matched any of the four RGB triples with any of the
   * four alphas — sixteen combinations, of which twelve are not score tints —
   * and it failed on `InfoTileModal.tsx:112`'s `rgba(251,191,36,0.18)`, an
   * alert chip on a mode-independent dark gradient that has nothing to do with
   * golf. Over-broad rather than under-broad, so it erred loudly; a guard that
   * cries wolf gets loosened by the next person until it stops catching
   * anything.
   */
  const BG =
    /rgba\(\s*251\s*,\s*191\s*,\s*36\s*,\s*0\.22\s*\)|rgba\(\s*248\s*,\s*113\s*,\s*113\s*,\s*0\.18\s*\)|rgba\(\s*96\s*,\s*165\s*,\s*250\s*,\s*0\.16\s*\)|rgba\(\s*139\s*,\s*92\s*,\s*246\s*,\s*0\.20\s*\)/;

  it("no foreground pastel survives", () => {
    const hits = APP_FILES.filter((f) => FG.test(codeOf(f))).map((f) => f.replace(SRC, "src"));
    expect(hits).toEqual([]);
  });

  it("no dark-tuned background tint survives either", () => {
    const hits = APP_FILES.filter((f) => BG.test(codeOf(f))).map((f) => f.replace(SRC, "src"));
    expect(hits).toEqual([]);
  });
});

describe("T6 — no opacity- or alpha-as-dimming at the named sites", () => {
  it("the date-picker day cell no longer multiplies its token by 0.45", () => {
    const src = codeOf(resolve(SRC, "app/trips/[tripId]/components/setup-guide/SetDatesFlipCard.tsx"));
    expect(src).not.toMatch(/opacity:\s*inMonth\s*\?\s*1\s*:\s*0\.45/);
  });

  it("the trip card's dates no longer use rgba(0,0,0,*) as a text colour", () => {
    expect(codeOf(resolve(SRC, "components/TripCard.tsx"))).not.toMatch(/rgba\(0,\s*0,\s*0,\s*0\.45\)/);
  });
});
