import { describe, it, expect } from "vitest";
import { invalidateChatQueries, type ChatInvalidationUtils } from "./chatQueryInvalidation";

/**
 * The invalidation-set parity this module exists to enforce.
 *
 * The bug: `messages.send.onSuccess` invalidated `messages.list` (a full
 * refetch, which incidentally healed anything realtime had missed) while the
 * realtime INSERT handler invalidated only the unread counts and patched the
 * list in place. So POSTING recovered lost messages and RECEIVING didn't —
 * "another user posts; you don't see it until you post something."
 *
 * Both paths now call this one function, so the sets cannot drift. These tests
 * pin the set itself; a new chat query added here must be added once, not twice.
 */

function fakeUtils() {
  const calls: Array<[string, unknown, unknown]> = [];
  const rec = (name: string) => ({
    invalidate: (input: unknown, opts?: unknown) => {
      calls.push([name, input, opts]);
    },
  });
  const utils: ChatInvalidationUtils = {
    messages: {
      list: rec("list"),
      unreadCount: rec("unreadCount"),
      unreadCountByChannel: rec("unreadCountByChannel"),
    },
  };
  return { utils, calls, names: () => calls.map(([n]) => n) };
}

describe("invalidateChatQueries", () => {
  it("invalidates the list AND both unread counts for a trip message", () => {
    const { utils, names } = fakeUtils();
    invalidateChatQueries(utils, { tripId: "t1", channel: "trip" });
    expect(names()).toEqual(["list", "unreadCount", "unreadCountByChannel"]);
  });

  it("hits the SAME set whether it's a realtime insert or a post", () => {
    // The whole point: the sender's path and the receiver's path must be
    // indistinguishable in what they refresh.
    const realtime = fakeUtils();
    invalidateChatQueries(realtime.utils, { tripId: "t1", channel: "trip" });

    const posted = fakeUtils();
    invalidateChatQueries(posted.utils, {
      tripId: "t1",
      channel: "trip",
      visibility: "crew",
    });

    expect(posted.names()).toEqual(realtime.names());
  });

  it("OMITS visibility rather than passing undefined (partial-key matching)", () => {
    // React Query matches by partial deep equality, so `visibility: undefined`
    // would fail to match a cached key whose visibility is "crew" — the
    // invalidation would silently hit nothing.
    const { utils, calls } = fakeUtils();
    invalidateChatQueries(utils, { tripId: "t1", channel: "trip" });
    const listInput = calls.find(([n]) => n === "list")![1] as Record<string, unknown>;
    expect("visibility" in listInput).toBe(false);
  });

  it("passes visibility through when the caller scopes to one sub-channel", () => {
    const { utils, calls } = fakeUtils();
    invalidateChatQueries(utils, {
      tripId: "t1",
      channel: "trip",
      visibility: "planning",
    });
    expect(calls.find(([n]) => n === "list")![1]).toMatchObject({
      tripId: "t1",
      channel: "trip",
      visibility: "planning",
    });
  });

  /**
   * REVERSES this file's own earlier assertion, which read "skips the unread
   * counts for team chat, which has no badge" and asserted `["list"]` only.
   * That was correct when `messages.unreadCount` summed only crew + planning;
   * it became wrong the moment that function was extended to sum Team too
   * (`countUnreadByChannel`, `messages.ts`), and nothing here was updated to
   * match — a real gap, found live: a team message landed with the
   * recipient's chat panel CLOSED and the bottom-nav dot never lit, even
   * though the server's own `messages.unreadCount` was already returning the
   * correct non-zero count. The invalidation call was the only thing not
   * reaching it.
   *
   * Team's unread counts are the SAME server-summed total the trip channel's
   * are — one function, both channels — so this now asserts parity with the
   * trip case rather than an exception from it.
   */
  it("invalidates the unread counts for team chat too — same set as trip", () => {
    const { utils, names } = fakeUtils();
    invalidateChatQueries(utils, { tripId: "t1", channel: "team", teamId: "team-2" });
    expect(names()).toEqual(["list", "unreadCount", "unreadCountByChannel"]);
  });

  // ── Refetch policy ─────────────────────────────────────────────────────────
  //
  // The policy is a flag, NOT a second key list. These tests exist to pin that
  // distinction: the KEYS must be identical across policies (that is #22's rule
  // and the bug this module was written for), and only the refetch timing moves.

  it("defaults to refetching everything — the post path is unchanged", () => {
    const { utils, calls } = fakeUtils();
    invalidateChatQueries(utils, { tripId: "t1", channel: "trip" });
    expect(calls.find(([n]) => n === "list")![2]).toEqual({ refetchType: "all" });
  });

  it("'none' marks the list stale without refetching it now", () => {
    // The realtime path after a successful prepend: the row is already in page
    // 0, so refetching would re-download every loaded page of an INFINITE query
    // to learn what the cache was just told.
    const { utils, calls } = fakeUtils();
    invalidateChatQueries(
      utils,
      { tripId: "t1", channel: "trip" },
      { messagesListRefetch: "none" }
    );
    expect(calls.find(([n]) => n === "list")![2]).toEqual({ refetchType: "none" });
  });

  it("the KEY SET is identical under both policies — only the timing differs", () => {
    // If a future change made one policy skip a query, this is what catches it:
    // that is the exact shape of the drift #762 fixed, re-entering through a
    // flag instead of through a duplicated list.
    const all = fakeUtils();
    invalidateChatQueries(all.utils, { tripId: "t1", channel: "trip" });
    const none = fakeUtils();
    invalidateChatQueries(
      none.utils,
      { tripId: "t1", channel: "trip" },
      { messagesListRefetch: "none" }
    );
    expect(none.names()).toEqual(all.names());
    expect(none.calls.map(([, input]) => input)).toEqual(all.calls.map(([, input]) => input));
  });

  it("the unread counts always refetch, whatever the list policy", () => {
    // They are cheap scalar COUNTs and they drive the badges — deferring those
    // would make the dot lie, which is the visible half of the feature.
    const { utils, calls } = fakeUtils();
    invalidateChatQueries(
      utils,
      { tripId: "t1", channel: "trip" },
      { messagesListRefetch: "none" }
    );
    expect(calls.find(([n]) => n === "unreadCount")![2]).toBeUndefined();
    expect(calls.find(([n]) => n === "unreadCountByChannel")![2]).toBeUndefined();
  });
});
