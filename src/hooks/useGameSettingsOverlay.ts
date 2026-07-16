"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
 * **Confirm-on-leave (draft-then-save, P1.7).** Under the old model every row
 * persisted itself, so leaving the overlay could never lose anything. Now the whole
 * page is ONE draft that only commits on Save — which makes a back-press a silent
 * data-loss path. Pass `isDirty` and the overlay refuses to close while the draft has
 * unsaved edits, surfacing `confirmingClose` for the page to render a prompt on.
 *
 * Both exits are gated, and they need different handling:
 *  - `closeConfig` (the in-page arrow) hasn't touched history yet — just don't close.
 *  - **popstate** (OS/mouse back) has ALREADY consumed the entry by the time we hear
 *    about it, so blocking means pushing a replacement entry back on. Without that
 *    the next back-press would escape the page entirely.
 * `confirmDiscard` sets a one-shot force flag so its own `history.back()` isn't
 * re-caught by the very guard that raised the prompt (which would loop).
 *
 * Returns `open` (alias it to the page's existing flag name to keep the rest of
 * the page untouched) plus the handlers.
 */
export function useGameSettingsOverlay({
  canEdit,
  deepLink,
  isDirty,
  onDiscard,
}: {
  /** Mirrors useGameEditAccess/canEditGame — gates the deep-link auto-open. */
  canEdit: boolean;
  /** The `?settings=1` deep-link marker is present on the URL. */
  deepLink: boolean;
  /** Unsaved edits that closing would throw away. Omit → the old always-close
   *  behaviour (the self-persisting surfaces have nothing to lose). */
  isDirty?: () => boolean;
  /** Fired when the user confirms the discard — the page drops its draft. */
  onDiscard?: () => void;
}) {
  const router = useRouter();
  // The gear path opens imperatively; the deep-link path is DERIVED (no
  // setState-in-effect) — it's open as long as the URL marks it and edit access
  // holds. The leaderboard only ever closes a deep-linked overlay by navigating
  // away (router.back), which unmounts the page, so there's no "deep-linked but
  // closed while still here" state to track.
  const [userOpen, setUserOpen] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const deepLinked = deepLink && canEdit;
  const open = userOpen || deepLinked;

  // Latest-refs so the popstate listener (mounted once) reads the CURRENT draft
  // state rather than a stale closure from mount. Synced in an effect, not during
  // render — effects flush before any back-press can arrive, so the listener never
  // sees a stale value in practice.
  const isDirtyRef = useRef(isDirty);
  const onDiscardRef = useRef(onDiscard);
  useEffect(() => {
    isDirtyRef.current = isDirty;
    onDiscardRef.current = onDiscard;
  });
  // One-shot: the user chose Discard, so the next close skips the guard. Without it
  // confirmDiscard's own history.back() re-trips the popstate guard (the draft is
  // still dirty at that instant) and the prompt reappears forever.
  const forceRef = useRef(false);

  const openConfig = useCallback(() => {
    if (typeof window !== "undefined") window.history.pushState({ btCfg: true }, "");
    setUserOpen(true);
  }, []);

  const doClose = useCallback(() => {
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

  const closeConfig = useCallback(() => {
    // Nothing has been popped yet on this path — refusing to close is enough.
    if (!forceRef.current && isDirtyRef.current?.()) {
      setConfirmingClose(true);
      return;
    }
    doClose();
  }, [doClose]);

  /** Leave and throw the draft away. */
  const confirmDiscard = useCallback(() => {
    setConfirmingClose(false);
    onDiscardRef.current?.();
    forceRef.current = true; // let this ONE close through the guard
    doClose();
  }, [doClose]);

  /** Stay put and keep editing. */
  const cancelClose = useCallback(() => setConfirmingClose(false), []);

  // Real back (OS/mouse, or our own history.back()) closes a gear-opened overlay.
  useEffect(() => {
    const onPop = () => {
      if (forceRef.current) {
        forceRef.current = false;
        setUserOpen(false);
        return;
      }
      if (isDirtyRef.current?.()) {
        // The entry is ALREADY gone (popstate is after the fact), so staying put
        // means putting one back — otherwise the next back-press leaves the page
        // and the draft dies with it.
        window.history.pushState({ btCfg: true }, "");
        setConfirmingClose(true);
        return;
      }
      setUserOpen(false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return { open, openConfig, closeConfig, confirmingClose, confirmDiscard, cancelClose };
}
