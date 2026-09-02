import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ValueUnitParts } from "./ValueUnit";
import { ScoringStateBanner } from "./games/ScoringStateBanner";

/**
 * THE COUNTDOWN'S UNIT IS SMALLER THAN THE VALUE — EVERY OTHER `ValueUnit`
 * CALLER IS UNCHANGED.
 *
 * Two claims, and the spec is explicit that both have to hold or the fix is
 * wrong in one of two opposite directions:
 *
 *   · the countdown's "h"/"m" render SMALLER than its digits — a size
 *     difference, not colour alone;
 *   · every OTHER `ValueUnit` caller — the "worth N pts" ribbon among them —
 *     renders EXACTLY as before: value and unit at the same size.
 *
 * A build that shrinks the unit inside `ValueUnit` GLOBALLY (moves the
 * default rather than adding an opt-in) passes the first claim and fails the
 * second — and a test that only looks at the countdown cannot see that. So
 * this asserts BOTH, against real call sites rather than synthetic props: the
 * ribbon is `ScoringStateBanner`'s actual "worth N pts" render (§1 of this same
 * batch — the very ribbon the floating duplicate was removed in favour of),
 * and the countdown is `ValueUnitParts` called the way `PickemSheet.tsx`
 * actually calls it (`size={24}`, `unitSize={14}`).
 *
 * Sizes are read out of the rendered HTML with a regex anchored to the
 * text node, not guessed at — confirmed against a throwaway probe render
 * before this file was written, so the patterns below match what React's
 * server renderer actually emits (attribute order included).
 */

/** The `font-size` (in px, as a string) of the `<span>` wrapping `text` —
 *  exactly the shape `ValueUnit` emits: `style="font-size:Npx;color:...">text`. */
function fontSizeOf(html: string, text: string): string {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = html.match(new RegExp(`font-size:([0-9.]+)px;color:[^"]*">${escaped}<`));
  if (!m) throw new Error(`could not find a sized span for "${text}" in: ${html}`);
  return m[1];
}

describe("the countdown's unit is smaller than its value", () => {
  it("h/m render at a different, smaller font-size than the digits", () => {
    // PickemSheet.tsx's actual call: size={24}, unitSize={14}.
    const html = renderToStaticMarkup(
      <ValueUnitParts
        parts={[
          { value: "54", unit: "h" },
          { value: "09", unit: "m" },
        ]}
        size={24}
        unitSize={14}
        weight={800}
      />
    );
    expect(fontSizeOf(html, "54")).toBe("24");
    expect(fontSizeOf(html, "h")).toBe("14");
    expect(fontSizeOf(html, "09")).toBe("24");
    expect(fontSizeOf(html, "m")).toBe("14");
    // The claim itself, not just the two numbers separately — a build that
    // happened to pick 24 for both would pass the two lines above only by
    // coincidence if they were asserted with `toBeLessThan` instead of exact
    // values; this is the direct statement of "smaller".
    expect(Number(fontSizeOf(html, "h"))).toBeLessThan(Number(fontSizeOf(html, "54")));
  });

  it("holds at both extremes — three-digit hours and a single-digit minute", () => {
    // "120h 05m" and "00h 47m" — the two shapes the spec names, checked in the
    // same render rather than assumed to generalise from "54h 09m".
    const long = renderToStaticMarkup(
      <ValueUnitParts parts={[{ value: "120", unit: "h" }, { value: "05", unit: "m" }]} size={24} unitSize={14} weight={800} />
    );
    expect(fontSizeOf(long, "120")).toBe("24");
    expect(fontSizeOf(long, "h")).toBe("14");

    const short = renderToStaticMarkup(
      <ValueUnitParts parts={[{ value: "00", unit: "h" }, { value: "47", unit: "m" }]} size={24} unitSize={14} weight={800} />
    );
    expect(fontSizeOf(short, "00")).toBe("24");
    expect(fontSizeOf(short, "m")).toBe("14");
  });
});

describe("every other ValueUnit caller is unchanged", () => {
  it("the 'worth N pts' ribbon renders its unit at the SAME size as its value", () => {
    // The real ribbon (§1 of this batch), not a stand-in — ScoringStateBanner
    // calls ValueUnit with no `unitSize`, so this is the exact call the
    // countdown's fix must leave untouched.
    const html = renderToStaticMarkup(
      <ScoringStateBanner status="active" correctionsOpen={false} pointsTotal={8} />
    );
    const valueSize = fontSizeOf(html, "8");
    const unitSize = fontSizeOf(html, "pts");
    expect(unitSize).toBe(valueSize);
    expect(valueSize).toBe("12.5");
  });
});
