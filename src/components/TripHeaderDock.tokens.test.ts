import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * T1 + T6 for PR A — the Quick Info dock.
 *
 * The dock was written entirely for a dark card and never joined the token
 * system: 29 colour literals against 5 token references. On a light card its
 * tile values, its labels and its own panel fill were all white on white —
 * 7 of 7 text nodes below 3:1, none above, the lockbox code among them.
 *
 * These assert the repair holds, and they are written to fail against the
 * build that fixes only what is VISIBLE. Fixing the seven text nodes and
 * leaving the borders, the ring track, the shadows and the dashed CTA would
 * look correct in a screenshot and leave two thirds of the file unmigrated.
 */

const SRC = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(resolve(SRC, rel), "utf8");

/** Strip comments — prose ABOUT a literal must not trip a guard on literals.
 *  (This file's own explanatory comments quote hex values freely.) */
const codeOf = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Every way a colour can be written literally. `hsl`/`hsla` and 3/4/6/8-digit
 * hex are included even though the file never used them — the guard is against
 * the CLASS, not against the specific forms that happened to be there.
 */
const COLOUR_LITERAL =
  /#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*[\d.]|\bhsla?\(\s*[\d.]/g;

/** CSS named colours worth refusing. `transparent` and `currentColor` are not
 *  colours in the themeable sense and stay allowed. */
const NAMED_COLOUR = /\b(?:white|black|silver|gray|grey|red|green|blue|yellow|orange|purple|pink|brown|navy|teal|olive|maroon|lime|aqua|fuchsia)\b\s*(?=["';,}])/g;

/**
 * Documented exceptions. EMPTY, and that is the finding — every one of the 29
 * literals mapped onto a token that already existed, so nothing needed a
 * carve-out and nothing needed minting.
 *
 * An entry here must name the sentence in `STYLE_GUIDE.md` that permits it.
 * An entry without one is a failure, not an exception.
 */
const ALLOWLIST: { literal: string; because: string }[] = [];

describe("T1 — the Quick Info dock holds no colour literals", () => {
  it("has ZERO, not merely fewer", () => {
    const found = codeOf("components/TripHeaderDock.tsx").match(COLOUR_LITERAL) ?? [];
    const unexplained = found.filter(
      (f) => !ALLOWLIST.some((a) => f.startsWith(a.literal)),
    );
    // Named in the failure so the message says WHICH literal survived rather
    // than that a count moved.
    expect(unexplained).toEqual([]);
  });

  it("refuses CSS named colours too", () => {
    expect(codeOf("components/TripHeaderDock.tsx").match(NAMED_COLOUR) ?? []).toEqual([]);
  });

  it("every allowlist entry cites the sentence permitting it", () => {
    // Vacuously true today. It exists so that adding an exception without a
    // justification fails, rather than quietly widening the guard.
    for (const entry of ALLOWLIST) {
      expect(entry.because.length).toBeGreaterThan(20);
    }
  });

  it("is actually painting through tokens, not just empty of literals", () => {
    // A file that stopped setting colours at all would pass the assertions
    // above. This is the other half: the dock must still paint.
    const refs = read("components/TripHeaderDock.tsx").match(/var\(--(?:color-bt|shadow)-[a-z-]+\)/g) ?? [];
    expect(refs.length).toBeGreaterThanOrEqual(25);
  });
});

describe("T6 (PR A half) — the alpha-as-dimming precedent must not spread", () => {
  /**
   * `TripHeader.tsx:371-376` computes the correct light values for text over
   * the hero and hands them to the dock's SIBLING — using `rgba(0,0,0,0.85)`
   * and `rgba(0,0,0,0.55)`, which is the alpha-as-dimming class
   * `STYLE_GUIDE.md:197` forbids ("Never use opacity to dim text — use
   * explicit token values").
   *
   * D10: follow the shape, not the values. The dock uses `--color-bt-text`.
   * This guard is what stops the nearby precedent being copied later because
   * it is nearby.
   */
  it("the dock introduces no rgba(0,0,0,*) text colour", () => {
    const src = codeOf("components/TripHeaderDock.tsx");
    expect(src).not.toMatch(/color:\s*["'`]?rgba\(\s*0\s*,\s*0\s*,\s*0/);
  });

  it("the sibling precedent still exists and is REPORTED, not fixed", () => {
    // Deliberately asserts the unfixed state. If someone fixes TripHeader's
    // alpha pair, this fails and they update the finding rather than leaving
    // a report that describes a world that no longer exists.
    expect(codeOf("components/TripHeader.tsx")).toMatch(/rgba\(0,0,0,0\.85\)/);
  });
});
