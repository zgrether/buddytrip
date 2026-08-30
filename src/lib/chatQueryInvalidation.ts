/**
 * The ONE invalidation set for "chat message data changed."
 *
 * ── Why this is shared, not two call sites that happen to match ──────────────
 * Chat had two independent write paths with DIFFERENT invalidation sets, and the
 * delta between them was the bug:
 *
 *   • `messages.send.onSuccess` invalidated `messages.list` → a full refetch,
 *     which incidentally pulled in every message realtime had failed to deliver.
 *   • the realtime INSERT handler invalidated only the two unread counts and
 *     PATCHED `messages.list` in place (prepend), never refetching it.
 *
 * So posting had a recovery mechanism receiving didn't, which is exactly the
 * reported symptom: "another user posts; you don't see it until you post
 * something." The refetch was doing the work the broken subscription wasn't.
 *
 * Fixing the subscription is necessary but not sufficient — two hand-maintained
 * lists of query keys drift again the moment someone adds a third. So both paths
 * call THIS function and nothing else. A new chat query gets added here once and
 * both paths pick it up; there is no second list to forget.
 *
 * Typed against a narrow structural shape rather than tRPC's full utils proxy
 * (same posture as `useRealtimeScoreEvents`'s `ScoreEventUtils`): it documents
 * the exact surface this is allowed to touch, and it keeps the helper unit
 * testable without a React tree.
 */

/**
 * What to do with `messages.list` after marking it stale.
 *
 * `"all"` — the default and the historical behaviour. For an INFINITE query
 * React Query refetches EVERY loaded page, which is what makes this expensive:
 * measured at 4 page-fetches / 200 rows / 63 kB for one incoming message with
 * two pages loaded, to deliver ~200 bytes of text. The cost scales with how far
 * back the reader has scrolled, so it grows over a trip rather than with the
 * channel's size.
 *
 * `"none"` — mark stale, refetch nothing now. For the realtime path, where the
 * row has ALREADY been written into page 0 by the handler's own prepend, so a
 * refetch would re-download the history to learn what the cache was just told.
 * Staleness is preserved, so the next mount or refocus still reconciles.
 */
export type MessagesListRefetch = "all" | "none";

export type ChatInvalidationUtils = {
  messages: {
    list: {
      invalidate: (
        input: {
          tripId: string;
          channel: "trip" | "team";
          teamId?: string;
          visibility?: "crew" | "planning";
        },
        opts?: { refetchType?: MessagesListRefetch }
      ) => unknown;
    };
    unreadCount: { invalidate: (input: { tripId: string }) => unknown };
    unreadCountByChannel: { invalidate: (input: { tripId: string }) => unknown };
  };
};

export function invalidateChatQueries(
  utils: ChatInvalidationUtils,
  input: {
    tripId: string;
    channel: "trip" | "team";
    teamId?: string;
    /**
     * Narrows the `messages.list` invalidation to one sub-channel. OMITTED (not
     * passed as `undefined`) when absent, on purpose: React Query matches query
     * keys by partial deep equality, so a filter carrying `visibility: undefined`
     * would FAIL to match a cached key whose visibility is `"crew"` — the
     * invalidation would silently hit nothing. Leaving the field out matches
     * both sub-channels, which is what a realtime insert wants.
     */
    visibility?: "crew" | "planning";
  },
  /**
   * How to refetch `messages.list`. Deliberately a POLICY flag and not a second
   * key list — CLAUDE.md #22's rule is that the set of keys lives in one place,
   * because two hand-maintained lists drift the moment someone adds a third
   * query. A new chat query is still added here once and every caller picks it
   * up; all this changes is whether the list refetches NOW or on next mount.
   *
   * Defaults to `"all"`, so `messages.send.onSuccess` is untouched.
   */
  opts: { messagesListRefetch?: MessagesListRefetch } = {}
): void {
  const { tripId, channel, teamId, visibility } = input;
  const refetchType = opts.messagesListRefetch ?? "all";

  if (visibility !== undefined) {
    utils.messages.list.invalidate({ tripId, channel, teamId, visibility }, { refetchType });
  } else {
    utils.messages.list.invalidate({ tripId, channel, teamId }, { refetchType });
  }

  // Unread counts are trip-scoped and summed server-side (crew + planning +
  // TEAM, since messages.unreadCount's own countUnreadByChannel sums all
  // three — see messages.ts), so ONE invalidation per insert refreshes the
  // combined total regardless of which channel changed.
  //
  // THIS WAS GATED ON `channel === "trip"` UNTIL A LIVE REPORT FOUND THE GAP:
  // a team message landed with the recipient's chat panel closed and the
  // bottom-nav Chat dot never lit, even though the server's own
  // `messages.unreadCount` was already correctly returning a non-zero count —
  // proven directly against a real query before touching this file. The old
  // comment here ("Team chat has no unread badge, so it has nothing to
  // refresh here") was TRUE when it was written and became false the moment
  // the server side was extended to sum Team's count too, and nothing
  // updated this gate to match — the exact shape CLAUDE.md's "an extraction
  // moves the control and leaves the message behind" entry describes, one
  // more time, in the query-invalidation layer rather than a component.
  //
  // `unreadCountByChannel`'s OWN per-segment Team dot depends on this too —
  // it reads the SAME server function, so gating this call by channel would
  // silently stale that dot as well, not only the combined one.
  utils.messages.unreadCount.invalidate({ tripId });
  utils.messages.unreadCountByChannel.invalidate({ tripId });
}
