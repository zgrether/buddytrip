"use client";

import { useEffect } from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import type {
  RealtimeChannel,
  RealtimePostgresInsertPayload,
} from "@supabase/supabase-js";
import { getRealtimeClient } from "@/lib/supabase";
import { trpc } from "@/lib/trpc-client";
import { invalidateChatQueries } from "@/lib/chatQueryInvalidation";

/**
 * Row shape emitted by the `messages` postgres_changes payload. Matches the
 * exact column set `messages.list` selects, so a payload row can be written
 * straight into the query cache with no enrichment (chat has no server-side
 * joins — unlike events.list).
 */
export interface MessageRow {
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

/** What a subscriber is told. `resync` = (re)connected, backfill by refetching. */
export type ChatEvent =
  | { type: "insert"; row: MessageRow }
  | { type: "resync" };

type Handler = (event: ChatEvent) => void;

type Entry = {
  channel: RealtimeChannel;
  handlers: Set<Handler>;
  refs: number;
};

/** topic → the one channel serving it, and everyone listening to it. */
const registry = new Map<string, Entry>();

/** Topic for a trip's chat (crew + planning both ride it — one channel per trip). */
export const tripChatTopic = (tripId: string) => `trip-chat:${tripId}`;
/** Topic for a team's chat. team_id is globally unique, so it fully scopes. */
export const teamChatTopic = (tripId: string, teamId: string) =>
  `team-chat:${tripId}:${teamId}`;

/**
 * Join `topic` (creating the channel if this is the first caller) and return a
 * release fn.
 *
 * ── Why the ref-counted registry ─────────────────────────────────────────────
 * MULTIPLE surfaces subscribe to one trip's chat at the same time, and which
 * ones has changed with every shell restructure. Today, on the trip page:
 * `AppShell` holds one (always mounted, so a closed chat still learns a message
 * arrived), and `TopNav`'s `ChatToolButton` → `useChatUnreadCount` holds another
 * (mounted at every width — `hidden lg:block` is CSS, not a mount gate).
 *
 * Two `supabase.channel(sameTopic)` objects means two joins for one stream and —
 * worse — the first unmount would `removeChannel` a topic the other still needs,
 * silently killing live updates for the surface left behind. So topics are shared
 * and ref-counted here: ONE channel per topic per client, torn down only on the
 * LAST release. Same mechanism `useRealtimeScoreEvents` uses, and the same hazard
 * CLAUDE.md #20 names.
 *
 * This REPLACES a doc comment as the safeguard, deliberately. The previous design
 * kept one canonical subscriber and a comment on `useChatUnreadCount` asserting
 * "the open panel deliberately does NOT also subscribe (a single channel avoids a
 * duplicate-topic collision)." That comment became FALSE when #756 wired
 * `onOpenChat` into the trip page's TopNav and remounted `ChatToolButton` there —
 * the third time in three restructures that moving what-is-always-mounted broke
 * chat realtime. A comment cannot enforce an invariant across a shell that keeps
 * changing which components are live; ref-counting makes duplicate subscribers
 * CORRECT instead of forbidden, so the next restructure can't reintroduce this.
 *
 * EXPORTED for tests: the ref-counting is the part with real failure modes — a
 * premature teardown silently kills live updates for a surface that is still
 * mounted — and the suite runs in `environment: "node"`, so there is no renderer
 * to exercise it through the hook.
 */
export function acquire(
  topic: string,
  filter: string,
  handler: Handler
): () => void {
  let entry = registry.get(topic);

  if (!entry) {
    const supabase = getRealtimeClient();
    const channel = supabase.channel(topic);
    const created: Entry = { channel, handlers: new Set(), refs: 0 };

    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter },
      (payload: RealtimePostgresInsertPayload<MessageRow>) => {
        for (const h of [...created.handlers]) h({ type: "insert", row: payload.new });
      }
    );

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        // Backfill on (re)connect: anything inserted while the socket was down
        // never arrived as an event, so refetch rather than trusting the patch
        // path alone. Same self-heal useRealtimeGame does on its SUBSCRIBED tick.
        for (const h of [...created.handlers]) h({ type: "resync" });
        return;
      }
      // FAIL LOUD. A subscription that never establishes is indistinguishable
      // from a working one that has nothing to say — which is exactly why chat
      // realtime read as "barely working" rather than "broken" for three
      // restructures. Nothing here can repair the socket, but silence about it
      // is what made this expensive to find, so say so.
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        console.error(
          `[realtime] chat channel "${topic}" is not live (status: ${status}). ` +
            `New messages will not arrive until it reconnects.`
        );
      }
    });

    entry = created;
    registry.set(topic, created);
  }

  entry.handlers.add(handler);
  entry.refs += 1;

  let released = false;
  return () => {
    // Effect cleanup can run twice (StrictMode, fast refresh); never let that
    // double-decrement and tear down a channel another surface is still using.
    if (released) return;
    released = true;

    const current = registry.get(topic);
    if (!current) return;
    current.handlers.delete(handler);
    current.refs -= 1;
    if (current.refs <= 0) {
      registry.delete(topic);
      getRealtimeClient().removeChannel(current.channel);
    }
  };
}

