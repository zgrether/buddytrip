import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bottomNavInset } from "./bottomNavInset";

/**
 * THE BOTTOM-NAV INSET, and the one property that gets lost when it is retyped.
 *
 * ── What is worth asserting here, and what is not ───────────────────────────
 *
 * The function is one template string, so a test that rebuilds the same string
 * and compares proves nothing — it is the assertion-that-cannot-fail shape.
 * What CAN go wrong is the SEMANTICS of the expression, and it has exactly one
 * subtlety: `var(--bt-bottomnav-height, env(safe-area-inset-bottom, 0px))` is a
 * FALLBACK chain, not an addition.
 *
 * That matters both ways round. The measured bar height already includes its
 * own safe-area padding, so ADDING `env()` where the bar is showing
 * double-counts and leaves a visible gap; and where the bar is unmounted (a
 * focused entry surface, a standalone game route) a bare `0px` would put
 * content under the home indicator. Whichever is present carries the inset and
 * they are never both counted.
 *
 * So the assertions below are about SHAPE — nesting, not summing — plus a
 * source guard that the stroke surface actually calls this rather than
 * reintroducing a fourth inline copy. That guard is the one with teeth: the bug
 * was a surface with NO inset, and a helper nobody calls fixes nothing.
 */

describe("bottomNavInset", () => {
  it("nests the safe-area fallback INSIDE the variable, never adds it", () => {
    const css = bottomNavInset(16);
    // The nesting, spelled out: the env() must sit in the var()'s fallback slot.
    expect(css).toContain("var(--bt-bottomnav-height, env(safe-area-inset-bottom, 0px))");
    // And must not appear as a second term. `+ env(` is the double-count bug
    // written out — the form someone reaches for when "add the safe area" is
    // read as an instruction rather than as a fallback.
    expect(css).not.toContain("+ env(");
    expect(css.match(/env\(/g) ?? []).toHaveLength(1);
  });

  it("carries the caller's own spacing on top of the bar height", () => {
    expect(bottomNavInset(16)).toContain("+ 16px)");
    expect(bottomNavInset(24)).toContain("+ 24px)");
    // Different addends, same clearance expression — the three inline copies
    // this replaces differ only in this number.
    expect(bottomNavInset(16).replace("16px", "24px")).toBe(bottomNavInset(24));
  });

  it("is a calc, so it composes with a CSS length context", () => {
    expect(bottomNavInset(0).startsWith("calc(")).toBe(true);
  });
});

describe("the stroke surface insets itself", () => {
  /**
   * A SOURCE GUARD, because the failure was structural rather than arithmetic.
   *
   * Stroke is the only one of the five game views that owns a scroll container
   * (`overflow-y-auto`), so it does not inherit `CompetitionFace`'s inset the
   * way the other four do — an absolutely positioned child's containing block
   * is its ancestor's padding box, so `inset-0` covers the padding the wrapper
   * adds. Nothing in the type system or the unit suite can see that; the
   * surface is a tRPC-hook component with no harness here, and the symptom is a
   * tile under the tabs.
   *
   * What is checkable is that the surface still calls this. If someone converges
   * it with the other four (#1312) this guard should be DELETED along with the
   * inset, not worked around — which is why it names that issue.
   */
  const SRC = readFileSync(
    join(process.cwd(), "src/components/games/StrokeGameView.tsx"),
    "utf8"
  );

  it("calls bottomNavInset on its scroll container", () => {
    expect(SRC).toContain('import { bottomNavInset } from "@/lib/bottomNavInset";');
    expect(SRC).toContain("paddingBottom: bottomNavInset(16),");
  });

  it("the guard is looking at the right file — the surface is still the scrolling one", () => {
    // Without this the test passes just as happily if the container moved or the
    // testid was renamed: "absence of matches is absence of search". If this
    // anchor fails, the guard above is no longer asserting anything about the
    // element that scrolls.
    expect(SRC).toContain('data-testid="stroke-surface"');
    expect(SRC).toContain('"absolute inset-0 overflow-y-auto"');
  });
});
