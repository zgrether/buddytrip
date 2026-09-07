"use client";

import { useTheme } from "next-themes";
import { IconSunMoon, IconMoon, IconSun } from "@tabler/icons-react";
import type { Icon } from "@tabler/icons-react";
import { THEMES, THEME_LABELS, normalizeTheme, type Theme } from "@/lib/theme";
import { THEME_MENU_VISIBLE } from "@/lib/themeMenu";

/**
 * The Appearance row in the account menu — directly above Settings.
 *
 * ── A SEGMENT PER THEME, RENDERED FROM `THEMES` ────────────────────────────
 *
 * Not a two-state toggle. The value is a string precisely because a third
 * theme is expected, and a toggle is a boolean wearing different clothes: it
 * would have to be rebuilt the day that theme lands. Mapping over `THEMES`
 * means the row grows by itself.
 *
 * Icon-only segments because the dropdown is 240px on desktop and the label
 * plus two worded segments does not fit at that width. The label is on the
 * control (`aria-label`), so the row reads correctly to a screen reader and to
 * a hover.
 *
 * ── Hiding ─────────────────────────────────────────────────────────────────
 *
 * `THEME_MENU_VISIBLE` (its own module) is the whole hiding mechanism. This
 * component returns null; nothing about the switch itself is touched, so a
 * theme already stored still applies and `setTheme` still works from anywhere.
 */

const THEME_ICONS: Record<Theme, Icon> = {
  dark: IconMoon,
  light: IconSun,
};

export function ThemeMenuRow() {
  const { theme, setTheme } = useTheme();

  if (!THEME_MENU_VISIBLE) return null;

  // next-themes hands back whatever is in storage, unvalidated — see the note
  // in `src/lib/theme.ts`. Normalising here means the row never highlights a
  // segment that does not exist.
  const current = normalizeTheme(theme);

  return (
    <div
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px]"
      style={{ color: "var(--color-bt-text)" }}
      data-testid="user-menu-appearance"
    >
      <IconSunMoon
        size={16}
        stroke={1.75}
        style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }}
        aria-hidden="true"
      />
      <span className="flex-1">Appearance</span>
      <div
        role="radiogroup"
        aria-label="Appearance"
        className="flex items-center gap-0.5 rounded-lg p-0.5"
        style={{ background: "var(--color-bt-card-raised)" }}
      >
        {THEMES.map((t) => {
          const ThemeIcon = THEME_ICONS[t];
          const active = t === current;
          return (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={THEME_LABELS[t]}
              title={THEME_LABELS[t]}
              data-testid={`theme-segment-${t}`}
              data-active={active ? "true" : "false"}
              onClick={() => setTheme(t)}
              // `active:scale-[0.98]` — the compact-cell value, matching the
              // other icon-sized controls in the shell rather than the gentler
              // 0.99 the full-width menu rows use.
              className="flex h-6 w-7 items-center justify-center rounded-md transition-[background-color,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-bt-accent)]"
              style={{
                background: active ? "var(--color-bt-accent-faint)" : "transparent",
                color: active ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
                border: active
                  ? "1px solid var(--color-bt-accent-border)"
                  : "1px solid transparent",
              }}
            >
              <ThemeIcon size={14} stroke={1.75} aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
