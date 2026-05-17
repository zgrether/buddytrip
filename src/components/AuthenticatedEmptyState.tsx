"use client";

import Link from "next/link";
import { Plane } from "lucide-react";
import { FeaturesSection } from "@/components/marketing/FeaturesSection";
import { MARKETING_CSS } from "@/components/marketing/MarketingPage";

/**
 * The "no trips yet" content block, rendered inside `/dashboard` when
 * the user has no trip memberships.
 *
 * This is a content block (not a full page) — the parent owns the
 * page chrome (TopNav, header with the "New trip" button, max-width
 * container). The block contributes:
 *
 *   1. A centered hero ("No trips yet" / CTA / ghost link)
 *   2. The marketing FeaturesSection below the fold, anchored at
 *      `#how-it-works` so the "Not sure where to start?" ghost link
 *      smooth-scrolls down to it on the same page.
 *
 * The BuddyTrip wordmark is intentionally absent — TopNav already
 * shows it on every page now, so repeating it inside the body felt
 * redundant.
 */
export function AuthenticatedEmptyState() {
  return (
    <>
      {/* Centered hero block — sits above the fold within the dashboard
          main container. Vertical padding gives breathing room without
          forcing a full viewport. */}
      <div className="flex flex-col items-center px-4 py-16 text-center">
        <div className="w-full max-w-[360px]">
          {/* Big icon */}
          <div
            className="mx-auto mb-5 flex h-[72px] w-[72px] items-center justify-center rounded-full"
            style={{ background: "var(--color-bt-accent-faint)" }}
          >
            <Plane size={48} strokeWidth={1.5} style={{ color: "var(--color-bt-accent)" }} />
          </div>

          {/* Heading */}
          <h1
            className="text-[18px] font-medium"
            style={{ color: "var(--color-bt-text)" }}
          >
            No trips yet
          </h1>

          {/* Sub */}
          <p
            className="mt-2 text-[14px] leading-[1.6]"
            style={{ color: "var(--color-bt-text-dim)", marginBottom: 20 }}
          >
            Start planning your next trip, or ask a trip owner to invite you.
          </p>

          {/* Primary */}
          <Link
            href="/trips/new"
            className="inline-flex items-center justify-center rounded-xl px-6 py-3 text-sm font-medium transition-opacity hover:opacity-90"
            style={{
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-base)",
            }}
          >
            New trip
          </Link>

          {/* Ghost link — smooth-scrolls down to the FeaturesSection
              rendered below (matches the in-page anchor). */}
          <div className="mt-4">
            <Link
              href="#how-it-works"
              className="text-[13px]"
              style={{ color: "var(--color-bt-accent)" }}
            >
              Not sure where to start? See how BuddyTrip works →
            </Link>
          </div>
        </div>
      </div>

      {/* How-it-works content — re-uses the marketing FeaturesSection
          so the explanation stays in one place. The marketing CSS
          selectors aren't scoped to .bt-mkt-root, but wrapping keeps
          the font + container styles consistent. The min-height:0
          override prevents .bt-mkt-root's default 100vh from pushing
          the rest of the page off-screen when embedded. */}
      <style>{MARKETING_CSS}</style>
      <div className="bt-mkt-root" style={{ minHeight: 0 }}>
        <div className="bt-mkt-main">
          <FeaturesSection />
        </div>
      </div>
    </>
  );
}
