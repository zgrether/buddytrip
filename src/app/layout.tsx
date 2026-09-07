import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Providers } from "@/lib/providers";
import { SiteFooter } from "@/components/SiteFooter";
import { INSTALL_CAPTURE_SCRIPT } from "@/lib/pwaInstall";
import { THEME_SANITIZE_SCRIPT } from "@/lib/theme";
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
  // iOS standalone (Home Screen) identity.
  //
  // `capable: true` does NOT emit `apple-mobile-web-app-capable`. Next 15.5.12's
  // `AppleWebAppMeta` emits the un-prefixed `mobile-web-app-capable` for it, and
  // the apple-prefixed string appears NOWHERE in `next/dist` — so this metadata
  // API cannot produce that tag at all. `tsc` is clean, the config reads
  // correctly, and the deployed `<head>` simply lacked it.
  //
  // CLAUDE.md #23: a declared behaviour the library does not deliver. The tell
  // was the same — the config says it arrived, the output says it didn't — and
  // the fix is the same: believe the output. The previous comment here asserted
  // the tag was present, which is how it went unnoticed.
  appleWebApp: {
    capable: true,
    title: "BuddyTrip",
  },
  // So the prefixed tag is set by hand, ALONGSIDE what the API emits. Both are
  // wanted: modern iOS reads `mobile-web-app-capable`, older versions and some
  // contexts still want the apple-prefixed one, and having both is the
  // documented safe state. Do not "de-duplicate" these — they are not duplicates.
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
};

// Browser/OS chrome color (PWA Phase 1). #0a0e1a = --color-bt-base dark —
// a meta tag can't read CSS variables, so it is a literal by necessity.
//
// It is a single DARK value and the app is no longer dark-only. That is a
// KNOWN, UNFIXED consequence of the theme switch and it is in the survey: a
// user on light mode gets dark browser chrome above a light page, and on a
// standalone iOS launch a dark splash before a light first paint. Fixing it
// means either a `media`-keyed pair (which keys off the OS, not off this
// app's stored theme, so it would be wrong for exactly the user who chose
// light against a dark OS) or a runtime `<meta>` rewrite. Neither is a
// find-and-replace, and this PR deliberately repairs nothing.
export const viewport: Viewport = {
  themeColor: "#0a0e1a",
  // WITHOUT this, iOS in standalone mode insets the layout viewport away from
  // the safe areas, and the region outside it — but inside the webview — is
  // painted with the BODY background. That was the reported "band" at the top
  // of every scoped route, and it took a colour diagnostic to find, because the
  // space is not in the DOM at all: no wrapper, padding or background could ever
  // have explained it (two rounds of theories tried).
  //
  // It also means every `env(safe-area-inset-*)` resolves to 0 until this is
  // set. Six rules in this codebase were written expecting real values and had
  // never once executed with one — see the PR for the audit of each.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        {/* Repair a stored theme value that is not a known theme, BEFORE
            next-themes reads it. It reads storage unvalidated and applies
            whatever it finds as a class name, so a stray value resolves to
            `:root` — light — rather than to the intended dark default.

            A plain inline <script>, not next/script: inline scripts execute in
            DOCUMENT ORDER, and next-themes renders its own inline script where
            the provider sits, further down this body. Being first in the body
            is therefore a guarantee, where a `beforeInteractive` strategy would
            be an assumption about Next's injection point.

            No `suppressHydrationWarning` needed — this element's markup is
            identical on server and client; it is the <html> class it protects
            that differs, which the tag on <html> above already covers. */}
        <script
          id="bt-theme-sanitize"
          dangerouslySetInnerHTML={{ __html: THEME_SANITIZE_SCRIPT }}
        />
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
