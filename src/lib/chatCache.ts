import { CHAT_PAGE_SIZE } from "@/components/chatPaging";

/**
 * The last page of each chat channel, kept in localStorage so reopening the app
 * returns you to a conversation instead of an empty panel.
 *
 * ── What this fixes, and what it does NOT ───────────────────────────────────
 * `messages.list` was already paginated (50-row pages, `created_at` cursor,
 * over-fetched by one so "is there more" is known rather than guessed), and the
 * panel already distinguishes "still loading" from "no messages" — there is a
 * reserved-height placeholder for the first case and an empty-state card for the
 * second. Neither of those was the problem.
 *
 * The problem is that there was nothing to render at all on a cold open. The
 * QueryClient is built in a `useState` initializer (`providers.tsx`) with no
 * persister, so it is per-app-load and in memory. Two ways to hit it:
 *
 *   app restart          → brand-new QueryClient, zero cache
 *   panel closed >5 min  → default gcTime evicts the inactive query
 *
 * which is exactly why it was intermittent: reopen inside five minutes and it
 * was already instant. On a poor connection the cold path is 5-10s of skeleton.
 *
 * ── Why hand-rolled and not a React Query persister ─────────────────────────
 * A global persister would persist EVERY query in the app, including the ones
 * `STRUCTURE_QUERY` and `LEADERBOARD_QUERY` deliberately tune — a cache policy
 * this codebase has already had to fix twice for being applied too broadly. The
 * blast radius is not worth it for one surface. This follows the established
 * `bt.<name>.v1` idiom instead (`draftOutbox`, `outcomeOutbox`, `scoreOutbox`):
 * namespaced, versioned, best-effort, SSR-safe, and scoped to exactly the data
 * that needs it.
 *
 * ── Bounded by construction ─────────────────────────────────────────────────
 * One page per channel, `CHAT_PAGE_SIZE` rows, which is exactly what the first
 * fetch returns. Not a number picked to evict at — the same number the panel
 * would have asked the server for anyway, so a restored cache and a fresh fetch
 * render the same amount of history.
 *
 * ── Staleness has exactly one mode ──────────────────────────────────────────
 * There is no per-message edit or delete in the app; the only non-append
 * mutation is `messages.clearChannel` (Owner-only, whole channel). So a cache
 * can only be wrong by being SHORT — missing newer messages, which the
 * background fetch appends — or by describing a channel that has since been
 * cleared, which the same fetch replaces wholesale. Neither needs reconciliation
 * machinery beyond "render the cache, then let the fetch win".
 */

/** Bumped when the stored SHAPE changes. A mismatch discards, never migrates. */
const NS = "bt.chatCache.v1";

const storeKey = (tripId: string, visibility: string) => `${NS}:${tripId}:${visibility}`;

/** The row shape `messages.list` returns — mirrored, not imported from the
 *  router, because this module is client-only and must not pull server types. */
export interface CachedMessage {
  id: string;
  trip_id: string;
  user_id: string | null;
  channel: string;
  team_id: string | null;
  text: string;
  created_at: string;
  visibility: string | null;
  message_type: string | null;
}

interface CacheEnvelope {
  /** Schema version, checked on read. */
  v: 1;
  messages: CachedMessage[];
}

/**
 * Is this really one of our rows?
 *
 * Checked FIELD BY FIELD rather than trusting the version tag, because the two
 * failure modes are different: a bumped version catches a shape WE changed, and
 * this catches everything else — a half-written entry from a killed tab, a key
 * collision, a hand-edited value, a row shape that drifted without the version
 * being bumped (which is the one a version tag cannot catch, since forgetting to
 * bump it is the whole failure).
 *
 * Anything that fails is discarded. A PARTIAL conversation is worse than an
 * empty one: an empty panel says "nothing yet" and is obviously provisional,
 * where three of fifty messages reads as the whole conversation.
 */
function isCachedMessage(row: unknown): row is CachedMessage {
  if (typeof row !== "object" || row === null) return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.trip_id === "string" &&
    typeof r.text === "string" &&
    typeof r.created_at === "string" &&
    typeof r.channel === "string" &&
    (r.user_id === null || typeof r.user_id === "string") &&
    (r.team_id === null || typeof r.team_id === "string") &&
    (r.visibility === null || typeof r.visibility === "string") &&
    (r.message_type === null || typeof r.message_type === "string")
  );
}

/**
 * The cached page for one channel, newest-first (the order `messages.list`
 * returns and the panel expects), or null if there is nothing usable.
 *
 * Null and `[]` are DIFFERENT and both are real: null is "no cache", which means
 * render the loading placeholder; `[]` would be a cached empty channel. Only
 * null is ever returned for a missing or rejected entry, so a discarded cache
 * can never be mistaken for a channel that is genuinely empty — the collapse
 * this whole surface is careful about.
 */
export function readChatCache(tripId: string, visibility: string): CachedMessage[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storeKey(tripId, visibility));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const env = parsed as Partial<CacheEnvelope>;
    if (env.v !== 1) return null; // a different version: discard, never migrate
    if (!Array.isArray(env.messages)) return null;
    if (!env.messages.every(isCachedMessage)) return null; // partial > discard
    return env.messages.slice(0, CHAT_PAGE_SIZE);
  } catch {
    return null;
  }
}

/**
 * Persist the newest page for one channel.
 *
 * Takes the panel's already-flattened, already-deduped, newest-first list and
 * keeps the head of it. Deliberately NOT every loaded page: someone who has
 * scrolled back through a year of history should not be writing a year of
 * history to localStorage on every message.
 */
export function writeChatCache(
  tripId: string,
  visibility: string,
  messages: readonly CachedMessage[]
): void {
  if (typeof window === "undefined") return;
  try {
    const head = messages.slice(0, CHAT_PAGE_SIZE);
    if (head.length === 0) {
      // Nothing to restore. Clear rather than storing an empty array, so an
      // emptied channel doesn't leave an entry that reads as a cached silence.
      window.localStorage.removeItem(storeKey(tripId, visibility));
      return;
    }
    const env: CacheEnvelope = { v: 1, messages: head };
    window.localStorage.setItem(storeKey(tripId, visibility), JSON.stringify(env));
  } catch {
    /* quota exceeded / storage disabled — best-effort; never throw into chat. */
  }
}

/** Drop one channel's cache. */
export function clearChatCache(tripId: string, visibility: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storeKey(tripId, visibility));
  } catch {
    /* best-effort */
  }
}
