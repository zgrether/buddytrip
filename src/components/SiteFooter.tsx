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
 * page, but the chat overlay (`ChatSheet`, Phase 6) is `position: fixed`,
 * pinned to the viewport (top of the mobile bottom nav / `--bt-bottomnav-height`)
 * rather than sized off document height — a footer stacked below it as extra
 * in-flow page content would sit BEHIND the overlay's scrim/panel rather than
 * visibly break its sizing, but it would still be an unreachable dead zone of
 * page underneath a fixed surface that never scrolls it into view. The
 * footer just doesn't belong on these routes.
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
