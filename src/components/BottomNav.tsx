"use client";

import { type FC, useEffect, useRef } from "react";
import { Home, Plus, Activity, type LucideIcon } from "lucide-react";
import { useRouter, usePathname } from "next/navigation";

// ── Publish the rendered nav height ────────────────────────────────────────
// Any element that anchors to the bottom of the screen (the chat panel/sheet,
// FAB offsets, etc.) reads `--bt-bottomnav-height` so it always sits above the
// nav — on every viewport — regardless of the nav's actual measured height
// (icon + label + safe-area inset). The variable is set while a nav is mounted
// and removed on unmount, falling back to the 0px default in globals.css.
function usePublishNavHeight() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const update = () => {
      root.style.setProperty("--bt-bottomnav-height", `${el.offsetHeight}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--bt-bottomnav-height");
    };
  }, []);
  return ref;
}

// ── Trip tab bar (inline, not bottom nav) ─────────────────────────────────
// This is the old "tab" concept — now handled by TripTabBar.tsx
// Re-export TabId for backwards compat during transition
export type TabId = "home" | "crew" | "lodging" | "schedule" | "expenses" | "comp";

// ── Bottom nav item ────────────────────────────────────────────────────────

interface NavItem {
  id: string;
  label: string;
  Icon: LucideIcon;
  href: string;
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
  const navRef = usePublishNavHeight();

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
      ref={navRef}
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
            onClick={() => router.push(href)}
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
}

export const TripBottomNav: FC<TripBottomNavProps> = ({
  tripId,
  eventId,
  showComp,
}) => {
  const router = useRouter();
  const pathname = usePathname();
  const navRef = usePublishNavHeight();

  const items: NavItem[] = [
    { id: "trip-home", label: "Trip Home", Icon: Home, href: `/trips/${tripId}` },
    {
      id: "live",
      label: "Live",
      Icon: Activity,
      href: `/trips/${tripId}/leaderboard`,
      hidden: showComp !== undefined ? !showComp : !eventId,
    },
  ];

  // Prefetch JS bundles for all nav destinations so tapping is instant.
  useEffect(() => {
    items.filter((i) => !i.hidden).forEach(({ href }) => {
      router.prefetch(href);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable after mount
  }, [tripId]);

  return (
    <nav
      ref={navRef}
      className="fixed bottom-0 left-0 right-0 z-40"
      style={{
        background: "var(--color-bt-card)",
        borderTop: "1px solid var(--color-bt-border)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <div className="mx-auto flex max-w-2xl items-stretch">
      {items.filter((i) => !i.hidden).map(({ id, label, Icon, href, badge }) => {
        const active =
          id === "trip-home"
            ? pathname === `/trips/${tripId}`
            : pathname === href;
        return (
          <button
            key={id}
            data-testid={`nav-${id}`}
            onClick={() => {
              if (pathname === href) return; // already here
              // Live is a CHILD of trip home (hierarchical, not flat tabs):
              //  - Trip Home: replace → return to THIS trip's home in place.
              //    Deterministic — never router.back(), which could pop to a
              //    previously-visited trip; never push, which would stack a
              //    duplicate home.
              //  - Live: push → browser-back from Live returns to the trip
              //    home you came from (not the previous trip).
              const goingToTripHome = href === `/trips/${tripId}`;
              if (goingToTripHome) router.replace(href);
              else router.push(href);
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
