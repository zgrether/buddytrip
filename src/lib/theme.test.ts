import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  DEFAULT_THEME,
  THEMES,
  THEME_SANITIZE_SCRIPT,
  THEME_STORAGE_KEY,
  isTheme,
  normalizeTheme,
  readStoredTheme,
  writeStoredTheme,
  type ThemeStorage,
} from "./theme";

/** A localStorage stand-in. `raw` is the bag the assertions read, so a test can
 *  see WHAT was written, not just what reads back — which is the whole
 *  difference between catching a boolean build and not. */
function makeStorage(initial: Record<string, string> = {}) {
  const raw: Record<string, string> = { ...initial };
  const storage: ThemeStorage = {
    getItem: (k) => (k in raw ? raw[k] : null),
    setItem: (k, v) => {
      raw[k] = v;
    },
  };
  return { storage, raw };
}

// ── 1. The value round-trips as a STRING ───────────────────────────────────
//
// Spec test 1. Fails against a build that stores a boolean — which "works"
// today and makes a third theme a refactor rather than an addition.
describe("the theme value is a string", () => {
  it("writes the theme name itself, not a flag", () => {
    for (const theme of THEMES) {
      const { storage, raw } = makeStorage();
      writeStoredTheme(storage, theme);
      const stored = raw[THEME_STORAGE_KEY];
      // The assertion a boolean build cannot satisfy: not merely "truthy for
      // light", but the literal name. `"true"` / `"false"` / `"1"` all fail.
      expect(stored).toBe(theme);
      expect(typeof stored).toBe("string");
      expect(readStoredTheme(storage)).toBe(theme);
    }
  });

  it("has more than two members' worth of room — the union is open", () => {
    // Not a count assertion (the set is allowed to grow); the point is that
    // membership is decided by the LIST, so adding one is additive. A boolean
    // model cannot express this test at all.
    expect(isTheme("light")).toBe(true);
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("high-contrast")).toBe(false); // not yet — but nameable
    expect(THEMES.every((t) => isTheme(t))).toBe(true);
  });
});

// ── 2. An unknown value falls back to DARK ─────────────────────────────────
//
// next-themes does not do this: it applies a stored value verbatim as a class
// name, so an unrecognised one matches no `.dark` rule and the page resolves
// to `:root` — LIGHT. The wrong direction, silently. Hence the sanitize
// script, which is executed below rather than described.
describe("an unknown stored value falls back to dark", () => {
  it("normalizes every non-theme value to the default", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "banana",
      "system",
      "Light", // case matters — the class name is exact
      "true", // what a boolean build would leave behind
      "false",
      "1",
      0,
      true,
      {},
      [],
    ]) {
      expect(normalizeTheme(bad)).toBe(DEFAULT_THEME);
    }
    expect(DEFAULT_THEME).toBe("dark");
  });

  it("readStoredTheme repairs a corrupt stored value", () => {
    const { storage } = makeStorage({ [THEME_STORAGE_KEY]: "banana" });
    expect(readStoredTheme(storage)).toBe("dark");
  });

  it("survives a storage that throws (private mode, blocked site data)", () => {
    const throwing: ThemeStorage = {
      getItem() {
        throw new Error("SecurityError");
      },
      setItem() {
        throw new Error("SecurityError");
      },
    };
    expect(readStoredTheme(throwing)).toBe(DEFAULT_THEME);
    expect(() => writeStoredTheme(throwing, "light")).not.toThrow();
  });
});

