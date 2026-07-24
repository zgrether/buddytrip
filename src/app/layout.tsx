import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Providers } from "@/lib/providers";
import { SiteFooter } from "@/components/SiteFooter";
import { INSTALL_CAPTURE_SCRIPT } from "@/lib/pwaInstall";
import "./globals.css";

export const metadata: Metadata = {
  // Resolves relative/OG URLs against the canonical domain (https://bbmi.app)
  // in prod; falls back to localhost in dev.
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
  ),
  title: "BuddyTrip",
  description: "Group trip planning and competition app",
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.png', type: 'image/png' },
    ],
    // Proper brand-mark touch icon (PWA Phase 1) — replaces the old
    // precomposed file, which stays on disk for legacy crawler requests.
    apple: '/apple-touch-icon.png',
  },
  // iOS standalone (Home Screen) identity — without this, an added-to-home
  // BuddyTrip opens as a plain Safari bookmark instead of a standalone app.
  appleWebApp: {
    capable: true,
    title: "BuddyTrip",
  },
};

// Browser/OS chrome color (PWA Phase 1). #0a0e1a = --color-bt-base dark —
// a meta tag can't read CSS variables, and the app is dark-mode-forced, so
// the single dark value is correct (no white flash on standalone launch).
export const viewport: Viewport = {
  themeColor: "#0a0e1a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        {/* Capture beforeinstallprompt at the earliest possible point (before
            hydration) so the late-mounting install banner never misses it —
            PWA install follow-up. Runs on every route; the banner itself
            stays authenticated-only (inside TopNav). */}
        <Script id="bt-install-capture" strategy="beforeInteractive">
          {INSTALL_CAPTURE_SCRIPT}
        </Script>
        <Providers>
          {children}
          {/* Global legal footer — Privacy/Terms on every page incl. pre-auth
              login (Google verification). Hides itself on `/` (MarketingFooter
              carries the links there). */}
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
