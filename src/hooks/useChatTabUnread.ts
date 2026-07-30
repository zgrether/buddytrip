"use client";

import { trpc } from "@/lib/trpc-client";
import { useIsShellDesktop } from "@/components/shell/breakpoints";
import { useNewsUnreadCount } from "@/components/NewsPanel";

/**
 * Combined unread total for the Chat action's dot (`AppTabBar`, mobile — the
 * desktop toggle lives in `TopNav` instead, off its own `useChatUnreadCount`)
 * — Crew + Planning (via `messages.unreadCount`, already summed and
 * visibility-filtered server-side: a non-Owner/Organizer caller's Planning
 * share is 0 before it ever reaches this hook) + News. The filter is
 * server-side by construction; this hook only adds, never subtracts.
 *
 * ── Why the two halves are gated DIFFERENTLY (#763) ──────────────────────────
 * `AppTabBar` is `lg:hidden` but still MOUNTS at desktop widths, so this hook
 * runs there too — "CSS can hide an element but cannot stop it fetching", the
 * rule `ContextRail` states and this hook used to ignore. But the right fix
 * isn't one blanket gate, because the two counts have different readers:
 *
 *  - `messages.unreadCount` is NOT gated. At desktop it is read by `TopNav`'s
 *    `ChatToolButton` (via `useChatUnreadCount`), which is visible there — and
 *    it is the SAME query key, so the two hooks share one request and this
 *    call costs nothing extra at either width. Gating it here would not remove
 *    a request; it would just make this hook's total wrong while the dot it
 *    feeds is off screen.
 *
 *  - `news.unreadCount` IS gated to mobile, because at desktop nothing renders
 *    it. `AppTabBar` is hidden; `TopNav`'s `NewsToolButton` requires an
 *    `onOpenNews` prop that no call site in the app passes (see #766 — that
 *    button is dead code); and `ChatView`, which owns the News segment and has
 *    its own `useNewsUnreadCount`, is only mounted while chat is OPEN. So with
 *    chat closed at `lg+` this was a request whose result had no reader.
 *
 * The gate rides `useIsShellDesktop`, whose SSR-safe default is `false`
 * (`useState(false)` corrected in an effect), so it delays by a tick at
 * desktop — harmless here, since the desktop case is precisely the one where
 * we want no request at all. On mobile the default is already correct, so the
 * dot is not delayed on the width that actually shows it.
 */
export function useChatTabUnread(tripId: string | undefined): number {
  const isDesktop = useIsShellDesktop();

  const { data: chatUnread } = trpc.messages.unreadCount.useQuery(
    { tripId: tripId! },
    { enabled: !!tripId }
  );
  const newsUnread = useNewsUnreadCount(
    tripId && !isDesktop ? tripId : ""
  );

  if (!tripId) return 0;
  return (chatUnread ?? 0) + newsUnread;
}
