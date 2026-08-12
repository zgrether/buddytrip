"use client";

import Link from "next/link";
import { Plane } from "lucide-react";
import { HelperCards } from "@/components/HelperCards";

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
      {/* Centered hero block — fills the visible area below the TopNav
          (h-14 = 56px) so the FeaturesSection below naturally sits
          past the fold. The user has to scroll (or click the ghost
          link, which smooth-scrolls) to see how-it-works. */}
      <div
        className="flex flex-col items-center justify-center px-4 text-center"
        style={{ minHeight: "calc(100vh - 56px)" }}
      >
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
        </div>

        {/* Helper cards — always shown on the empty state (0 trips counts as ≤3
            with no ownership).

            NOTHING BELOW THEM. The "See how BuddyTrip works →" link and the
            marketing `FeaturesSection` it scrolled to are gone: the cards ARE the
            explanation, and a second, longer one underneath was the same teaching
            material twice. The same block on a POPULATED dashboard was the actual
            bug — it was gated `hasAnyTrips`, so the pitch appeared only once you
            had trips. */}
        <div className="mt-10 w-full max-w-[642px]">
          <HelperCards />
        </div>
      </div>
    </>
  );
}
