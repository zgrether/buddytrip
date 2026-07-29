"use client";

import { useCallback, useEffect, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { pushMarker, replaceMarker, readOwner } from "@/lib/historyMarker";

/**
 * useAppView — the OUTER tab (Home · Trip · Cup), Phase 3.
 *
 * Chat is NOT one of these (Phase 6 — "chat becomes a tab-bar action, not a
 * destination"). It used to be a fourth `AppView`, rendered in place of
 * whichever tab was selected, which is exactly the bug this reworked: Chat and
 * Cup could both read "active" at once, tapping Chat abandoned wherever you
 * were, and a tablet-width band existed where Chat was the only thing
 * reachable on screen (no bottom nav, no top nav). Chat open/closed now lives
 * as ordinary local state (`AppShell`'s `chatOpen`), orthogonal to this hook —
 * see `useModalBackButton`, which chat reuses exactly as any other modal does.
 *
 * Same model as Phase 2's inner trip sub-tabs, one level up: the tab is DERIVED
 * from the URL (`?view=`), writes go through the History API, and the first step
 * away from the default pushes ONE sentinel that every later switch replaces. So
 * an excursion across all tabs costs one history entry, back returns to
 * where it started, and back again leaves.
 *
 * ── `?view=` and `?tab=` coexist, and `?tab=` is PRESERVED ───────────────────
 * `/trips/x?view=trip&tab=crew` is the normal shape: the outer tab says which
 * context surface you're on, the inner one says where you are inside Trip. They
 * are independent, so switching `?view=` deliberately carries `?tab=` through
 * untouched — otherwise checking the Cup and coming back would dump you on the
 * Trip Home sub-tab every time and you'd lose your place. `writeView` rebuilds
 * the query string from the CURRENT params rather than replacing it wholesale,
 * which is what makes that preservation automatic rather than a special case.
 *
 * ── Scope: persistent WITHIN a context, not across ───────────────────────────
 * Trip ↔ Cup are free — same route, no server round trip. Home is a
 * navigation, because Home is context-free and lives on `/dashboard` while the
 * other two are scoped to `/trips/[tripId]`. That is the deliberate trade:
 * context switches are rare and heavier by nature, and keeping them on a route
 * boundary is what preserves the anti-flash guarantee (see AppShell).
 */

export type AppView = "home" | "trip" | "cup";

export const APP_VIEWS: readonly AppView[] = ["home", "trip", "cup"] as const;

/**
 * The view a host shows when `?view=` is absent.
 *
 * Parameterised because the two scoped hosts differ: `/trips/[tripId]` defaults
 * to Trip, while `/trips/[tripId]/leaderboard` — kept as a deep-link alias for
 * the 8 in-app constructors and 7 E2E references that still point at it —
 * defaults to Cup. Same shell either way; only the landing tab differs.
 */
export function useAppView(defaultView: AppView = "trip"): {
  view: AppView;
  setView: (next: AppView) => void;
  /** Build the href another surface should link to for a given view. */
  hrefFor: (next: AppView) => string;
} {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const view = useMemo<AppView>(() => {
    const requested = searchParams.get("view");
    return (APP_VIEWS as readonly string[]).includes(requested ?? "")
      ? (requested as AppView)
      : defaultView;
  }, [searchParams, defaultView]);

  /** Current query string with `view` swapped and everything else — notably
   *  `tab` — carried through. Also drops `game`/`settings`/`scorecard` when
   *  leaving Cup: those are GameRow's panel/overlay params (`withParams` in
   *  `GameRow.tsx`), meaningless outside Cup, and leaving them in the URL is
   *  its own bug — a stale `?game=<id>` surviving a switch to Trip means the
   *  history entry that supposedly landed on "Trip" is, underneath, still
   *  carrying a live game-panel reference (see the reachability note this
   *  fixes alongside, in `AppShell`'s two-pane comment).
   */
  const urlFor = useCallback(
    (next: AppView) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === defaultView) params.delete("view");
      else params.set("view", next);
      if (next !== "cup") {
        params.delete("game");
        params.delete("settings");
        params.delete("scorecard");
      }
      const q = params.toString();
      return q ? `${pathname}?${q}` : pathname;
    },
    [pathname, searchParams, defaultView],
  );

  const setView = useCallback(
    (next: AppView) => {
      if (typeof window === "undefined" || next === view) return;
      const url = urlFor(next);
      // One sentinel for the whole excursion — see the header. `view` is its own
      // owner so it can be told apart from the inner `tab` sentinel, which may
      // already be on the stack from a sub-tab switch.
      if (readOwner(window.history.state) === "view") {
        replaceMarker("view", { btView: true }, url);
      } else {
        pushMarker("view", { btView: true }, url);
      }
    },
    [view, urlFor],
  );

  /**
   * Self-heal an untagged arrival at a non-default `?view=`.
   *
   * `setView`'s push/replace logic only runs on a TAP — it can't tag an entry
   * someone else wrote. `leaderboard/page.tsx`'s deep-link alias is exactly
   * that: it has to trigger Next's own `router.replace` to cross from its own
   * pathname to this one (a raw `history.replaceState` via `pushMarker`
   * can't reliably drive Next's cross-pathname route-tree transition, and a
   * same-tick `replaceMarker` call right after `router.replace()` would race
   * Next's own internal history write and risk being silently overwritten —
   * Next's replace isn't guaranteed synchronous), so the alias can't tag the
   * entry itself. This closes the gap from the landing side instead: an
   * entry with NO owner at all (`readOwner === null` — a raw Next
   * navigation, not merely "owned by something else") that nonetheless
   * encodes an explicit non-default view gets retagged in place —
   * `replaceMarker` keeps the entry's current depth and just stamps
   * ownership onto it, so this never navigates or adds an entry.
   *
   * Scoped to `readOwner === null`, not `!== "view"`: a `"panel"`/`"modal"`/
   * `"config"`/`"screen"` entry can legitimately carry the SAME `?view=cup`
   * in its URL (GameRow's `withParams` merges onto whatever's already
   * there) — retagging those to `"view"` would corrupt their real ownership.
   * Only a genuinely untagged entry is this gap.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (view === defaultView) return;
    if (readOwner(window.history.state) !== null) return;
    const q = searchParams.toString();
    replaceMarker("view", { btView: true }, q ? `${pathname}?${q}` : pathname);
  }, [view, defaultView, pathname, searchParams]);

  return { view, setView, hrefFor: urlFor };
}
