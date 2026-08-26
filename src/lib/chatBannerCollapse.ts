/**
 * "Have you already seen this channel's explainer banner" — per trip, per
 * channel, so a channel with real content to explain (Organizers) collapses
 * independently of one that doesn't (see `FloatingChatPanel`'s banner: today
 * only Organizers has a description block at all — Crew renders nothing here.
 * This module is written channel-generic anyway, so a future Crew banner
 * needs no changes to this file, only a call site).
 *
 * ── The idiom ────────────────────────────────────────────────────────────
 * `bt.<name>.v1`, namespaced per trip and channel — the same shape as
 * `chatDraft`, `chatCache`, `chatFailedOutbox`. Deliberately not a second
 * pattern.
 *
 * ── Why this is PRESENCE-ONLY, and why that is what makes it un-crashable ──
 * The only question this needs to answer is "has SOMETHING been stored for
 * this channel". It never reads the stored VALUE — so there is nothing here
 * for a corrupt value to break. A garbage string, a stale shape, a value from
 * a future version: all of them are still `!== null`, so all of them still
 * mean "seen" (collapsed). No `JSON.parse` is ever called on read, which is
 * the whole reason "a corrupt stored value → collapsed, no crash" is true by
 * construction rather than by a try/catch.
 *
 * ── The one real decision here: which way failure falls ─────────────────
 * A `localStorage.getItem` that THROWS (private mode, storage disabled) is
 * treated as "seen" (collapsed) — the opposite direction from `chatDraft`,
 * where a storage failure falls back to an EMPTY draft. That's deliberate,
 * not an oversight: `chatDraft`'s content is data someone typed and losing it
 * is the harm to avoid, so its failure mode is the version that loses the
 * LEAST. This banner has no content to lose — the two failure directions are
 * "explain it again" (harmless, mildly repetitive) versus "hide the
 * explanation forever" (also harmless — a tap still reveals it). Collapsed is
 * the quieter of two harmless outcomes, so that's the one a failure falls
 * into.
 *
 * A clean, definite "the key genuinely is not there" (`getItem` returns
 * `null` without throwing) is the ONLY case that reads as first-view and
 * expands — because it is the only case with real evidence behind it.
 */

const NS = "bt.chatBannerSeen.v1";

function storeKey(tripId: string, visibility: string): string {
  return `${NS}:${tripId}:${visibility}`;
}

/**
 * Has this channel's banner already been shown once?
 *
 * `false` is the expand-on-first-view answer; `true` collapses. SSR (no
 * `window`) answers `false` — there is no evidence either way, and the
 * client-side re-render once `window` exists is what actually decides it, the
 * same "unknown defaults to the least surprising thing" shape `readChatDraft`
 * and friends use.
 */
export function hasSeenChatBanner(tripId: string, visibility: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(storeKey(tripId, visibility)) !== null;
  } catch {
    return true; // storage threw: can't confirm absence, so collapse (see header)
  }
}

/**
 * Record that this channel's banner has been shown. Idempotent — called
 * unconditionally on first render of an unseen banner, safe to call again.
 *
 * The stored value is never read back (see header), so its shape is not load
 * bearing. It is still a versioned envelope, matching the sibling modules'
 * idiom, so a human inspecting localStorage sees the same shape everywhere
 * and a future version bump has somewhere to put a real reason to re-show.
 */
export function markChatBannerSeen(tripId: string, visibility: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storeKey(tripId, visibility), JSON.stringify({ v: 1 }));
  } catch {
    // best-effort — a failed write only means the banner may expand again
    // next time, which is the harmless direction (see header).
  }
}
