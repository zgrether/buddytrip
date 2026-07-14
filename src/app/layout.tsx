import type { Metadata } from "next";
import { Providers } from "@/lib/providers";
import { SiteFooter } from "@/components/SiteFooter";
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
    apple: '/apple-touch-icon-precomposed.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
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
