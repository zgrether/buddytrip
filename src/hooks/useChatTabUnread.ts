"use client";

import { trpc } from "@/lib/trpc-client";
import { useNewsUnreadCount } from "@/components/NewsPanel";

/**
 * Combined unread total for the Chat action's dot (`AppTabBar`, mobile —
 * `DesktopTabStrip` no longer carries a Chat entry at all, Phase 6; the
 * desktop toggle lives in `TopNav` instead, off its own `useChatUnreadCount`)
 * — Crew + Planning (via `messages.unreadCount`, already summed and
 * visibility-filtered server-side: a non-Owner/Organizer caller's Planning
 * share is 0 before it ever reaches this hook) + News. The filter is
 * server-side by construction; this hook only adds, never subtracts.
 */
export function useChatTabUnread(tripId: string | undefined): number {
  const { data: chatUnread } = trpc.messages.unreadCount.useQuery(
    { tripId: tripId! },
    { enabled: !!tripId }
  );
  const newsUnread = useNewsUnreadCount(tripId ?? "");
  if (!tripId) return 0;
  return (chatUnread ?? 0) + newsUnread;
}
