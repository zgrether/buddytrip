import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemeMenuRow } from "./ThemeMenuRow";
import { THEMES, THEME_LABELS } from "@/lib/theme";

/**
 * The VISIBLE case. Its sibling `ThemeMenuRow.hidden.test.tsx` mocks
 * `themeMenu` to false; a `vi.mock` applies to a whole file, which is why
 * these are two files rather than two `it`s.
 *
 * No visual assertions — `renderToStaticMarkup` has no layout engine, and the
 * PR this ships with is a survey whose instrument is Zach's eyes.
 */
describe("ThemeMenuRow", () => {
  const html = renderToStaticMarkup(<ThemeMenuRow />);

  it("renders one segment per theme, from THEMES", () => {
    // Anchored to per-theme testids, not to a count of buttons: a third theme
    // should make this pass by itself, and a MISSING theme should fail it.
    for (const theme of THEMES) {
      expect(html).toContain(`data-testid="theme-segment-${theme}"`);
      expect(html).toContain(`aria-label="${THEME_LABELS[theme]}"`);
    }
  });

  it("marks exactly one segment active", () => {
    // The distinction between segments is carried by `data-active` (and by
    // paint), so it is asserted on the attribute rather than on a class
    // string that several segments share.
    const active = html.match(/data-active="true"/g) ?? [];
    expect(active).toHaveLength(1);
  });

  it("defaults the active segment to dark when no theme has resolved yet", () => {
    // Server render, no provider: next-themes reports `undefined`, and the row
    // normalizes rather than highlighting nothing. Anchored to the dark
    // segment's own testid — `data-active="true"` alone would be satisfied by
    // the light segment being the one lit.
    expect(html).toMatch(/data-testid="theme-segment-dark"[^>]*data-active="true"/);
  });

  it("carries the row label and its group role", () => {
    expect(html).toContain('data-testid="user-menu-appearance"');
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain("Appearance");
  });

  it("uses only tokens for colour — no raw hex, no rgb literal", () => {
    // CLAUDE.md: never hardcode a hex. Asserted on the RENDERED markup rather
    // than on the source, so an inline style computed at render time is
    // covered too. This is the rule the survey in this PR is measuring the
    // rest of the app against; the new row should not add to the list.
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toMatch(/rgba?\(\s*\d/);
  });
});
