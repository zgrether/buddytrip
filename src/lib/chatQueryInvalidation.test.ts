import { describe, it, expect, vi } from "vitest";
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
  const calls: Array<[string, unknown]> = [];
  const rec = (name: string) => ({
    invalidate: (input: unknown) => {
      calls.push([name, input]);
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

  it("skips the unread counts for team chat, which has no badge", () => {
    const { utils, names } = fakeUtils();
    invalidateChatQueries(utils, { tripId: "t1", channel: "team", teamId: "team-2" });
    expect(names()).toEqual(["list"]);
  });
});
