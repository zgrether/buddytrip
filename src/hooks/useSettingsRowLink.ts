"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { parseSettingsRow, SETTINGS_ROW_PARAM, settingsRowTestId, type SettingsRow } from "@/lib/settingsRows";

/**
 * The settings row a link asked to open (`&row=<row>`, src/lib/settingsRows.ts),
 * read once at mount. A screen or a row group starts that row open from it; a
 * later tap is the reader's own and is never overridden.
 */
export function useSettingsRowLink(): SettingsRow | null {
  const search = useSearchParams();
  const [row] = useState(() => parseSettingsRow(search.get(SETTINGS_ROW_PARAM)));
  return row;
}

/**
 * Bring the linked row into view once it renders. An accordion row that starts
 * open already scrolls itself (`ChecklistRow`); this covers the rows with no
 * open state (Total Points, The Picks) and a row that renders after the
 * settings data arrives. Called once per settings screen, by the screen.
 */
export function useScrollToSettingsRow(row: SettingsRow | null): void {
  useEffect(() => {
    if (!row) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      const el = document.querySelector(`[data-testid="${settingsRowTestId(row)}"]`);
      tries += 1;
      if (el || tries > 50) {
        window.clearInterval(timer);
        el?.scrollIntoView({ block: "nearest" });
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [row]);
}
