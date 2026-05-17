"use client";

import Link from "next/link";
import { Plane } from "lucide-react";

/**
 * Rendered at the root route (`/`) when an authenticated user has no
 * trips at all. Replaces the marketing page for this audience — they
 * already know what BuddyTrip is, they just don't have anything to
 * land on.
 */
export function AuthenticatedEmptyState() {
  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center px-4"
      style={{ background: "var(--color-bt-base)" }}
    >
      <div className="w-full max-w-[320px] text-center">
        {/* BuddyTrip mark — matches TopNav exactly */}
        <div
          className="mb-6 flex items-center justify-center gap-[7px] font-display text-lg font-semibold tracking-wider"
          style={{ color: "var(--color-bt-text)" }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 100 100"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            style={{ flexShrink: 0, color: "var(--color-bt-accent)" }}
          >
            <path
              d="M 28 8 L 38 8 L 76 26 L 38 44 L 38 75 L 33 92 L 28 75 Z"
              fill="currentColor"
            />
          </svg>
          BuddyTrip
        </div>

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
          Create your first trip or wait for an invite from a trip owner.
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
          + Create a trip
        </Link>

        {/* Ghost link */}
        <div className="mt-4">
          <Link
            href="/?tour=1"
            className="text-[13px]"
            style={{ color: "var(--color-bt-accent)" }}
          >
            Not sure where to start? See how BuddyTrip works →
          </Link>
        </div>
      </div>
    </main>
  );
}
