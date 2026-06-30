"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * useGameSettingsOverlay — the ONE owner of the game settings (configuration)
 * overlay across every game page (golf stroke/match/rack + non-golf manual), so
 * the open/close/back behavior can't drift per-surface.
 *
 * Two ways the overlay opens, with DIFFERENT back semantics:
 *
 *  1. **Gear** (`openConfig`) — opened over the game scoreboard/pass-through. It
 *     pushes a browser history entry (same URL) so the in-page arrow and the
 *     OS/mouse back are the SAME action and both return to the game page.
 *     `closeConfig` → `history.back()` (popstate closes the overlay).
 *
 *  2. **Deep link** (`?settings=1`) — the leaderboard routes an owner/delegate of
 *     a SETUP-mode game straight here (the scoreboard has nothing to show yet, so
 *     the extra tap is skipped — decided at the link, not a land-then-redirect).
 *     The leaderboard→settings navigation is ITSELF the history entry below the
 *     overlay, so we do NOT push another one; `closeConfig` → `router.back()`
 *     returns to the leaderboard with no scoreboard flash and no loop.
 *
 * Edit-access gate: the deep-link auto-open is gated on `canEdit` (mirrors the
 * server's `canEditGame` — owner/organizer OR this game's delegate). A plain
 * member who somehow lands on `?settings=1` never auto-opens; they fall through
 * to the server-walled placeholder. The leaderboard only emits the param for
 * editors anyway — this is the belt-and-suspenders on the page.
 *
 * Returns `open` (alias it to the page's existing flag name to keep the rest of
 * the page untouched) plus the two handlers.
 */
export function useGameSettingsOverlay({
  canEdit,
  deepLink,
}: {
  /** Mirrors useGameEditAccess/canEditGame — gates the deep-link auto-open. */
  canEdit: boolean;
  /** The `?settings=1` deep-link marker is present on the URL. */
  deepLink: boolean;
}) {
  const router = useRouter();
  // The gear path opens imperatively; the deep-link path is DERIVED (no
  // setState-in-effect) — it's open as long as the URL marks it and edit access
  // holds. The leaderboard only ever closes a deep-linked overlay by navigating
  // away (router.back), which unmounts the page, so there's no "deep-linked but
  // closed while still here" state to track.
  const [userOpen, setUserOpen] = useState(false);
  const deepLinked = deepLink && canEdit;
  const open = userOpen || deepLinked;

  const openConfig = useCallback(() => {
    if (typeof window !== "undefined") window.history.pushState({ btCfg: true }, "");
    setUserOpen(true);
  }, []);

  const closeConfig = useCallback(() => {
    // Deep-linked: the entry below the overlay is the LEADERBOARD — go straight
    // back to it (single history pop, no scoreboard in between, no loop).
    if (deepLinked) {
      router.back();
      return;
    }
    // Gear path: our pushed entry is on top — history.back() so the arrow takes
    // the exact same path as the browser back (popstate → setUserOpen(false));
    // else close direct (safety fallback when no entry was pushed).
    if (typeof window !== "undefined" && (window.history.state as { btCfg?: boolean } | null)?.btCfg) {
      window.history.back();
    } else {
      setUserOpen(false);
    }
  }, [deepLinked, router]);

  // Real back (OS/mouse, or our own history.back()) closes a gear-opened overlay.
  useEffect(() => {
    const onPop = () => setUserOpen(false);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return { open, openConfig, closeConfig };
}
