"use client";

import { type FC, useEffect } from "react";
import { Home, Plus, Activity, MessageCircle, type LucideIcon } from "lucide-react";
import { useRouter, usePathname } from "next/navigation";
import { useChatUnreadCount } from "./FloatingChatPanel";

// ── Trip tab bar (inline, not bottom nav) ─────────────────────────────────
// This is the old "tab" concept — now handled by TripTabBar.tsx
// Re-export TabId for backwards compat during transition
export type TabId = "home" | "crew" | "lodging" | "schedule" | "expenses" | "comp";

// ── Bottom nav item ────────────────────────────────────────────────────────

interface NavItem {
  id: string;
  label: string;
  Icon: LucideIcon;
  /** Route items navigate here; action items (e.g. Messages) omit it. */
  href?: string;
  /** Action items run this instead of navigating (e.g. open the chat sheet). */
  onClick?: () => void;
  badge?: number;
  hidden?: boolean;
}

// ── Outside-trip bottom nav (Dashboard, TripNew, etc.) ─────────────────────

interface GlobalBottomNavProps {
  activeTripId?: string | null; // most recent active trip for "Live" link
}

export const GlobalBottomNav: FC<GlobalBottomNavProps> = ({ activeTripId }) => {
  const router = useRouter();
  const pathname = usePathname();

  const items: NavItem[] = [
    { id: "home", label: "Home", Icon: Home, href: "/dashboard" },
    { id: "new", label: "New trip", Icon: Plus, href: "/trips/new" },
    {
      id: "live",
      label: "Live",
      Icon: Activity,
      href: activeTripId ? `/trips/${activeTripId}/leaderboard` : "#",
      hidden: !activeTripId,
    },
  ];

  const visibleItems = items.filter((i) => !i.hidden);

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40"
      style={{
        background: "var(--color-bt-card)",
        borderTop: "1px solid var(--color-bt-border)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <div className="mx-auto flex max-w-2xl items-stretch">
      {visibleItems.map(({ id, label, Icon, href }) => {
        const active = pathname === href || (id === "home" && pathname === "/dashboard");
        return (
          <button
            key={id}
            data-testid={`nav-${id}`}
            onClick={() => href && router.push(href)}
            className="flex flex-1 flex-col items-center justify-center gap-1 py-2 transition-colors"
            style={{ color: active ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}
          >
            <Icon size={22} />
            <span className="text-[10px] font-medium">{label}</span>
          </button>
        );
      })}
      </div>
    </nav>
  );
};

// ── Inside-trip bottom nav ─────────────────────────────────────────────────

interface TripBottomNavProps {
  tripId: string;
  eventId?: string | null;
  showComp?: boolean;
  /** Opens the crew-chat sheet. When provided, the mobile-only Messages
   *  item appears in the bar (desktop keeps the top-nav chat button). */
  onOpenChat?: () => void;
}

export const TripBottomNav: FC<TripBottomNavProps> = ({
  tripId,
  eventId,
  showComp,
  onOpenChat,
}) => {
  const router = useRouter();
  const pathname = usePathname();
  const chatUnread = useChatUnreadCount(tripId);

  const compVisible = showComp !== undefined ? showComp : !!eventId;

  const items: NavItem[] = [
    { id: "trip-home", label: "Trip Home", Icon: Home, href: `/trips/${tripId}` },
    {
      id: "messages",
      label: "Messages",
      Icon: MessageCircle,
      onClick: onOpenChat,
      badge: chatUnread,
      hidden: !onOpenChat,
    },
    {
      id: "live",
      label: "Live",
      Icon: Activity,
      href: `/trips/${tripId}/leaderboard`,
      hidden: !compVisible,
    },
  ];

  // Prefetch JS bundles for route destinations so tapping is instant.
  useEffect(() => {
    items
      .filter((i) => !i.hidden && i.href)
      .forEach(({ href }) => {
        router.prefetch(href!);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable after mount
  }, [tripId, compVisible]);

  const visibleItems = items.filter((i) => !i.hidden);

  // The bottom bar is permanent across every viewport — Messages now lives
  // here at all sizes (it was removed from the top nav), so the bar is the
  // sole entry point to crew chat and must always be present.
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40"
      style={{
        background: "var(--color-bt-card)",
        borderTop: "1px solid var(--color-bt-border)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <div
        className="mx-auto flex max-w-2xl items-stretch"
        style={{ height: "var(--bt-bottomnav-height)" }}
      >
      {visibleItems.map(({ id, label, Icon, href, onClick, badge }) => {
        const active = href
          ? id === "trip-home"
            ? pathname === `/trips/${tripId}`
            : pathname === href
          : false;
        return (
          <button
            key={id}
            data-testid={`nav-${id}`}
            onClick={() => {
              if (onClick) {
                onClick();
                return;
              }
              if (!href || pathname === href) return; // already here
              const onTripHome = pathname === `/trips/${tripId}`;
              const goingToTripHome = href === `/trips/${tripId}`;
              if (goingToTripHome) {
                // Trip home is already in history (we pushed when we left it).
                // Use back() to return to that entry instead of creating a
                // duplicate trip-home entry via replace.
                router.back();
              } else if (onTripHome) {
                // Leaving trip home — push so it stays in history for back nav.
                router.push(href);
              } else {
                // Sub-page → sub-page — replace to avoid stacking.
                router.replace(href);
              }
            }}
            className="relative flex flex-1 flex-col items-center justify-center gap-1 py-2 transition-colors"
            style={{ color: active ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}
          >
            <Icon size={22} />
            <span className="text-[10px] font-medium">{label}</span>
            {badge != null && badge > 0 && (
              <span
                className="absolute right-1/4 top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white"
                style={{ background: "var(--color-bt-danger)" }}
              >
                {badge > 99 ? "99+" : badge}
              </span>
            )}
          </button>
        );
      })}
      </div>
    </nav>
  );
};
