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
 */
export function SiteFooter() {
  const pathname = usePathname();
  if (pathname === "/") return null;

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
