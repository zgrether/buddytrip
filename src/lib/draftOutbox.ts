"use client";

/**
 * draftOutbox — durability for in-progress SETUP drafts (match pairings / rack
 * groupings), the Layer-2 companion to the in-app three-layer flush net.
 *
 * The in-app net (accordion-collapse persist + overlay-close flush + unmount
 * cleanup) already persists a COMPLETE draft on every IN-APP exit (collapse,
 * back, route change, panel close). It cannot cover the ONE remaining loss
 * window: HARD teardown — refresh / tab-close / OS-kill / background-then-killed
 * — where React cleanup never runs. This outbox closes that window, and (unlike
 * the server-persist path) covers INCOMPLETE drafts too, since an incomplete
 * pairing/grouping is never valid enough to persist to the server.
 *
 * Mirrors scoreOutbox: best-effort localStorage, SSR-safe, never throws into the
 * setup path. Differs in shape — scoreOutbox stores per-cell values re-sent
 * idempotently; this stores a WHOLE-DRAFT snapshot plus `base`, the fingerprint
 * of the server state the draft diverged from. `base` is the no-clobber guard:
 * on return we restore the draft ONLY when the server is unchanged since it
 * diverged (base === current server fingerprint) — never stale-over-newer.
 */

export type DraftView = "match" | "rack" | "nongolf" | "stroke" | "pickem";

export interface StoredDraft {
  /** The view's serializable draft (DraftMatch[] for match, string[][] for rack). */
  draft: unknown;
  /** Fingerprint of the server-derived draft this local draft diverged from. */
  base: string;
  ts: number;
}

const NS = "bt.setupDraft.v1";

/**
 * `scope` identifies WHOSE draft this is, for a view where one game can have
 * more than one.
 *
 * ── Why it exists, and why the fingerprint was not enough ──────────────────
 *
 * Pick'em proxy entry lets a captain draft a sheet for a teammate. Keyed on
 * `(view, gameId)` alone, that draft and the captain's OWN draft for the same
 * game share one key.
 *
 * `draftOutboxRecover` is supposed to catch exactly this: a draft whose `base`
 * fingerprint no longer matches the server is dropped. It cannot catch it here.
 * The fingerprint is `JSON.stringify(server.picks)`, and two people who have
 * never submitted have IDENTICAL empty sheets — so identical fingerprints. The
 * one mechanism designed to reject a mismatched draft cannot tell those two
 * apart, and the teammate's draft restores into the captain's own sheet
 * silently, below the level any banner on the surface can reach.
 *
 * Omitted (every other view) the key is byte-identical to what it was, so no
 * in-flight match/rack/stroke/nongolf draft is orphaned by this change.
 */
const storeKey = (view: DraftView, gameId: string, scope?: string) =>
  `${NS}:${view}:${gameId}${scope ? `:${scope}` : ""}`;

function read(view: DraftView, gameId: string, scope?: string): StoredDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storeKey(view, gameId, scope));
    return raw ? (JSON.parse(raw) as StoredDraft) : null;
  } catch {
    return null;
  }
}

function writeRaw(view: DraftView, gameId: string, entry: StoredDraft | null, scope?: string): void {
  if (typeof window === "undefined") return;
  try {
    const k = storeKey(view, gameId, scope);
    if (entry === null) window.localStorage.removeItem(k);
    else window.localStorage.setItem(k, JSON.stringify(entry));
  } catch {
    /* quota exceeded / storage disabled — best-effort; never throw into setup. */
  }
}

/** Mirror the current draft (called on edit + synchronously on teardown). */
export function draftOutboxPut(
  view: DraftView, gameId: string, draft: unknown, base: string, ts: number, scope?: string
): void {
  writeRaw(view, gameId, { draft, base, ts }, scope);
}

/** Drop the entry — on durable server persist, or explicit discard. */
export function draftOutboxClear(view: DraftView, gameId: string, scope?: string): void {
  writeRaw(view, gameId, null, scope);
}

/**
 * Recover a stored draft IFF it diverged from the SAME server state we see now
 * (`base === currentServerFingerprint`). A mismatch means the server moved on
 * (another device persisted) since this draft diverged — the stored draft is
 * stale, so drop it and return null (no clobber). Returns the raw draft for the
 * caller to cast to its own draft type.
 */
export function draftOutboxRecover(
  view: DraftView, gameId: string, currentServerFingerprint: string, scope?: string
): unknown | null {
  const stored = read(view, gameId, scope);
  if (!stored) return null;
  if (stored.base !== currentServerFingerprint) {
    draftOutboxClear(view, gameId, scope); // stale — server changed underneath it
    return null;
  }
  return stored.draft;
}

/** Peek at the raw stored entry (tests / diagnostics). */
export function draftOutboxPeek(view: DraftView, gameId: string, scope?: string): StoredDraft | null {
  return read(view, gameId, scope);
}