// ── The sanitize script, RUN rather than read ──────────────────────────────
//
// The script is what actually protects the boot path — everything above is a
// module next-themes never calls. So it is executed here against a storage
// stub. A version of this test that asserted the script's TEXT would pass
// against a script that does nothing.
describe("THEME_SANITIZE_SCRIPT (executed)", () => {
  function run(initial: Record<string, string>) {
    const { storage, raw } = makeStorage(initial);
    const fn = new Function("window", THEME_SANITIZE_SCRIPT);
    fn({ localStorage: storage });
    return raw;
  }

  it("rewrites an unrecognised value to dark", () => {
    expect(run({ [THEME_STORAGE_KEY]: "banana" })[THEME_STORAGE_KEY]).toBe("dark");
    expect(run({ [THEME_STORAGE_KEY]: "system" })[THEME_STORAGE_KEY]).toBe("dark");
    expect(run({ [THEME_STORAGE_KEY]: "true" })[THEME_STORAGE_KEY]).toBe("dark");
  });

  it("leaves a valid value alone — both of them", () => {
    for (const theme of THEMES) {
      expect(run({ [THEME_STORAGE_KEY]: theme })[THEME_STORAGE_KEY]).toBe(theme);
    }
  });

  it("leaves ABSENT absent — first visit is not a stored choice", () => {
    // Writing here would persist a preference the user never expressed, and
    // next-themes' own `|| defaultTheme` already covers the empty case.
    expect(THEME_STORAGE_KEY in run({})).toBe(false);
  });

  it("does not throw when localStorage access throws", () => {
    const fn = new Function("window", THEME_SANITIZE_SCRIPT);
    expect(() =>
      fn({
        get localStorage(): never {
          throw new Error("SecurityError");
        },
      }),
    ).not.toThrow();
  });
});

// ── 3. The menu item and the switch are INDEPENDENT ────────────────────────
//
// Spec test 2. "Hidden" must not mean "disabled": if the survey says the work
// is large the row comes out of the menu and a stored theme still has to
// apply. That is a statement about the DEPENDENCY ARROWS, so it is asserted
// against the source — a render-only test cannot see a provider that stopped
// applying the theme.
//
// The wrong build these fail against is the current one before this PR:
// `forcedTheme="dark"` overrides storage, system preference and every
// setTheme call, so the switch would be inert no matter what the menu did.
const SRC = resolve(__dirname, "..");

/** Strip comments so prose ABOUT a pattern can't satisfy a guard on it. */
function codeOf(relPath: string): string {
  return readFileSync(resolve(SRC, relPath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("hiding the menu row cannot disable the switch", () => {
  it("the switch does not import the menu's visibility flag", () => {
    // If it did, hiding the row could change what theme resolves — which is
    // the exact failure this test exists for.
    expect(codeOf("lib/theme.ts")).not.toMatch(/themeMenu/);
  });

  it("the provider does not import the menu's visibility flag", () => {
    expect(codeOf("lib/providers.tsx")).not.toMatch(/themeMenu/);
  });

  it("the provider does not force a theme", () => {
    // `forcedTheme` overrides storage AND setTheme, so its presence means the
    // switch is dead regardless of whether the row renders. This is the
    // assertion that fails against the pre-PR build.
    expect(codeOf("lib/providers.tsx")).not.toMatch(/forcedTheme/);
  });

  it("the provider applies the stored theme from the shared storage key", () => {
    const src = codeOf("lib/providers.tsx");
    expect(src).toMatch(/storageKey=\{THEME_STORAGE_KEY\}/);
    expect(src).toMatch(/defaultTheme=\{DEFAULT_THEME\}/);
  });

  it("the boot repair runs from the layout, not from the menu", () => {
    // The layout is rendered on every route whether or not an account menu is
    // mounted at all — a signed-out page has no UserMenu.
    expect(codeOf("app/layout.tsx")).toMatch(/THEME_SANITIZE_SCRIPT/);
    expect(codeOf("components/ThemeMenuRow.tsx")).not.toMatch(/THEME_SANITIZE_SCRIPT/);
  });

  it("the menu row is the ONLY reader of the visibility flag", () => {
    // "Hidden in one place" is only true if one place reads it. A second
    // reader elsewhere would be a second thing to find and flip.
    const readers = ["components/ThemeMenuRow.tsx", "lib/theme.ts", "lib/providers.tsx", "components/UserMenu.tsx"]
      .filter((f) => /THEME_MENU_VISIBLE/.test(codeOf(f)));
    expect(readers).toEqual(["components/ThemeMenuRow.tsx"]);
  });
});
