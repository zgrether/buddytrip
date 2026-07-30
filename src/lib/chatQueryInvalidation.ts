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

export type ChatInvalidationUtils = {
  messages: {
    list: {
      invalidate: (input: {
        tripId: string;
        channel: "trip" | "team";
        teamId?: string;
        visibility?: "crew" | "planning";
      }) => unknown;
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
  }
): void {
  const { tripId, channel, teamId, visibility } = input;

  if (visibility !== undefined) {
    utils.messages.list.invalidate({ tripId, channel, teamId, visibility });
  } else {
    utils.messages.list.invalidate({ tripId, channel, teamId });
  }

  // Unread counts are trip-scoped and summed server-side, so ONE invalidation
  // per insert refreshes the combined total regardless of sub-channel. Team chat
  // has no unread badge, so it has nothing to refresh here.
  if (channel === "trip") {
    utils.messages.unreadCount.invalidate({ tripId });
    utils.messages.unreadCountByChannel.invalidate({ tripId });
  }
}
