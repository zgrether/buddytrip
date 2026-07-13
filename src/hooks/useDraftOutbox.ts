"use client";

import { useCallback, useEffect, useRef } from "react";
import { draftOutboxPut, draftOutboxClear, draftOutboxRecover, type DraftView } from "@/lib/draftOutbox";

/**
 * useDraftOutbox — mirrors an in-progress setup draft to a localStorage outbox
 * (see draftOutbox.ts) so a HARD teardown (refresh / tab-close / OS-kill /
 * background) can't lose it, and restores it on return. Shared by MatchGameView
 * (pairings) and RackGameView (groupings) — the two forked draft paths.
 *
 * This is Layer 2, ON TOP of the existing in-app three-layer flush net (which is
 * unchanged and still handles every in-app exit). It only fills the teardown gap
 * that net structurally can't reach.
 *
 * Contract:
 *  - Mirrors `draft` whenever it changes AND the user has TOUCHED it (an
 *    untouched draft equals the server — nothing to save), while `enabled`
 *    (setup-mode only). `base` = the server fingerprint the draft diverged from,
 *    frozen at first touch, so recover() can reject a stale-over-newer restore.
 *  - `pagehide` + `visibilitychange`→hidden commit the CURRENT draft
 *    SYNCHRONOUSLY (an async write wouldn't finish during teardown). pagehide is
 *    the mobile-reliable signal (beforeunload is not); visibilitychange→hidden
 *    covers app-backgrounding before an OS kill. No beforeunload — matches the
 *    proven scoreOutbox choice.
 *  - recover() returns the stored draft iff the server is unchanged since it
 *    diverged; the view restores it into its editing state (and marks it touched
 *    so the in-app net will persist it).
 *  - clear() drops the entry after a durable server persist (or discard).
 */
export function useDraftOutbox<T>(opts: {
  view: DraftView;
  gameId: string | null | undefined;
  draft: T;
  touched: boolean;
  /** Fingerprint of the server-derived draft (JSON of the persisted state). */
  serverFingerprint: string;
  /** Setup-mode only — never mirror/commit against a live/scoring game. */
  enabled: boolean;
}) {
  const { view, gameId, draft, touched, serverFingerprint, enabled } = opts;

  // Latest-refs so the teardown listeners (stable, empty-ish deps) read current
  // values synchronously without re-subscribing on every edit.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const touchedRef = useRef(touched);
  touchedRef.current = touched;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const gameIdRef = useRef(gameId);
  gameIdRef.current = gameId;
  // base = the server fingerprint the current draft diverged from. Tracks the
  // live server fingerprint WHILE untouched (draft == server), then freezes at
  // the first edit so it records what the edits diverged from.
  const baseRef = useRef(serverFingerprint);

  const draftStr = JSON.stringify(draft);

  // Mirror-on-edit (+ base tracking). Runs after each render where the draft,
  // touched, or server fingerprint changed.
  useEffect(() => {
    if (!enabled || !gameId) return;
    if (!touched) {
      // Still equal to the server — nothing to persist; keep base current.
      baseRef.current = serverFingerprint;
      return;
    }
    draftOutboxPut(view, gameId, draft, baseRef.current, Date.now());
    // draft is captured via draftStr in deps; ref not needed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftStr, touched, serverFingerprint, enabled, gameId, view]);

  // Synchronous commit on hard teardown — the ONE gap the in-app flush net can't
  // reach (React cleanup doesn't run on refresh/tab-close/OS-kill).
  useEffect(() => {
    const commit = () => {
      if (!enabledRef.current || !gameIdRef.current || !touchedRef.current) return;
      draftOutboxPut(view, gameIdRef.current, draftRef.current, baseRef.current, Date.now());
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") commit();
    };
    window.addEventListener("pagehide", commit);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", commit);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [view]);

  /** Restore the stored draft iff the server is unchanged since it diverged. */
  const recover = useCallback((): T | null => {
    if (!gameId) return null;
    return draftOutboxRecover(view, gameId, serverFingerprint) as T | null;
  }, [view, gameId, serverFingerprint]);

  /** Drop the entry after a durable persist / discard. */
  const clear = useCallback(() => {
    if (gameId) draftOutboxClear(view, gameId);
  }, [view, gameId]);

  return { recover, clear };
}
