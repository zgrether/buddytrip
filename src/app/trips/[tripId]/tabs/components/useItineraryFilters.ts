"use client";

import { useCallback, useEffect, useState } from "react";

// ── useItineraryFilters ──────────────────────────────────────────────────
//
// Persists the itinerary filter selection per trip in localStorage, so a
// member's choice of which categories to show survives reloads and tab
// switches (a per-trip user preference on this device).
//
// We store the set of HIDDEN categories (the ones explicitly toggled off),
// NOT the shown set. This is deliberate: categories appear over time (the
// first departure someone enters adds a "departures" filter that didn't exist
// before). Storing "what I turned off" means a newly-appearing category
// defaults to SHOWN — the alternative (storing the shown set) would silently
// hide any category that didn't exist when the preference was saved.

export type ItineraryFilterCategory =
  | "lodging"
  | "arrivals"
  | "departures"
  | "events";

const ALL: ItineraryFilterCategory[] = ["lodging", "arrivals", "departures", "events"];
const KEY = (tripId: string) => `bt-trip-${tripId}-itinerary-filters`;

/** Parse a stored payload into a validated set of hidden categories. Pure +
 *  exported so it can be unit-tested without a DOM. Tolerates garbage. */
export function parseHiddenFilters(raw: string | null): Set<ItineraryFilterCategory> {
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(
      arr.filter((c): c is ItineraryFilterCategory =>
        (ALL as string[]).includes(c),
      ),
    );
  } catch {
    return new Set();
  }
}

function readHidden(tripId: string): Set<ItineraryFilterCategory> {
  if (typeof window === "undefined") return new Set();
  try {
    return parseHiddenFilters(window.localStorage.getItem(KEY(tripId)));
  } catch {
    return new Set();
  }
}

function sameSet(
  a: Set<ItineraryFilterCategory>,
  b: Set<ItineraryFilterCategory>,
): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/**
 * Returns [hidden, setHidden]. `hidden` is the set of categories the member
 * has toggled off for this trip; the caller derives the shown set from it.
 */
export function useItineraryFilters(
  tripId: string,
): [Set<ItineraryFilterCategory>, (next: Set<ItineraryFilterCategory>) => void] {
  // Lazy initializer reads localStorage on first render (SSR → empty set).
  const [hidden, setHiddenState] = useState<Set<ItineraryFilterCategory>>(() =>
    readHidden(tripId),
  );

  // Re-sync when tripId changes (route swap). localStorage is the external
  // system this effect subscribes to — the whitelisted case for the lint rule.
  useEffect(() => {
    const next = readHidden(tripId);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHiddenState((cur) => (sameSet(cur, next) ? cur : next));
  }, [tripId]);

  const setHidden = useCallback(
    (next: Set<ItineraryFilterCategory>) => {
      setHiddenState(next);
      if (typeof window === "undefined") return;
      try {
        if (next.size === 0) window.localStorage.removeItem(KEY(tripId));
        else window.localStorage.setItem(KEY(tripId), JSON.stringify([...next]));
      } catch {
        // Storage disabled / private mode — state still flips in memory.
      }
    },
    [tripId],
  );

  return [hidden, setHidden];
}