/**
 * Subscribes to Supabase Realtime for live chat messages.
 *
 * Channels per REALTIME.md:
 *   - Trip chat: `trip-chat:{tripId}` → messages filtered by `trip_id=eq.{tripId}`
 *   - Team chat: `team-chat:{tripId}:{teamId}` → messages filtered by `team_id=eq.{teamId}`
 *
 * Supabase Realtime `postgres_changes` only supports a SINGLE column
 * predicate per subscription (no AND/`&` compound filters). So team chat
 * filters on `team_id` alone — team_id is globally unique, so it fully
 * scopes the subscription to that team's messages without also needing
 * trip_id. The previous code filtered the team channel on `trip_id`,
 * which leaked every other team's (and the trip channel's) inserts into
 * the subscription, causing needless refetches.
 *
 * Safe to call from as many mounted components as you like — the channel is
 * ref-counted per topic (see `acquire`), so N subscribers share ONE join and
 * teardown waits for the last of them.
 *
 * On INSERT the new row is patched into the messages cache (prepend, dedup by
 * id) for an instant paint, AND the same query set the post mutation touches is
 * invalidated — see `invalidateChatQueries` for why those two paths must not
 * diverge.
 */
export function useRealtimeChat(
  tripId: string,
  channel: "trip" | "team",
  teamId?: string
) {
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!tripId) return;
    if (channel === "team" && !teamId) return;

    const topic =
      channel === "trip" ? tripChatTopic(tripId) : teamChatTopic(tripId, teamId!);
    const filter =
      channel === "trip" ? `trip_id=eq.${tripId}` : `team_id=eq.${teamId}`;

    // Prepend a freshly-inserted row into every matching messages.list cache
    // (both the infinite-query pages and, defensively, a flat-array shape —
    // no current consumer creates one, but a cache write is a no-op against a
    // key that doesn't exist, so this costs nothing to keep). Keyed by the
    // partition the message belongs to: visibility partitions the trip
    // channel; team chat is flat and keyed by teamId instead. The unread
    // COUNT itself is server-computed (F3) and isn't in this cache shape at
    // all — it's invalidated separately, not patched here.
    const prepend = (row: MessageRow) => {
      const partialInput =
        channel === "trip"
          ? {
              tripId,
              channel: "trip" as const,
              visibility:
                (row.visibility as "crew" | "planning" | null) ?? undefined,
            }
          : { tripId, channel: "team" as const, teamId };

      const queryKey = getQueryKey(trpc.messages.list, partialInput, "any");

      queryClient.setQueriesData<MessageRow[] | InfiniteData<MessageRow[]>>(
        { queryKey },
        (old) => {
          if (!old) return old;

          // Infinite-query cache: { pages: Row[][], pageParams }. Page 0 holds
          // the newest rows (server orders created_at DESC), so prepend there.
          if (!Array.isArray(old) && "pages" in old) {
            if (old.pages.some((page) => page.some((m) => m.id === row.id))) {
              return old;
            }
            const pages = old.pages.slice();
            pages[0] = [row, ...(pages[0] ?? [])];
            return { ...old, pages };
          }

          // Flat-array cache, also created_at DESC.
          if (Array.isArray(old)) {
            if (old.some((m) => m.id === row.id)) return old;
            return [row, ...old];
          }

          return old;
        }
      );
    };

    const release = acquire(topic, filter, (event) => {
      if (event.type === "insert") prepend(event.row);
      // Both paths invalidate the SAME set the post mutation does. A closed
      // panel has no messages.list cache for prepend() to patch, and a patch
      // alone can't heal a gap the socket missed — which is why receiving used
      // to lag while POSTING appeared to work: only the post mutation
      // invalidated messages.list, so a refetch was the sender's private
      // recovery path. One shared helper now, so that gap can't reopen.
      invalidateChatQueries(utils, { tripId, channel, teamId });
    });

    return release;
  }, [tripId, channel, teamId, utils, queryClient]);
}
