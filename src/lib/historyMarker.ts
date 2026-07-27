"use client";

/**
 * historyMarker — ownership tags for the history entries BuddyTrip pushes itself.
 *
 * ── The problem this solves ──────────────────────────────────────────────────
 * Three independent hooks push a phantom history entry so the OS/browser back
 * button closes an in-page layer instead of leaving the page:
 *
 *   • `useScreenHistory`        — one entry per in-page screen (score/grid)
 *   • `useModalBackButton`      — one entry per open modal/sheet
 *   • `useGameSettingsOverlay`  — one entry for the settings overlay
 *
 * plus the game panel / scorecard overlay (`GameRow`), which pushes a `?game=` /
 * `?scorecard=` entry.
 *
 * Every one of those listeners used to act on ANY `popstate`, without checking
 * the popped entry was theirs. With one layer open that is harmless. With two —
 * or with the four-tab shell's sentinel entry (NAV_AUDIT_2.md §5.4) — the wrong
 * listener consumes the event: the settings overlay closes when a tab entry was
 * popped, and the tab does not change.
 *
 * ── Why a DEPTH and not a boolean tag ────────────────────────────────────────
 * The obvious fix — "tag my entry, and on popstate check `event.state` for my
 * tag" — does not work, because **`popstate`'s `event.state` is the entry you
 * land ON, not the entry that was popped.** There is no API for reading the
 * entry that just went away.
 *
 * So ownership has to be inferred from position. Every marker carries a
 * monotonically increasing `btDepth`, and the test is:
 *
 *     my entry was popped  ⟺  the entry I landed on is BELOW mine
 *                          ⟺  readDepth(event.state) < myClaimedDepth
 *
 * That handles nesting (two modals both tagged `{modal:true}` are
 * distinguishable by depth) and cross-owner interleaving (a settings overlay
 * under a modal correctly ignores the modal's pop) with one rule.
 *
 * ── Why EVERY BuddyTrip push must use this ───────────────────────────────────
 * An untagged entry reads as depth 0, which makes it look like it sits below
 * everything. If an untagged entry is pushed ABOVE a marker and then popped, the
 * marker below sees `0 < myDepth` and wrongly claims the pop. Concretely, before
 * this module: settings overlay open, then the scorecard overlay pushed an
 * untagged entry, then back — and the settings overlay closed instead of the
 * scorecard. So the panel/scorecard pushes are tagged too. **A new
 * `history.pushState` anywhere in the app should go through `pushMarker`.**
 *
 * Depth is derived from the CURRENT entry at push time rather than a module
 * counter, so it survives a reload (the counter would reset while history does
 * not) and it is automatically correct after a back-then-push truncates the
 * forward entries.
 */

/** Which surface pushed an entry. Diagnostic, and it keeps the tags greppable. */
export type MarkerOwner = "screen" | "modal" | "config" | "panel" | "tab";

export interface HistoryMarker {
  /** Monotonic position among BuddyTrip-owned entries. */
  btDepth: number;
  btOwner: MarkerOwner;
}

/** Depth of a history state. Anything we did not tag — a Next router entry, a
 *  raw `pushState(null)`, the initial document — reads as 0, i.e. "below every
 *  marker". */
export function readDepth(state: unknown): number {
  const d = (state as Partial<HistoryMarker> | null | undefined)?.btDepth;
  return typeof d === "number" && Number.isFinite(d) ? d : 0;
}

/**
 * Push a tagged entry and return the depth it claimed. Keep the returned value —
 * it is what `isOwnPop` compares against.
 *
 * `extra` preserves each hook's existing legacy key (`btCfg`, `modal`, `btScreen`)
 * because other code still reads those off `window.history.state`.
 */
export function pushMarker(
  owner: MarkerOwner,
  extra?: Record<string, unknown>,
  url?: string,
): number {
  const depth = readDepth(window.history.state) + 1;
  const state: HistoryMarker & Record<string, unknown> = {
    ...extra,
    btDepth: depth,
    btOwner: owner,
  };
  if (url === undefined) window.history.pushState(state, "");
  else window.history.pushState(state, "", url);
  return depth;
}

/** Who owns the entry currently on top, if anyone. */
export function readOwner(state: unknown): MarkerOwner | null {
  return (state as Partial<HistoryMarker> | null | undefined)?.btOwner ?? null;
}

/**
 * Rewrite the CURRENT entry's URL, keeping its depth and owner.
 *
 * This is the other half of the tab model: the first switch away from Home
 * `pushMarker`s one sentinel, and every switch after that replaces it, so an
 * excursion through five tabs costs exactly ONE history entry rather than five.
 * Depth is preserved deliberately — the entry is the same entry, so any listener
 * that already claimed a depth against it stays correct.
 *
 * Only call this on an entry you own (`readOwner(...) === yours`). Replacing an
 * entry you did not push would claim someone else's position in the stack.
 */
export function replaceMarker(owner: MarkerOwner, extra: Record<string, unknown> | undefined, url: string): number {
  const depth = readDepth(window.history.state);
  const state: HistoryMarker & Record<string, unknown> = { ...extra, btDepth: depth, btOwner: owner };
  window.history.replaceState(state, "", url);
  return depth;
}

/**
 * Did this `popstate` pop MY entry?
 *
 * True  → we landed below my marker, so my entry is gone. Act on it.
 * False → we landed on my marker or above it, so something else was popped.
 *         Do nothing and let the owning listener handle it.
 */
export function isOwnPop(event: Pick<PopStateEvent, "state">, claimedDepth: number): boolean {
  return readDepth(event.state) < claimedDepth;
}
