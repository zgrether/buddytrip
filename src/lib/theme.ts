/**
 * The theme switch — the value, where it is stored, and how a bad value is
 * repaired before anything renders.
 *
 * ── A STRING, NOT A BOOLEAN, AND THAT IS THE ONLY REASON THIS FILE EXISTS ──
 *
 * A boolean is a union with two members that cannot grow. There is already a
 * likely third theme — a high-contrast variant for reading a scorecard in
 * direct sun, which is NOT ordinary light mode (see the survey in the PR) — and
 * `isLight` threaded through the app is the same shape that forced a drift
 * unwind earlier this week. A string costs nothing today and makes a third
 * value additive: add it to `THEMES`, give it a block in `globals.css`, and
 * every consumer below is already correct.
 *
 * ── UNKNOWN FALLS BACK TO DARK, AND next-themes WILL NOT DO THAT FOR YOU ────
 *
 * next-themes reads storage with `localStorage.getItem(key) || defaultTheme`
 * and validates NOTHING (`node_modules/next-themes/dist/index.mjs`, the `H`
 * helper and the `M` boot script). A stored `"banana"` is applied verbatim as a
 * class name — which matches neither `.dark` nor anything else, so the page
 * resolves to `:root`, i.e. LIGHT. The wrong fallback, silently.
 *
 * So the value is repaired in storage BEFORE next-themes reads it, by
 * `THEME_SANITIZE_SCRIPT` running as an inline script earlier in the document
 * than the provider (see `src/app/layout.tsx`). Inline scripts execute in
 * document order, which is what makes the ordering a guarantee rather than a
 * hope.
 *
 * ── This module knows nothing about the menu ────────────────────────────────
 *
 * The menu ROW is gated by `src/lib/themeMenu.ts`, a separate module, and the
 * arrow points one way only: the menu imports the switch, the switch never
 * imports the menu. That is what "the item can come out and the switch keeps
 * working" means mechanically, and `theme.test.ts` guards it.
 */

/** Every theme the app can be in. Order is the order the menu renders. */
export const THEMES = ["dark", "light"] as const;

export type Theme = (typeof THEMES)[number];

/** Where the theme lives. `"theme"` is also next-themes' own default key —
 *  named here so the provider and the sanitize script cannot drift from it. */
export const THEME_STORAGE_KEY = "theme";

/** What an absent or unrecognised value resolves to. */
export const DEFAULT_THEME: Theme = "dark";

/** Human label for a theme, for the menu. */
export const THEME_LABELS: Record<Theme, string> = {
  dark: "Dark",
  light: "Light",
};

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/**
 * Any value → a theme. Anything not exactly one of `THEMES` becomes
 * `DEFAULT_THEME`, including `null`, `undefined`, `""`, and — the case a
 * boolean-storing build would produce — `"true"` / `"false"`.
 */
export function normalizeTheme(value: unknown): Theme {
  return isTheme(value) ? value : DEFAULT_THEME;
}

/** The subset of the Storage API this module needs, so tests can pass a stub. */
export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readStoredTheme(storage: ThemeStorage): Theme {
  try {
    return normalizeTheme(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    // Private mode, blocked site data, a browser that throws on access — the
    // theme is a preference, not a feature, so it degrades to the default.
    return DEFAULT_THEME;
  }
}

export function writeStoredTheme(storage: ThemeStorage, theme: Theme): void {
  try {
    storage.setItem(THEME_STORAGE_KEY, normalizeTheme(theme));
  } catch {
    /* see readStoredTheme */
  }
}

/**
 * Runs before the provider, in the document itself. Rewrites a stored value
 * that is not a known theme, so next-themes only ever reads something valid.
 *
 * Leaves an ABSENT value absent — next-themes' own `|| defaultTheme` handles
 * that, and writing on first visit would persist a choice the user never made.
 *
 * The constants are interpolated rather than retyped, so a rename to
 * `THEME_STORAGE_KEY` / `THEMES` / `DEFAULT_THEME` cannot leave this behind.
 * `theme.test.ts` executes this string against a storage stub — it is tested
 * code, not a comment.
 */
export const THEME_SANITIZE_SCRIPT = `(function(){try{var k=${JSON.stringify(
  THEME_STORAGE_KEY,
)};var ok=${JSON.stringify(THEMES)};var v=window.localStorage.getItem(k);if(v!==null&&ok.indexOf(v)===-1){window.localStorage.setItem(k,${JSON.stringify(
  DEFAULT_THEME,
)});}}catch(e){}})();`;
