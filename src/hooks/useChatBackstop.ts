"use client";

import { useEffect } from "react";
import { trpc } from "@/lib/trpc-client";
import { invalidateChatQueries, type ChatInvalidationUtils } from "@/lib/chatQueryInvalidation";

/**
 * How often an OPEN chat room checks it is current (#1396). 30s, not 60 (Zach,
 * 2026-10-15): the probe is one row, so halving the interval costs almost
 * nothing, and chat is the one place a minute of silence reads as broken.
 */
export const CHAT_BACKSTOP_INTERVAL_MS = 30_000;

/**
 * Whether the room on screen is behind the server: the newest message the
 * caller may see differs from the newest one loaded. An empty room on both
 * sides is current; a server row against an empty screen is not.
 */
export function chatBackstopStale(newestOnServer: string | null | undefined, newestLoaded: string | null | undefined): boolean {
  if (newestOnServer == null) return false;
  return newestOnServer !== (newestLoaded ?? null);
}

type Room =
  | { tripId: string; channel: "trip"; visibility: "crew" | "planning" }
  | { tripId: string; channel: "team"; teamId: string };

/**
 * The backstop behind chat's realtime subscription (#1396).
 *
 * Every other live surface has a poll behind realtime (CLAUDE.md #19/#20); chat
 * had none, and the app's global `refetchOnWindowFocus: false` meant a socket
 * that died without saying so left a room frozen until the panel remounted,
 * looking exactly like a quiet chat.
 *
 * It does not poll the room's list. `messages.list` is an infinite query, so a
 * refetch re-downloads every loaded page (63 kB measured with two pages). It
 * polls the NEWEST ROW instead, through the same procedure with `limit: 1`, so
 * the room access check and history floor are the list's own. It runs every 30s
 * while the room is on screen (paused in a background tab) and again on refocus,
 * which is "on return". Only when that row differs from the newest one loaded is
 * the room refetched, through the one chat invalidator (CLAUDE.md #22).
 */
export function useChatBackstop({
  utils,
  room,
  enabled,
  newestLoadedId,
}: {
  utils: ChatInvalidationUtils;
  room: Room;
  /** The room is on screen (`active`) and its list has loaded once. */
  enabled: boolean;
  newestLoadedId: string | null | undefined;
}) {
  const probe = trpc.messages.list.useQuery(
    { ...room, limit: 1 },
    {
      enabled,
      staleTime: 0,
      refetchInterval: CHAT_BACKSTOP_INTERVAL_MS,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
    }
  );
  const newestOnServer = probe.data?.[0]?.id;

  useEffect(() => {
    if (!enabled || !chatBackstopStale(newestOnServer, newestLoadedId)) return;
    invalidateChatQueries(
      utils,
      room.channel === "team"
        ? { tripId: room.tripId, channel: "team", teamId: room.teamId }
        : { tripId: room.tripId, channel: "trip", visibility: room.visibility },
      { messagesListRefetch: "all" }
    );
    // `room` is rebuilt every render; its fields are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, newestOnServer, newestLoadedId, utils, room.tripId, room.channel]);
}
