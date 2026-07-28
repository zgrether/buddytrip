"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * SiteFooter — a minimal, low-emphasis legal footer rendered globally (root
 * layout) so Privacy + Terms are reachable from EVERY page, including the
 * pre-auth login screen (required for Google OAuth brand verification).
 *
 * Suppressed on the marketing home (`/`), which renders its own branded
 * `MarketingFooter` carrying the same links — so the two never stack. Chrome-
 * quiet: text-dim links, subtle top border, tokens only (no CTA emphasis).
 *
 * Also suppressed on every route that renders `AppShell` (`/dashboard`,
 * `/trips/[tripId]` and its sub-routes — but NOT the standalone `/trips/new`
 * form) — those pages own their own persistent bottom navigation (AppTabBar /
 * FaceBottomNav), and this footer is a normal in-flow block that trails
 * AFTER the whole page regardless. That's harmless on an ordinarily-scrolling
 * page, but the Chat tab's embedded surface sizes itself to EXACTLY fill the
 * viewport below the top nav and above that bottom nav (`ChatView`'s
 * `calc(100svh - 56px - var(--bt-bottomnav-height, 0px))`) — a footer stacked
 * below it silently adds its own height as extra scrollable page content the
 * Chat surface's own math never accounted for, so the composer ends up
 * sitting well short of the bottom nav instead of pinned against it. Rather
 * than have `ChatView` reach outside itself to measure a footer it has no
 * business knowing about, the footer just doesn't belong on these routes.
 */
export function SiteFooter() {
  const pathname = usePathname();
  const isAppShellRoute =
    pathname === "/dashboard" || (pathname.startsWith("/trips/") && !pathname.startsWith("/trips/new"));
  if (pathname === "/" || isAppShellRoute) return null;

  const link: React.CSSProperties = {
    fontSize: 12,
    color: "var(--color-bt-text-dim)",
    textDecoration: "none",
  };
  return (
    <footer
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: "18px 16px calc(18px + env(safe-area-inset-bottom))",
        borderTop: "1px solid var(--color-bt-subtle-border)",
      }}
    >
      <span style={{ fontSize: 12, color: "var(--color-bt-text-dim)" }}>© 2026 BuddyTrip</span>
      <Link href="/privacy" style={link}>Privacy</Link>
      <Link href="/terms" style={link}>Terms</Link>
    </footer>
  );
}
