import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The render half of "the row can be hidden without disabling the switch".
 * `src/lib/theme.test.ts` holds the structural half (no dependency arrow from
 * the switch or the provider back to the menu, and no `forcedTheme`).
 *
 * This file exists SEPARATELY because `vi.mock` rewrites the whole module
 * graph for the file it appears in, and the visible case has to be rendered
 * from an unmocked graph — `ThemeMenuRow.test.tsx` does that.
 *
 * The mock is only over `themeMenu`. `theme.ts` is deliberately NOT mocked, so
 * the assertions below exercise the real switch with the row hidden.
 */
vi.mock("@/lib/themeMenu", () => ({ THEME_MENU_VISIBLE: false }));

import { ThemeMenuRow } from "./ThemeMenuRow";
import {
  THEME_SANITIZE_SCRIPT,
  THEME_STORAGE_KEY,
  normalizeTheme,
  readStoredTheme,
  writeStoredTheme,
  type ThemeStorage,
} from "@/lib/theme";

describe("with THEME_MENU_VISIBLE false", () => {
  it("renders nothing at all", () => {
    // Not `not.toContain("Appearance")` — that would also pass against a row
    // that rendered its control with the label missing. Empty is the claim.
    expect(renderToStaticMarkup(<ThemeMenuRow />)).toBe("");
  });

  it("still stores and reads a theme — the switch is untouched", () => {
    const raw: Record<string, string> = {};
    const storage: ThemeStorage = {
      getItem: (k) => (k in raw ? raw[k] : null),
      setItem: (k, v) => {
        raw[k] = v;
      },
    };
    writeStoredTheme(storage, "light");
    expect(raw[THEME_STORAGE_KEY]).toBe("light");
    expect(readStoredTheme(storage)).toBe("light");
    expect(normalizeTheme("banana")).toBe("dark");
  });

  it("still repairs a corrupt stored value on boot", () => {
    const raw: Record<string, string> = { [THEME_STORAGE_KEY]: "banana" };
    const storage: ThemeStorage = {
      getItem: (k) => (k in raw ? raw[k] : null),
      setItem: (k, v) => {
        raw[k] = v;
      },
    };
    new Function("window", THEME_SANITIZE_SCRIPT)({ localStorage: storage });
    expect(raw[THEME_STORAGE_KEY]).toBe("dark");
  });
});
