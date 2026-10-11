"use client";

import { createContext, useContext } from "react";

/** The Trip settings screens a link elsewhere can open straight onto. */
export type TripSettingsView = "transfer" | "delete";

/**
 * Open Trip settings from inside the trip page (PR 8d-3).
 *
 * `TripSettingsModal` is the trip page's own state, so a control deep in a tab
 * — the Owner's "you can't leave yet" on the Crew tab — had no way to reach
 * it. The page provides this for the Owner only (the one role its gear opens
 * settings for); everywhere else it is `null`, and a caller renders its text
 * without a link rather than a link to nothing.
 */
const OpenTripSettings = createContext<((view?: TripSettingsView) => void) | null>(null);

export const TripSettingsOpenerProvider = OpenTripSettings.Provider;

export function useOpenTripSettings() {
  return useContext(OpenTripSettings);
}
